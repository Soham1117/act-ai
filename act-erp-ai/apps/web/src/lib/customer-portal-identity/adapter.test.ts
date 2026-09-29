import { createHash, createHmac, createVerify, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { rateLimited } from "../rate-limit";
import {
  createPersonaIdentityAdapter,
  IdentityAdapterError,
  type FinishChallengeResult,
  type IdentityAuditEvent,
  type IdentityChallengeRecord,
  type IdentityStore,
  type IdentityUserRecord,
} from "./adapter";
import {
  authenticateServiceRequest,
  ServiceAuthError,
  type ServiceNonceStore,
} from "./service-auth";

const now = Date.parse("2026-09-18T12:00:00.000Z");
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const publicJwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;

const user: IdentityUserRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "manager@example.invalid",
  name: "ACT Manager",
  passwordHash: "password-hash",
  personalEmail: null,
  employeePersonalEmail: "manager.personal@example.invalid",
  active: true,
};

function testStore(overrides: Partial<IdentityStore> = {}): IdentityStore {
  let challenge: (IdentityChallengeRecord & { codeHash: string; expiresAt: Date; consumed: boolean }) | null = null;
  const store: IdentityStore = {
    findUserByLogin: async (login) => (login === user.email ? user : null),
    findUserById: async (id) => (id === user.id ? user : null),
    createChallenge: async (input) => {
      challenge = {
        id: "challenge-1",
        codeHash: input.codeHash,
        expiresAt: input.expiresAt,
        consumed: false,
        identityNonce: input.identityNonce,
        identityMfaRequired: input.identityMfaRequired,
        user,
      };
      return { id: "challenge-1" };
    },
    deleteChallenge: async () => {
      challenge = null;
    },
    finishChallenge: async ({ challengeId, otp, now: current, verifyCode }): Promise<FinishChallengeResult> => {
      if (!challenge || challenge.id !== challengeId) return { status: "invalid" };
      if (challenge.consumed) return { status: "consumed" };
      if (challenge.expiresAt <= current) return { status: "expired" };
      if (challenge.identityMfaRequired && (!otp || !(await verifyCode(otp, challenge.codeHash)))) {
        return { status: "wrong-code" };
      }
      challenge.consumed = true;
      return {
        status: "success",
        challenge: {
          id: challenge.id,
          identityNonce: challenge.identityNonce,
          identityMfaRequired: challenge.identityMfaRequired,
          user,
        },
      };
    },
  };
  return { ...store, ...overrides };
}

function adapter(overrides: Partial<IdentityStore> = {}) {
  return createPersonaIdentityAdapter({
    store: testStore(overrides),
    now: () => now,
    mfaEnabled: true,
    hashPassword: async () => "code-hash",
    verifyPassword: async (plain, hash) =>
      (plain === "good-password" && hash === "password-hash") ||
      (plain === "123456" && hash === "code-hash"),
    sendLoginCode: async () => undefined,
    randomCode: () => "123456",
    signing: {
      issuer: "https://persona.example.invalid",
      audience: "act-customer-portal",
      keyId: "test-key-1",
      privateKeyPem,
    },
  });
}

