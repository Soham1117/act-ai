import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createSign,
  randomInt,
  randomUUID,
  type KeyObject,
} from "node:crypto";
import { db } from "../db";
import { rateLimited } from "../rate-limit";
import { hashPassword as hashPersonaPassword, verifyPassword as verifyPersonaPassword } from "../auth/password";

const CHALLENGE_TTL_MS = 5 * 60_000;
const ASSERTION_TTL_SECONDS = 60;
const MAX_LOGIN_LENGTH = 256;
const MAX_PASSWORD_LENGTH = 1024;
const MAX_CHALLENGE_ID_LENGTH = 512;
const MAX_NONCE_LENGTH = 512;

// Rate limits (in-process, see lib/rate-limit.ts). Per-login and per-service
// buckets on begin blunt password guessing and code-spamming a real inbox;
// finish is bounded per challenge and per service.
const RATE_WINDOW_MS = 15 * 60_000;
const BEGIN_PER_LOGIN_MAX = 5;
const BEGIN_PER_SERVICE_MAX = 30;
const FINISH_PER_CHALLENGE_MAX = 10;
const FINISH_PER_SERVICE_MAX = 60;

// A valid bcrypt hash used only to keep an unknown-user password check on the
// same expensive code path. It does not correspond to an application secret.
const DUMMY_PASSWORD_HASH = "$2b$12$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

export type IdentityUserRecord = {
  id: string;
  email: string | null;
  name: string;
  passwordHash: string | null;
  personalEmail: string | null;
  employeePersonalEmail: string | null;
  active: boolean;
};

export type IdentityChallengeRecord = {
  id: string;
  identityNonce: string;
  identityMfaRequired: boolean;
  user: IdentityUserRecord;
};

export type FinishChallengeResult =
  | { status: "invalid" | "expired" | "consumed" | "wrong-code" }
  | { status: "success"; challenge: IdentityChallengeRecord };

export type IdentityStore = {
  findUserByLogin(login: string): Promise<IdentityUserRecord | null>;
  findUserById(id: string): Promise<IdentityUserRecord | null>;
  createChallenge(input: {
    userId: string;
    codeHash: string;
    expiresAt: Date;
    identityNonce: string;
    identityMfaRequired: boolean;
  }): Promise<{ id: string }>;
  deleteChallenge(id: string): Promise<void>;
  finishChallenge(input: {
    challengeId: string;
    otp?: string;
    now: Date;
    verifyCode: (plain: string, hash: string) => Promise<boolean>;
  }): Promise<FinishChallengeResult>;
};

export type IdentityAdapterErrorCode = "AUTHENTICATION_FAILED" | "UNAVAILABLE" | "RATE_LIMITED";

export class IdentityAdapterError extends Error {
  readonly code: IdentityAdapterErrorCode;

  constructor(
    message = "Authentication failed.",
    code: IdentityAdapterErrorCode = "AUTHENTICATION_FAILED",
  ) {
    super(message);
    this.name = "IdentityAdapterError";
    this.code = code;
  }
}

type SigningConfig = {
  issuer: string;
  audience: string;
  keyId: string;
  privateKeyPem: string;
};

export type IdentityAuditEvent = {
  action: "identity.begin" | "identity.finish" | "identity.status";
  resource: string;
  actor?: { id?: string | null; email?: string | null };
  /** Outcome metadata only. Never passwords, codes, nonces or assertions. */
  diff: { outcome: "success" | "failure"; reason?: string };
};

export type PersonaIdentityAdapterOptions = {
  store?: IdentityStore;
  /** Returns true when the action should be BLOCKED (see lib/rate-limit.ts). */
  rateLimit?: (key: string, max: number, windowMs: number) => boolean;
  audit?: (event: IdentityAuditEvent) => Promise<void>;
  now?: () => number;
  mfaEnabled?: boolean;
  hashPassword?: (plain: string) => Promise<string>;
  verifyPassword?: (plain: string, hash: string) => Promise<boolean>;
  sendLoginCode?: (recipient: string, code: string) => Promise<void>;
  randomCode?: () => string;
  signing?: Partial<SigningConfig>;
};

async function sendPersonaLoginCode(recipient: string, code: string): Promise<void> {
  // Keep the email/environment boundary lazy so focused adapter tests can use
  // an injected delivery function without loading the whole app environment.
  const { sendLoginCode } = await import("../email");
  await sendLoginCode(recipient, code);
}

