import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const calls = vi.hoisted(() => ({ keyrings: [] as { generatorKeyId?: string; keyIds?: string[] }[] }));
vi.mock("@aws-crypto/client-node", async (importOriginal) => {
  const sdk = await importOriginal<typeof import("@aws-crypto/client-node")>();
  // Exercise the real Encryption SDK message format, authentication and context
  // with a local test-only key. No credentials or network requests are involved.
  return {
    ...sdk,
    KmsKeyringNode: class extends sdk.RawAesKeyringNode {
      constructor(options: { generatorKeyId?: string; keyIds?: string[] }) {
        calls.keyrings.push(options);
        super({
          keyName: "test-only", keyNamespace: "act-tests",
          unencryptedMasterKey: new Uint8Array(32).fill(7),
          wrappingSuite: sdk.RawAesWrappingSuiteIdentifier.AES256_GCM_IV12_TAG16_NO_PADDING,
        });
      }
    },
  };
});

import { decryptSensitiveJson, encryptSensitiveJson, decryptSensitiveText, encryptSensitiveText, SensitiveDataError } from "./sensitive-data";
import { encryptEmployeeNoteContent, decryptEmployeeNoteContent } from "./employee-note-sensitive-data";

const keyArn = "arn:aws:kms:us-east-2:111122223333:key/11111111-1111-4111-8111-111111111111";
const previousArn = "arn:aws:kms:us-east-2:111122223333:key/22222222-2222-4222-8222-222222222222";
const context = { purpose: "onboarding-packet", recordId: "dummy-invite", field: "directDeposit" };
const payload = { accountNumber: "000012345678", routingNumber: "000000000", text: "Dummy only" };