describe("Persona customer-portal identity adapter", () => {
  it("uses existing Persona credentials and keeps invalid login responses generic", async () => {
    const persona = adapter();
    await expect(
      persona.begin({ login: "manager@example.invalid", password: "bad", nonce: "portal-nonce-1" }),
    ).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });
    await expect(
      persona.begin({ login: "unknown@example.invalid", password: "bad", nonce: "portal-nonce-2" }),
    ).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });
  });

  it("defaults to MFA when LOGIN_2FA_ENABLED is absent", async () => {
    const previous = process.env.LOGIN_2FA_ENABLED;
    delete process.env.LOGIN_2FA_ENABLED;
    try {
      let delivered = false;
      const persona = createPersonaIdentityAdapter({
        store: testStore(),
        now: () => now,
        hashPassword: async () => "code-hash",
        verifyPassword: async (plain, hash) =>
          plain === "good-password" && hash === "password-hash",
        sendLoginCode: async () => {
          delivered = true;
        },
        randomCode: () => "123456",
        signing: {
          issuer: "https://persona.example.invalid",
          audience: "act-customer-portal",
          keyId: "test-key-1",
          privateKeyPem,
        },
      });

      await expect(
        persona.begin({ login: user.email!, password: "good-password", nonce: "portal-nonce-default-mfa" }),
      ).resolves.toEqual({ challengeId: "challenge-1", mfaRequired: true });
      expect(delivered).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.LOGIN_2FA_ENABLED;
      else process.env.LOGIN_2FA_ENABLED = previous;
    }
  });

  it("creates a challenge, sends the existing 2FA code, and issues a verifiable assertion", async () => {
    let deliveredTo = "";
    const persona = createPersonaIdentityAdapter({
      store: testStore(),
      now: () => now,
      mfaEnabled: true,
      hashPassword: async () => "code-hash",
      verifyPassword: async (plain, hash) => plain === "good-password" && hash === "password-hash" || plain === "123456" && hash === "code-hash",
      sendLoginCode: async (recipient) => { deliveredTo = recipient; },
      randomCode: () => "123456",
      signing: { issuer: "https://persona.example.invalid", audience: "act-customer-portal", keyId: "test-key-1", privateKeyPem },
    });

    const begun = await persona.begin({ login: "MANAGER@EXAMPLE.INVALID", password: "good-password", nonce: "portal-nonce-3" });
    expect(begun).toEqual({ challengeId: "challenge-1", mfaRequired: true });
    expect(deliveredTo).toBe("manager.personal@example.invalid");

    const finished = await persona.finish({ challengeId: begun.challengeId, otp: "123456" });
    const [encodedHeader, encodedPayload, encodedSignature] = finished.identityAssertion.split(".");
    const claims = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Record<string, unknown>;
    expect(claims).toMatchObject({
      iss: "https://persona.example.invalid",
      aud: "act-customer-portal",
      sub: user.id,
      iat: Math.floor(now / 1000),
      nbf: Math.floor(now / 1000),
      exp: Math.floor(now / 1000) + 60,
      nonce: "portal-nonce-3",
      email: user.email,
      displayName: user.name,
    });
    expect(typeof claims.jti).toBe("string");

    const verifier = createVerify("SHA256");
    verifier.update(`${encodedHeader}.${encodedPayload}`, "ascii");
    verifier.end();
    expect(verifier.verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(encodedSignature, "base64url"))).toBe(true);
    expect(persona.jwks().keys[0]).toMatchObject({ kid: "test-key-1", alg: "ES256", use: "sig", key_ops: ["verify"], ...publicJwk });
  });

  it("rejects wrong, expired, and replayed OTP challenges", async () => {
    const persona = adapter();
    const begun = await persona.begin({ login: user.email!, password: "good-password", nonce: "portal-nonce-4" });
    const wrongStore = testStore({
      finishChallenge: async () => ({ status: "wrong-code" }),
    });
    await expect(adapter({ finishChallenge: wrongStore.finishChallenge }).finish({ challengeId: begun.challengeId, otp: "000000" })).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });
    await expect(persona.finish({ challengeId: begun.challengeId, otp: "000000" })).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });

    const expired = adapter({ finishChallenge: async () => ({ status: "expired" }) });
    await expect(expired.finish({ challengeId: begun.challengeId, otp: "123456" })).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });
  });

  it("fails closed when signing configuration is incomplete", () => {
    expect(() => createPersonaIdentityAdapter({ signing: { issuer: "issuer" } })).toThrow(IdentityAdapterError);
  });
});

function signedHeaders(body: string, path: string, timestamp: string, nonce: string, secret: string) {
  const canonical = ["POST", path, createHash("sha256").update(body, "utf8").digest("hex"), timestamp, nonce].join("\n");
  return new Headers({
    "x-act-service-id": "portal-service",
    "x-act-timestamp": timestamp,
    "x-act-nonce": nonce,
    "x-act-signature": createHmac("sha256", secret).update(canonical, "utf8").digest("base64url"),
  });
}

describe("Persona identity service authentication", () => {
  it("rejects bad signatures, stale timestamps, and replayed nonces", async () => {
    const consumed = new Set<string>();
    const nonceStore: ServiceNonceStore = {
      consume: async (hash) => {
        if (consumed.has(hash)) return false;
        consumed.add(hash);
        return true;
      },
    };
    const body = JSON.stringify({ login: "manager", password: "never-logged" });
    const valid = {
      method: "POST",
      path: "/v1/identity/begin",
      body,
      headers: signedHeaders(body, "/v1/identity/begin", String(Math.floor(now / 1000)), "service-nonce-1", "service-secret"),
    };
    await expect(authenticateServiceRequest(valid, { serviceId: "portal-service", hmacSecret: "service-secret", now: () => now, nonceStore })).resolves.toBeUndefined();
    await expect(authenticateServiceRequest(valid, { serviceId: "portal-service", hmacSecret: "service-secret", now: () => now, nonceStore })).rejects.toBeInstanceOf(ServiceAuthError);

    const bad = { ...valid, headers: new Headers(valid.headers) };
    bad.headers.set("x-act-signature", "bad-signature");
    await expect(authenticateServiceRequest(bad, { serviceId: "portal-service", hmacSecret: "service-secret", now: () => now, nonceStore })).rejects.toBeInstanceOf(ServiceAuthError);

    const staleHeaders = signedHeaders(body, "/v1/identity/begin", String(Math.floor(now / 1000) - 61), "service-nonce-2", "service-secret");
    await expect(authenticateServiceRequest({ ...valid, headers: staleHeaders }, { serviceId: "portal-service", hmacSecret: "service-secret", now: () => now, nonceStore })).rejects.toBeInstanceOf(ServiceAuthError);
  });
});

