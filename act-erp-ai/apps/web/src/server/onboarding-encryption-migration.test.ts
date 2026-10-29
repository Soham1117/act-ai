import { describe, expect, it, vi } from "vitest";
import {
  classifySensitiveValue,
  migrateSensitiveRow,
  type MigrationCrypto,
  type MigrationField,
  type MigrationMode,
} from "./onboarding-encryption-migration";

const context = { purpose: "test", recordId: "opaque-test-id", field: "draftJson" };
function fakeCrypto(): MigrationCrypto {
  return {
    encrypt: vi.fn(async (value, binding) => ({
      $encrypted: "act-kms-json", version: 1,
      ciphertext: Buffer.from(JSON.stringify({ value, binding })).toString("base64"),
    })),
    decrypt: vi.fn(async (value, binding) => {
      const parsed = JSON.parse(Buffer.from((value as { ciphertext: string }).ciphertext, "base64").toString());
      if (JSON.stringify(binding) !== JSON.stringify(parsed.binding)) throw new Error("fixture binding mismatch");
      return parsed.value;
    }),
    isEncrypted: value => Boolean(value && typeof value === "object" &&
      (value as { $encrypted: string }).$encrypted === "act-kms-json" &&
      (value as { version: number }).version === 1),
  };
}
function harness(fields: MigrationField[], mode: MigrationMode, crypto = fakeCrypto()) {
  let persisted: Record<string, unknown> = Object.fromEntries(fields.map(field => [field.name, field.value]));
  const compareAndSwap = vi.fn(async (_expected, replacement) => {
    persisted = { ...persisted, ...replacement };
    return true;
  });
  const readBack = vi.fn(async () => persisted);
  return { crypto, compareAndSwap, readBack, run: () => migrateSensitiveRow({ mode, fields, crypto, compareAndSwap, readBack }) };
}
const field = (value: unknown): MigrationField => ({ name: "draftJson", value, context });

describe("onboarding encryption migration", () => {
  it("dry-runs without crypto calls or database mutations", async () => {
    const h = harness([field({ name: "Test Hire" })], "dry-run");
    expect(await h.run()).toEqual({ fields: { draftJson: "plaintext" }, outcome: "dry-run" });
    expect(h.crypto.encrypt).not.toHaveBeenCalled();
    expect(h.crypto.decrypt).not.toHaveBeenCalled();
    expect(h.compareAndSwap).not.toHaveBeenCalled();
  });

  it("encrypts, verifies the round trip, CAS-writes and verifies persisted values", async () => {
    const h = harness([field({ name: "Test Hire", step: 2 })], "apply");
    expect((await h.run()).outcome).toBe("updated");
    expect(h.compareAndSwap).toHaveBeenCalledTimes(1);
    expect(h.readBack).toHaveBeenCalledTimes(1);
    expect(h.crypto.decrypt).toHaveBeenCalledTimes(2);
  });

  it("does not rewrite a row on an idempotent second run", async () => {
    const crypto = fakeCrypto();
    const protectedValue = await crypto.encrypt({ name: "Test Hire" }, context);
    const h = harness([field(protectedValue)], "apply", crypto);
    vi.mocked(crypto.encrypt).mockClear();
    expect((await h.run()).outcome).toBe("unchanged");
    expect(crypto.encrypt).not.toHaveBeenCalled();
    expect(h.compareAndSwap).not.toHaveBeenCalled();
  });

  it("reports a CAS conflict without clobbering a concurrent update", async () => {
    const h = harness([field({ step: 1 })], "apply");
    h.compareAndSwap.mockResolvedValue(false);
    expect((await h.run()).outcome).toBe("conflict");
    expect(h.readBack).not.toHaveBeenCalled();
  });

  it("does not write if encryption fails or returns changed plaintext", async () => {
    const crypto = fakeCrypto();
    vi.mocked(crypto.encrypt).mockRejectedValue(new Error("private SDK error"));
    const h = harness([field({ name: "Test Hire" })], "apply", crypto);
    expect((await h.run()).outcome).toBe("failed");
    expect(h.compareAndSwap).not.toHaveBeenCalled();
    const corrupt = fakeCrypto();
    vi.mocked(corrupt.decrypt).mockResolvedValue({ changed: true });
    const h2 = harness([field({ name: "Test Hire" })], "apply", corrupt);
    expect((await h2.run()).outcome).toBe("failed");
    expect(h2.compareAndSwap).not.toHaveBeenCalled();
  });

  it("atomically migrates mixed packet fields and includes every old value in CAS", async () => {
    const crypto = fakeCrypto();
    const appContext = { ...context, field: "application" };
    const bankContext = { ...context, field: "directDeposit" };
    const protectedBank = await crypto.encrypt({ accountNumber: "000000000" }, bankContext);
    const h = harness([
      { name: "application", value: { positionApplied: "Test" }, context: appContext },
      { name: "directDeposit", value: protectedBank, context: bankContext },
    ], "apply", crypto);
    expect((await h.run()).outcome).toBe("updated");
    const [expected, replacement] = h.compareAndSwap.mock.calls[0];
    expect(Object.keys(expected)).toEqual(["application", "directDeposit"]);
    expect(Object.keys(replacement)).toEqual(["application"]);
  });

  it("strict verification fails on plaintext, malformed envelopes, or authentication failure", async () => {
    const legacy = harness([field({ step: 2 })], "verify");
    expect((await legacy.run()).outcome).toBe("failed");
    const malformed = harness([field({ $encrypted: "act-kms-json", version: 99, ciphertext: "AAAA" })], "verify");
    expect((await malformed.run()).fields.draftJson).toBe("invalid");
    const crypto = fakeCrypto();
    const encrypted = await crypto.encrypt({ step: 2 }, context);
    vi.mocked(crypto.decrypt).mockRejectedValue(new Error("private auth error"));
    const corrupt = harness([field(encrypted)], "verify", crypto);
    expect((await corrupt.run()).outcome).toBe("failed");
    expect(corrupt.compareAndSwap).not.toHaveBeenCalled();
  });

  it("validates protected data in verify mode without mutations", async () => {
    const crypto = fakeCrypto();
    const h = harness([field(await crypto.encrypt({ step: 2 }, context))], "verify", crypto);
    expect((await h.run()).outcome).toBe("unchanged");
    expect(h.compareAndSwap).not.toHaveBeenCalled();
  });

  it("rejects invalid envelope shapes rather than relabeling them as plaintext", () => {
    const crypto = fakeCrypto();
    for (const value of [null, "text", { $encrypted: "unknown" }, { $encrypted: "act-kms-json", version: 1, ciphertext: "" }]) {
      expect(classifySensitiveValue(value, crypto)).toBe("invalid");
    }
  });

  it("encrypts legacy arrays used for hire-packet file results", async () => {
    const h = harness([field([{ fileName: "dummy.pdf", warnings: [] }])], "apply");
    expect((await h.run()).outcome).toBe("updated");
  });

  it("reports a post-write race without rewriting the new values", async () => {
    const h = harness([field({ step: 1 })], "apply");
    h.readBack.mockResolvedValue({ draftJson: { newerDraft: true } });
    expect((await h.run()).outcome).toBe("conflict");
    expect(h.compareAndSwap).toHaveBeenCalledTimes(1);
  });
});
