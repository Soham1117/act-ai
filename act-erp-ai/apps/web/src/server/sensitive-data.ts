import "server-only";

import {
  buildClient,
  CommitmentPolicy,
  getClient,
  KMS,
  KmsKeyringNode,
  RawAesKeyringNode,
  RawAesWrappingSuiteIdentifier,
} from "@aws-crypto/client-node";

export type SensitiveDataContext = {
  purpose: string;
  recordId: string;
  field: string;
};

export type EncryptedSensitiveJson = {
  $encrypted: "act-kms-json";
  version: 1;
  ciphertext: string;
};

const FORMAT = "act-kms-json";
export const SENSITIVE_TEXT_PREFIX = "act-kms-text:";
const MAX_JSON_BYTES = 256 * 1024;
const MAX_CIPHERTEXT_CHARS = 512 * 1024;
const KEY_ARN = /^arn:aws(?:-[a-z]+)*:kms:[a-z0-9-]+:\d{12}:key\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|mrk-[0-9a-f]{32})$/;
const { encrypt, decrypt } = buildClient({
  commitmentPolicy: CommitmentPolicy.REQUIRE_ENCRYPT_REQUIRE_DECRYPT,
  maxEncryptedDataKeys: 5,
});

/** Safe for user-facing errors: never forward SDK errors or payload contents. */
export class SensitiveDataError extends Error {
  constructor() {
    super("Secure data storage is unavailable. Please try again or contact your administrator.");
    this.name = "SensitiveDataError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isEncryptedSensitiveJson(value: unknown): value is EncryptedSensitiveJson {
  return record(value) && value.$encrypted === FORMAT && value.version === 1 &&
    typeof value.ciphertext === "string";
}

function contextFor(context: SensitiveDataContext) {
  // Only opaque IDs and fixed purpose/field names belong here. Context is public
  // metadata in the encrypted message and can appear in CloudTrail.
  if (Object.values(context).some(v => !v || v.length > 200)) throw new SensitiveDataError();
  return { app: "act-persona", ...context };
}

function keyrings() {
  const current = process.env.SENSITIVE_DATA_KMS_KEY_ARN?.trim();
  const previous = (process.env.SENSITIVE_DATA_KMS_PREVIOUS_KEY_ARNS ?? "")
    .split(",").map(v => v.trim()).filter(Boolean);
  const keys = [...new Set([current, ...previous])];
  if (!current || keys.length > 5 || keys.some(k => !k || !KEY_ARN.test(k))) {
    throw new SensitiveDataError();
  }
  // Local/test only: a 32-byte Raw AES master key. Never allowed in production,
  // and never mixed with real AWS KMS ciphertext from another environment.
  const devMaster = process.env.SENSITIVE_DATA_DEV_MASTER_KEY?.trim();
  if (devMaster) {
    if (process.env.NODE_ENV === "production" || !/^[0-9a-fA-F]{64}$/.test(devMaster)) {
      throw new SensitiveDataError();
    }
    // Encryption SDK requires an isolated Uint8Array, not a shared Buffer pool view.
    const unencryptedMasterKey = Uint8Array.from(Buffer.from(devMaster, "hex"));
    const local = new RawAesKeyringNode({
      keyName: "act-persona-dev",
      keyNamespace: "act-persona",
      unencryptedMasterKey,
      wrappingSuite: RawAesWrappingSuiteIdentifier.AES256_GCM_IV12_TAG16_NO_PADDING,
    });
    return { write: local, read: local };
  }
  // Do not forward the app's LocalStack/MinIO endpoint or SDK endpoint env vars.
  // Credentials remain on the server, using the standard AWS provider chain.
  const clientProvider = getClient(KMS, {
    ignoreConfiguredEndpointUrls: true,
    maxAttempts: 3,
    requestHandler: { connectionTimeout: 3_000, requestTimeout: 10_000 },
  });
  return {
    write: new KmsKeyringNode({ generatorKeyId: current, clientProvider }),
    read: new KmsKeyringNode({ keyIds: keys as string[], clientProvider }),
  };
}

/** Every new sensitive write is encrypted. Missing KMS never falls back to JSON. */
export async function encryptSensitiveJson(
  value: unknown,
  context: SensitiveDataContext,
): Promise<EncryptedSensitiveJson> {
  let plaintext: Buffer | undefined;
  try {
    const json = JSON.stringify(value);
    if (json === undefined || Buffer.byteLength(json) > MAX_JSON_BYTES) throw new SensitiveDataError();
    plaintext = Buffer.from(json, "utf8");
    const { result } = await encrypt(keyrings().write, plaintext, { encryptionContext: contextFor(context) });
    const ciphertext = result.toString("base64");
    if (ciphertext.length > MAX_CIPHERTEXT_CHARS) throw new SensitiveDataError();
    return { $encrypted: FORMAT, version: 1, ciphertext };
  } catch {
    throw new SensitiveDataError();
  } finally {
    plaintext?.fill(0);
  }
}

/** Legacy JSON reads exist only for the bounded migration window. */
export async function decryptSensitiveJson<T = unknown>(
  value: unknown,
  context: SensitiveDataContext,
): Promise<T> {
  let plaintext: Buffer | undefined;
  try {
    if (!record(value) || !("$encrypted" in value)) {
      if (process.env.SENSITIVE_DATA_REQUIRE_ENCRYPTED === "true" && value != null) {
        throw new SensitiveDataError();
      }
      return value as T;
    }
    if (!isEncryptedSensitiveJson(value) || !value.ciphertext.length ||
        value.ciphertext.length > MAX_CIPHERTEXT_CHARS ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.ciphertext)) {
      throw new SensitiveDataError();
    }
    const expected = contextFor(context);
    const decrypted = await decrypt(keyrings().read, Buffer.from(value.ciphertext, "base64"));
    plaintext = decrypted.plaintext;
    // The SDK authenticates the message context. Check our expected binding too,
    // so copying a valid ciphertext to another employee/field cannot reveal it.
    if (Object.entries(expected).some(([k, v]) => decrypted.messageHeader.encryptionContext[k] !== v) ||
        plaintext.byteLength > MAX_JSON_BYTES) throw new SensitiveDataError();
    return JSON.parse(plaintext.toString("utf8")) as T;
  } catch {
    throw new SensitiveDataError();
  } finally {
    plaintext?.fill(0);
  }
}

/** Text columns retain a self-describing ciphertext, never a bare secret. */
export async function encryptSensitiveText(value: string, context: SensitiveDataContext): Promise<string> {
  return SENSITIVE_TEXT_PREFIX + JSON.stringify(await encryptSensitiveJson(value, context));
}

export function isEncryptedSensitiveText(value: string): boolean {
  return value.startsWith(SENSITIVE_TEXT_PREFIX);
}

export async function decryptSensitiveText(value: string, context: SensitiveDataContext): Promise<string> {
  if (!isEncryptedSensitiveText(value)) {
    if (process.env.SENSITIVE_DATA_REQUIRE_ENCRYPTED === "true") throw new SensitiveDataError();
    return value;
  }
  try {
    const envelope: unknown = JSON.parse(value.slice(SENSITIVE_TEXT_PREFIX.length));
    // A corrupt prefixed string may not be treated as legacy, even in the
    // compatibility window.
    if (!isEncryptedSensitiveJson(envelope)) throw new SensitiveDataError();
    const opened = await decryptSensitiveJson(envelope, context);
    if (typeof opened !== "string") throw new SensitiveDataError();
    return opened;
  } catch {
    throw new SensitiveDataError();
  }
}