async function writePersonaAudit(event: IdentityAuditEvent): Promise<void> {
  // Lazy: audit.ts pulls in next/headers + session helpers.
  const { audit } = await import("../audit");
  await audit({
    action: event.action,
    resource: event.resource,
    diff: event.diff,
    actor: event.actor ?? { id: null, email: null },
  });
}

function shortDigest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

export type IdentityBeginRequest = {
  login: string;
  password: string;
  nonce: string;
};

export type IdentityBeginResponse = {
  challengeId: string;
  mfaRequired: boolean;
};

export type IdentityFinishRequest = {
  challengeId: string;
  otp?: string;
};

export type IdentityFinishResponse = {
  identityAssertion: string;
};

export type IdentityStatusResponse = {
  personaUserId: string;
  active: boolean;
  email: string;
  displayName: string;
};

type PublicJwk = Record<string, unknown> & {
  kid: string;
  alg: "ES256" | "RS256";
  use: "sig";
  key_ops: ["verify"];
};

function normalizePem(value: string): string {
  return value.includes("\\n") ? value.replaceAll("\\n", "\n") : value;
}

function requiredConfig(name: string, override?: string): string {
  const value = override ?? process.env[name];
  if (!value?.trim()) {
    throw new IdentityAdapterError("Identity adapter is unavailable.", "UNAVAILABLE");
  }
  return value;
}

function signingConfig(overrides: Partial<SigningConfig> = {}): SigningConfig {
  return {
    issuer: requiredConfig("PERSONA_IDENTITY_ISSUER", overrides.issuer),
    audience: requiredConfig(
      "PERSONA_IDENTITY_AUDIENCE",
      overrides.audience ?? process.env.PERSONA_IDENTITY_AUDIENCE ?? "act-customer-portal",
    ),
    keyId: requiredConfig("PERSONA_IDENTITY_KEY_ID", overrides.keyId),
    privateKeyPem: normalizePem(
      requiredConfig("PERSONA_IDENTITY_PRIVATE_KEY", overrides.privateKeyPem),
    ),
  };
}

function userFromPrisma(row: {
  id: string;
  email: string | null;
  name: string;
  passwordHash: string | null;
  personalEmail: string | null;
  employee: { personalEmail: string | null; employmentStatus: "ACTIVE" | "ON_LEAVE" | "TERMINATED" } | null;
}): IdentityUserRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.passwordHash,
    personalEmail: row.personalEmail,
    employeePersonalEmail: row.employee?.personalEmail ?? null,
    active: row.employee?.employmentStatus !== "TERMINATED",
  };
}

const identityUserSelect = {
  id: true,
  email: true,
  name: true,
  passwordHash: true,
  personalEmail: true,
  employee: { select: { personalEmail: true, employmentStatus: true } },
} as const;