describe("KMS sensitive JSON", () => {
  beforeEach(() => {
    vi.stubEnv("SENSITIVE_DATA_KMS_KEY_ARN", keyArn);
    vi.stubEnv("SENSITIVE_DATA_KMS_PREVIOUS_KEY_ARNS", "");
    vi.stubEnv("SENSITIVE_DATA_REQUIRE_ENCRYPTED", "false");
    calls.keyrings.length = 0;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips JSON through real authenticated encryption without storing plaintext", async () => {
    const encrypted = await encryptSensitiveJson(payload, context);
    expect(encrypted).toMatchObject({ $encrypted: "act-kms-json", version: 1 });
    expect(JSON.stringify(encrypted)).not.toContain(payload.accountNumber);
    expect(await decryptSensitiveJson(encrypted, context)).toEqual(payload);
    expect((await encryptSensitiveJson(payload, context)).ciphertext).not.toBe(encrypted.ciphertext);
  });

  it.each(["recordId", "field", "purpose"] as const)("rejects a valid ciphertext copied to the wrong %s", async field => {
    const encrypted = await encryptSensitiveJson(payload, context);
    await expect(decryptSensitiveJson(encrypted, { ...context, [field]: "other" }))
      .rejects.toBeInstanceOf(SensitiveDataError);
  });

  it("rejects a modified ciphertext with no SDK detail leakage", async () => {
    const encrypted = await encryptSensitiveJson(payload, context);
    const bytes = Buffer.from(encrypted.ciphertext, "base64");
    bytes[bytes.length - 20] ^= 1;
    await expect(decryptSensitiveJson({ ...encrypted, ciphertext: bytes.toString("base64") }, context))
      .rejects.toThrow("Secure data storage is unavailable");
  });

  it.each([undefined, "alias/not-an-arn", "not-a-key"])("never writes plaintext with an invalid key configuration (%s)", async arn => {
    if (arn) vi.stubEnv("SENSITIVE_DATA_KMS_KEY_ARN", arn);
    else vi.stubEnv("SENSITIVE_DATA_KMS_KEY_ARN", "");
    await expect(encryptSensitiveJson(payload, context)).rejects.toBeInstanceOf(SensitiveDataError);
  });

  it("reads legacy JSON only during the compatibility window", async () => {
    expect(await decryptSensitiveJson(payload, context)).toEqual(payload);
    vi.stubEnv("SENSITIVE_DATA_REQUIRE_ENCRYPTED", "true");
    await expect(decryptSensitiveJson(payload, context)).rejects.toBeInstanceOf(SensitiveDataError);
    expect(await decryptSensitiveJson(null, context)).toBeNull();
  });

  it.each([
    { $encrypted: "act-kms-json", version: 2, ciphertext: "AAAA" },
    { $encrypted: "unknown", version: 1, ciphertext: "AAAA" },
    { $encrypted: "act-kms-json", version: 1 },
    { $encrypted: "act-kms-json", version: 1, ciphertext: "bad-base64!" },
  ])("never treats malformed encrypted data as legacy plaintext", async value => {
    await expect(decryptSensitiveJson(value, context)).rejects.toBeInstanceOf(SensitiveDataError);
  });

  it("uses replacement keys for reading only, not for encrypting every new record", async () => {
    vi.stubEnv("SENSITIVE_DATA_KMS_PREVIOUS_KEY_ARNS", previousArn);
    const encrypted = await encryptSensitiveJson(payload, context);
    await decryptSensitiveJson(encrypted, context);
    expect(calls.keyrings.filter(k => k.generatorKeyId)).toEqual([
      expect.objectContaining({ generatorKeyId: keyArn }),
      expect.objectContaining({ generatorKeyId: keyArn }),
    ]);
    expect(calls.keyrings.filter(k => k.generatorKeyId).every(k => !k.keyIds?.length)).toBe(true);
    expect(calls.keyrings.some(k => k.keyIds?.includes(previousArn))).toBe(true);
  });

  it("accepts a full multi-Region key ARN consistently with application config", async () => {
    vi.stubEnv("SENSITIVE_DATA_KMS_KEY_ARN", "arn:aws:kms:us-east-2:111122223333:key/mrk-11111111111111111111111111111111");
    const encrypted = await encryptSensitiveJson(payload, context);
    expect(await decryptSensitiveJson(encrypted, context)).toEqual(payload);
  });

  it("bounds payload size and rejects values that cannot be serialized", async () => {
    await expect(encryptSensitiveJson({ text: "x".repeat(300_000) }, context)).rejects.toBeInstanceOf(SensitiveDataError);
    await expect(encryptSensitiveJson(undefined, context)).rejects.toBeInstanceOf(SensitiveDataError);
  });

  it("round-trips encrypted text and rejects malformed prefixed wrappers", async () => {
    const sealed = await encryptSensitiveText("Dummy private text", context);
    expect(sealed).not.toContain("Dummy private text");
    expect(await decryptSensitiveText(sealed, context)).toBe("Dummy private text");
    await expect(decryptSensitiveText("act-kms-text:{}", context)).rejects.toBeInstanceOf(SensitiveDataError);
    await expect(decryptSensitiveText("act-kms-text:not-json", context)).rejects.toBeInstanceOf(SensitiveDataError);
  });

  it("protects note titles, bodies and revision reasons under separate record bindings", async () => {
    const content = { title: "Dummy medical note", body: "Dummy private observation", reason: "Dummy private reason" };
    const sealed = await encryptEmployeeNoteContent(content, "dummy-revision", true);
    const stored = { id: "dummy-revision", ...sealed };
    expect(JSON.stringify(stored)).not.toContain(content.title);
    expect(JSON.stringify(stored)).not.toContain(content.body);
    expect(JSON.stringify(stored)).not.toContain(content.reason);
    expect(await decryptEmployeeNoteContent(stored, true)).toMatchObject(content);
    await expect(decryptEmployeeNoteContent({ ...stored, id: "other-revision" }, true)).rejects.toBeInstanceOf(SensitiveDataError);
    await expect(decryptEmployeeNoteContent(stored)).rejects.toBeInstanceOf(SensitiveDataError);
  });

  it("keeps legacy note content readable only while compatibility reads are allowed", async () => {
    const note = { id: "dummy-note", title: "Old title", body: "Old body" };
    expect(await decryptEmployeeNoteContent(note)).toEqual(note);
    vi.stubEnv("SENSITIVE_DATA_REQUIRE_ENCRYPTED", "true");
    await expect(decryptEmployeeNoteContent(note)).rejects.toBeInstanceOf(SensitiveDataError);
  });

  it("uses the local Raw AES adapter only outside production", async () => {
    const master = "11".repeat(32);
    vi.stubEnv("SENSITIVE_DATA_DEV_MASTER_KEY", master);
    vi.stubEnv("NODE_ENV", "development");
    const encrypted = await encryptSensitiveJson(payload, context);
    expect(await decryptSensitiveJson(encrypted, context)).toEqual(payload);
    vi.stubEnv("NODE_ENV", "production");
    await expect(encryptSensitiveJson(payload, context)).rejects.toBeInstanceOf(SensitiveDataError);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SENSITIVE_DATA_DEV_MASTER_KEY", "not-hex");
    await expect(encryptSensitiveJson(payload, context)).rejects.toBeInstanceOf(SensitiveDataError);
  });
});