function auditedAdapter(overrides: Partial<IdentityStore> = {}, rateLimit?: (k: string, m: number, w: number) => boolean) {
  const events: IdentityAuditEvent[] = [];
  const persona = createPersonaIdentityAdapter({
    store: testStore(overrides),
    now: () => now,
    mfaEnabled: true,
    hashPassword: async () => "code-hash",
    verifyPassword: async (plain, hash) =>
      (plain === "good-password" && hash === "password-hash") ||
      (plain === "123456" && hash === "code-hash"),
    sendLoginCode: async () => undefined,
    randomCode: () => "123456",
    rateLimit,
    audit: async (event) => {
      events.push(event);
    },
    signing: { issuer: "https://persona.example.invalid", audience: "act-customer-portal", keyId: "test-key-1", privateKeyPem },
  });
  return { persona, events };
}

describe("identity proxy public path", () => {
  const source = readFileSync(resolve(__dirname, "../../proxy.ts"), "utf8");
  const list = /const PUBLIC_PATHS = \[([\s\S]*?)\];/.exec(source)![1];
  const paths = [...list.matchAll(/^\s*"([^"]+)"/gm)].map((m) => m[1]);
  const isPublic = (path: string) => paths.some((p) => path === p || path.startsWith(`${p}/`));

  it("opens only the identity adapter subtree", () => {
    for (const op of ["jwks", "begin", "finish", "status"]) {
      expect(isPublic(`/api/v1/identity/${op}`)).toBe(true);
    }
    expect(isPublic("/api/v1/identityfoo")).toBe(false);
    expect(isPublic("/api/v1")).toBe(false);
    expect(isPublic("/api/v1/other")).toBe(false);
    expect(isPublic("/api/chat")).toBe(false);
  });
});

describe("identity adapter rate limiting", () => {
  it("blocks the 6th begin per login with a generic non-enumerating error", async () => {
    const { persona } = auditedAdapter({}, rateLimited);
    const login = `ratelimit-${Math.random()}@example.invalid`;
    for (let i = 0; i < 5; i++) {
      await expect(persona.begin({ login, password: "bad", nonce: `nonce-rl-${i}` })).rejects.toMatchObject({
        code: "AUTHENTICATION_FAILED",
      });
    }
    await expect(persona.begin({ login, password: "bad", nonce: "nonce-rl-6" })).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("applies per-service and per-challenge limits", async () => {
    const calls: Array<[string, number]> = [];
    const { persona } = auditedAdapter({}, (key, max) => {
      calls.push([key, max]);
      return false;
    });
    await persona.begin({ login: user.email!, password: "good-password", nonce: "nonce-limits-1" }).catch(() => {});
    await persona.finish({ challengeId: "challenge-1", otp: "123456" }).catch(() => {});
    expect(calls).toContainEqual(["identity:begin:service", 30]);
    expect(calls.some(([k, m]) => k.startsWith("identity:begin:login:") && m === 5)).toBe(true);
    expect(calls).toContainEqual(["identity:finish:service", 60]);
    expect(calls).toContainEqual(["identity:finish:challenge:challenge-1", 10]);
    expect(calls.some(([k]) => k.includes(user.email!))).toBe(false);
  });

  it("rejects finish when limited", async () => {
    const { persona, events } = auditedAdapter({}, () => true);
    await expect(persona.finish({ challengeId: "c", otp: "123456" })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(events[0]).toMatchObject({ action: "identity.finish", diff: { outcome: "failure", reason: "rate-limited" } });
  });
});

describe("identity adapter audit logging", () => {
  it("records begin/finish/status outcomes without secrets", async () => {
    const { persona, events } = auditedAdapter({}, () => false);
    await persona.begin({ login: user.email!, password: "wrong-secret-pw", nonce: "nonce-audit-0" }).catch(() => {});
    const begun = await persona.begin({ login: user.email!, password: "good-password", nonce: "nonce-audit-1" });
    await persona.finish({ challengeId: begun.challengeId, otp: "000000" }).catch(() => {});
    const finished = await persona.finish({ challengeId: begun.challengeId, otp: "123456" });
    await persona.status({ personaUserId: user.id });

    expect(events.map((e) => `${e.action}:${e.diff.outcome}`)).toEqual([
      "identity.begin:failure",
      "identity.begin:success",
      "identity.finish:failure",
      "identity.finish:success",
      "identity.status:success",
    ]);
    expect(events[0].diff.reason).toBe("invalid-credentials");
    const serialized = JSON.stringify(events);
    for (const secret of ["wrong-secret-pw", "good-password", "123456", "nonce-audit", finished.identityAssertion]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("does not fail the auth flow when audit writing throws", async () => {
    const persona = createPersonaIdentityAdapter({
      store: testStore(),
      now: () => now,
      mfaEnabled: true,
      hashPassword: async () => "code-hash",
      verifyPassword: async (plain, hash) => plain === "good-password" && hash === "password-hash",
      sendLoginCode: async () => undefined,
      randomCode: () => "123456",
      rateLimit: () => false,
      audit: async () => {
        throw new Error("db down");
      },
      signing: { issuer: "https://persona.example.invalid", audience: "act-customer-portal", keyId: "test-key-1", privateKeyPem },
    });
    await expect(
      persona.begin({ login: user.email!, password: "good-password", nonce: "nonce-audit-fail" }),
    ).resolves.toMatchObject({ mfaRequired: true });
  });
});