const prismaIdentityStore: IdentityStore = {
  async findUserByLogin(login) {
    const row = await db.user.findFirst({
      where: { OR: [{ email: login }, { username: login }] },
      select: identityUserSelect,
    });
    return row ? userFromPrisma(row) : null;
  },

  async findUserById(id) {
    const row = await db.user.findUnique({ where: { id }, select: identityUserSelect });
    return row ? userFromPrisma(row) : null;
  },

  async createChallenge(input) {
    return db.loginChallenge.create({
      data: {
        userId: input.userId,
        codeHash: input.codeHash,
        expiresAt: input.expiresAt,
        identityNonce: input.identityNonce,
        identityMfaRequired: input.identityMfaRequired,
      },
      select: { id: true },
    });
  },

  async deleteChallenge(id) {
    await db.loginChallenge.delete({ where: { id } });
  },

  async finishChallenge({ challengeId, otp, now, verifyCode }) {
    return db.$transaction(async (tx) => {
      const row = await tx.loginChallenge.findUnique({
        where: { id: challengeId },
        include: { user: { select: identityUserSelect } },
      });
      if (!row || !row.identityNonce) return { status: "invalid" } as const;
      if (row.consumedAt) return { status: "consumed" } as const;
      if (row.expiresAt <= now) return { status: "expired" } as const;
      if (row.attempts >= 5) return { status: "invalid" } as const;

      if (row.identityMfaRequired) {
        if (!otp) {
          await tx.loginChallenge.updateMany({
            where: { id: challengeId, consumedAt: null, expiresAt: { gt: now }, attempts: { lt: 5 } },
            data: { attempts: { increment: 1 } },
          });
          return { status: "wrong-code" } as const;
        }
        const valid = await verifyCode(otp, row.codeHash);
        if (!valid) {
          await tx.loginChallenge.updateMany({
            where: { id: challengeId, consumedAt: null, expiresAt: { gt: now }, attempts: { lt: 5 } },
            data: { attempts: { increment: 1 } },
          });
          return { status: "wrong-code" } as const;
        }
      } else if (otp !== undefined) {
        await tx.loginChallenge.updateMany({
          where: { id: challengeId, consumedAt: null, expiresAt: { gt: now }, attempts: { lt: 5 } },
          data: { attempts: { increment: 1 } },
        });
        return { status: "wrong-code" } as const;
      }

      const consumed = await tx.loginChallenge.updateMany({
        where: { id: challengeId, consumedAt: null, expiresAt: { gt: now }, attempts: { lt: 5 } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) return { status: "consumed" } as const;

      return {
        status: "success",
        challenge: {
          id: row.id,
          identityNonce: row.identityNonce,
          identityMfaRequired: row.identityMfaRequired,
          user: userFromPrisma(row.user),
        },
      } as const;
    });
  },
};

function randomSixDigitCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function base64urlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function loadSigningMaterial(config: SigningConfig): {
  privateKey: KeyObject;
  publicJwk: PublicJwk;
} {
  try {
    const privateKey = createPrivateKey(config.privateKeyPem);
    const publicJwk = createPublicKey(privateKey).export({ format: "jwk" }) as Record<string, unknown>;
    const algorithm =
      publicJwk.kty === "EC" && publicJwk.crv === "P-256"
        ? "ES256"
        : publicJwk.kty === "RSA"
          ? "RS256"
          : null;
    if (!algorithm) throw new Error("Unsupported signing key");
    return {
      privateKey,
      publicJwk: {
        ...publicJwk,
        kid: config.keyId,
        alg: algorithm,
        use: "sig",
        key_ops: ["verify"],
      },
    };
  } catch {
    throw new IdentityAdapterError("Identity adapter is unavailable.", "UNAVAILABLE");
  }
}

function signAssertion(
  claims: Record<string, unknown>,
  privateKey: KeyObject,
  algorithm: "ES256" | "RS256",
  keyId: string,
): string {
  const header = base64urlJson({ alg: algorithm, typ: "JWT", kid: keyId });
  const payload = base64urlJson(claims);
  const signingInput = `${header}.${payload}`;
  const signer = createSign(algorithm === "ES256" ? "SHA256" : "RSA-SHA256");
  signer.update(signingInput, "ascii");
  signer.end();
  const signature = signer
    .sign(algorithm === "ES256" ? { key: privateKey, dsaEncoding: "ieee-p1363" } : privateKey)
    .toString("base64url");
  return `${signingInput}.${signature}`;
}

export class PersonaIdentityAdapter {
  private readonly store: IdentityStore;
  private readonly rateLimit: (key: string, max: number, windowMs: number) => boolean;
  private readonly auditSink: (event: IdentityAuditEvent) => Promise<void>;
  private readonly now: () => number;
  private readonly mfaEnabled: boolean;
  private readonly hashPassword: (plain: string) => Promise<string>;
  private readonly verifyPassword: (plain: string, hash: string) => Promise<boolean>;
  private readonly sendLoginCode: (recipient: string, code: string) => Promise<void>;
  private readonly randomCode: () => string;
  private readonly signing: SigningConfig;
  private readonly signingMaterial: { privateKey: KeyObject; publicJwk: PublicJwk };

  constructor(options: PersonaIdentityAdapterOptions = {}) {
    this.store = options.store ?? prismaIdentityStore;
    this.rateLimit = options.rateLimit ?? rateLimited;
    this.auditSink = options.audit ?? writePersonaAudit;
    this.now = options.now ?? Date.now;
    // Match env.ts's validated default and fail closed if the setting is
    // absent (or somehow reaches this boundary with an invalid value).
    this.mfaEnabled = options.mfaEnabled ?? process.env.LOGIN_2FA_ENABLED !== "false";
    this.hashPassword = options.hashPassword ?? hashPersonaPassword;
    this.verifyPassword = options.verifyPassword ?? verifyPersonaPassword;
    this.sendLoginCode = options.sendLoginCode ?? sendPersonaLoginCode;
    this.randomCode = options.randomCode ?? randomSixDigitCode;
    this.signing = signingConfig(options.signing);
    this.signingMaterial = loadSigningMaterial(this.signing);
  }

  /** Audit writes must never block or fail the auth flow. */
  private async record(event: IdentityAuditEvent): Promise<void> {
    try {
      await this.auditSink(event);
    } catch {
      // swallowed by design
    }
  }

  async begin(input: IdentityBeginRequest): Promise<IdentityBeginResponse> {
    if (
      typeof input.login !== "string" ||
      input.login.trim().length === 0 ||
      input.login.trim().length > MAX_LOGIN_LENGTH ||
      typeof input.password !== "string" ||
      input.password.length === 0 ||
      input.password.length > MAX_PASSWORD_LENGTH ||
      typeof input.nonce !== "string" ||
      input.nonce.length === 0 ||
      input.nonce.length > MAX_NONCE_LENGTH
    ) {
      await this.record({
        action: "identity.begin",
        resource: "IdentityLogin:invalid",
        diff: { outcome: "failure", reason: "invalid-request" },
      });
      throw new IdentityAdapterError();
    }

    const login = input.login.trim().toLowerCase();
    const loginResource = `IdentityLogin:${shortDigest(login)}`;
    if (
      this.rateLimit("identity:begin:service", BEGIN_PER_SERVICE_MAX, RATE_WINDOW_MS) ||
      this.rateLimit(`identity:begin:login:${shortDigest(login)}`, BEGIN_PER_LOGIN_MAX, RATE_WINDOW_MS)
    ) {
      await this.record({
        action: "identity.begin",
        resource: loginResource,
        diff: { outcome: "failure", reason: "rate-limited" },
      });
      throw new IdentityAdapterError("Too many attempts.", "RATE_LIMITED");
    }

    let user: IdentityUserRecord | null;
    try {
      user = await this.store.findUserByLogin(login);
    } catch {
      await this.record({
        action: "identity.begin",
        resource: loginResource,
        diff: { outcome: "failure", reason: "unavailable" },
      });
      throw new IdentityAdapterError("Identity adapter is unavailable.", "UNAVAILABLE");
    }

    let validPassword = false;
    try {
      validPassword = await this.verifyPassword(input.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    } catch {
      await this.record({
        action: "identity.begin",
        resource: loginResource,
        diff: { outcome: "failure", reason: "unavailable" },
      });
      throw new IdentityAdapterError("Identity adapter is unavailable.", "UNAVAILABLE");
    }
    if (!user || !validPassword || !user.active) {
      await this.record({
        action: "identity.begin",
        resource: user ? `User:${user.id}` : loginResource,
        actor: user ? { id: user.id, email: user.email } : undefined,
        diff: { outcome: "failure", reason: !user || !validPassword ? "invalid-credentials" : "inactive" },
      });
      throw new IdentityAdapterError();
    }

    const recipient = user.employeePersonalEmail ?? user.personalEmail;
    if (this.mfaEnabled && !recipient) {
      await this.record({
        action: "identity.begin",
        resource: `User:${user.id}`,
        actor: { id: user.id, email: user.email },
        diff: { outcome: "failure", reason: "no-recipient" },
      });
      throw new IdentityAdapterError();
    }

    const code = this.randomCode();
    const expiresAt = new Date(this.now() + CHALLENGE_TTL_MS);
    let challenge: { id: string };
    try {
      challenge = await this.store.createChallenge({
        userId: user.id,
        codeHash: await this.hashPassword(code),
        expiresAt,
        identityNonce: input.nonce,
        identityMfaRequired: this.mfaEnabled,
      });
      if (this.mfaEnabled) await this.sendLoginCode(recipient!, code);
    } catch {
      if (challenge!) await this.store.deleteChallenge(challenge.id).catch(() => {});
      await this.record({
        action: "identity.begin",
        resource: `User:${user.id}`,
        actor: { id: user.id, email: user.email },
        diff: { outcome: "failure", reason: "unavailable" },
      });
      throw new IdentityAdapterError("Identity adapter is unavailable.", "UNAVAILABLE");
    }

    await this.record({
      action: "identity.begin",
      resource: `User:${user.id}`,
      actor: { id: user.id, email: user.email },
      diff: { outcome: "success" },
    });
    return { challengeId: challenge.id, mfaRequired: this.mfaEnabled };
  }

  async finish(input: IdentityFinishRequest): Promise<IdentityFinishResponse> {
    if (
      typeof input.challengeId !== "string" ||
      input.challengeId.trim().length === 0 ||
      input.challengeId.length > MAX_CHALLENGE_ID_LENGTH ||
      (input.otp !== undefined && !/^\d{6}$/.test(input.otp))
    ) {
      await this.record({
        action: "identity.finish",
        resource: "IdentityChallenge:invalid",
        diff: { outcome: "failure", reason: "invalid-request" },
      });
      throw new IdentityAdapterError();
    }

    const challengeResource = `IdentityChallenge:${input.challengeId}`;
    if (
      this.rateLimit("identity:finish:service", FINISH_PER_SERVICE_MAX, RATE_WINDOW_MS) ||
      this.rateLimit(`identity:finish:challenge:${input.challengeId}`, FINISH_PER_CHALLENGE_MAX, RATE_WINDOW_MS)
    ) {
      await this.record({
        action: "identity.finish",
        resource: challengeResource,
        diff: { outcome: "failure", reason: "rate-limited" },
      });
      throw new IdentityAdapterError("Too many attempts.", "RATE_LIMITED");
    }

    let result: FinishChallengeResult;
    try {
      result = await this.store.finishChallenge({
        challengeId: input.challengeId,
        otp: input.otp,
        now: new Date(this.now()),
        verifyCode: this.verifyPassword,
      });
    } catch {
      await this.record({
        action: "identity.finish",
        resource: challengeResource,
        diff: { outcome: "failure", reason: "unavailable" },
      });
      throw new IdentityAdapterError("Identity adapter is unavailable.", "UNAVAILABLE");
    }
    if (result.status !== "success" || !result.challenge.user.active) {
      const failedUser = result.status === "success" ? result.challenge.user : null;
      await this.record({
        action: "identity.finish",
        resource: failedUser ? `User:${failedUser.id}` : challengeResource,
        actor: failedUser ? { id: failedUser.id, email: failedUser.email } : undefined,
        diff: { outcome: "failure", reason: result.status === "success" ? "inactive" : result.status },
      });
      throw new IdentityAdapterError();
    }

    const nowSeconds = Math.floor(this.now() / 1000);
    const algorithm = this.signingMaterial.publicJwk.alg;
    const claims: Record<string, unknown> = {
      iss: this.signing.issuer,
      aud: this.signing.audience,
      sub: result.challenge.user.id,
      iat: nowSeconds,
      nbf: nowSeconds,
      exp: nowSeconds + ASSERTION_TTL_SECONDS,
      jti: randomUUID(),
      nonce: result.challenge.identityNonce,
    };
    if (result.challenge.user.email) claims.email = result.challenge.user.email;
    if (result.challenge.user.name) claims.displayName = result.challenge.user.name;
    await this.record({
      action: "identity.finish",
      resource: `User:${result.challenge.user.id}`,
      actor: { id: result.challenge.user.id, email: result.challenge.user.email },
      diff: { outcome: "success" },
    });
    return {
      identityAssertion: signAssertion(
        claims,
        this.signingMaterial.privateKey,
        algorithm,
        this.signing.keyId,
      ),
    };
  }

  async status(input: { personaUserId: string }): Promise<IdentityStatusResponse> {
    if (
      typeof input.personaUserId !== "string" ||
      input.personaUserId.trim().length === 0 ||
      input.personaUserId.length > 256
    ) {
      await this.record({
        action: "identity.status",
        resource: "User:invalid",
        diff: { outcome: "failure", reason: "invalid-request" },
      });
      throw new IdentityAdapterError();
    }
    let user: IdentityUserRecord | null;
    try {
      user = await this.store.findUserById(input.personaUserId);
    } catch {
      await this.record({
        action: "identity.status",
        resource: `User:${input.personaUserId}`,
        diff: { outcome: "failure", reason: "unavailable" },
      });
      throw new IdentityAdapterError("Identity adapter is unavailable.", "UNAVAILABLE");
    }
    await this.record({
      action: "identity.status",
      resource: `User:${input.personaUserId}`,
      diff: { outcome: "success" },
    });
    return {
      personaUserId: input.personaUserId,
      active: Boolean(user?.active),
      email: user?.email ?? "",
      displayName: user?.name ?? "",
    };
  }

  jwks(): { keys: [PublicJwk] } {
    return { keys: [this.signingMaterial.publicJwk] };
  }
}

export function createPersonaIdentityAdapter(
  options: PersonaIdentityAdapterOptions = {},
): PersonaIdentityAdapter {
  return new PersonaIdentityAdapter(options);
}
