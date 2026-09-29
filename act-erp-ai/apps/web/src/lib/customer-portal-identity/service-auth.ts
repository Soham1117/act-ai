import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { db } from "../db";
import { pruneExpiredIdentityRows } from "./cleanup";

const REQUEST_TIMESTAMP_WINDOW_MS = 60_000;
const REQUEST_NONCE_RETENTION_MS = 5 * 60_000;
const MAX_REQUEST_BODY_BYTES = 64 * 1024;

export type ServiceNonceStore = {
  consume(nonceHash: string, expiresAt: Date): Promise<boolean>;
};

export type ServiceRequestAuthInput = {
  method: string;
  path: string;
  body: string;
  headers: Headers | Record<string, string | undefined>;
};

export type ServiceRequestAuthOptions = {
  serviceId?: string;
  hmacSecret?: string;
  now?: () => number;
  nonceStore?: ServiceNonceStore;
};

export class ServiceAuthError extends Error {
  readonly code: "AUTHENTICATION_FAILED" | "UNAVAILABLE";

  constructor(
    message = "Service authentication failed.",
    code: ServiceAuthError["code"] = "AUTHENTICATION_FAILED",
  ) {
    super(message);
    this.name = "ServiceAuthError";
    this.code = code;
  }
}

const prismaNonceStore: ServiceNonceStore = {
  async consume(nonceHash, expiresAt) {
    try {
      await db.identityServiceRequestNonce.create({
        data: { nonceHash, expiresAt },
      });
      // Opportunistic, throttled, bounded; never affects the request.
      void pruneExpiredIdentityRows();
      return true;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "P2002"
      ) {
        return false;
      }
      throw error;
    }
  },
};

function headerValue(
  headers: Headers | Record<string, string | undefined>,
  name: string,
): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const wanted = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === wanted);
  return entry?.[1];
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function nonceDigest(nonce: string): string {
  return sha256(`act-persona-service-nonce:v1:${nonce}`);
}

function requiredConfig(name: string, override?: string): string {
  const value = override ?? process.env[name];
  if (!value?.trim()) throw new ServiceAuthError("Service authentication is unavailable.", "UNAVAILABLE");
  return value;
}

function decodeBase64url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * Verify the private Persona adapter's canonical HMAC request and consume its
 * nonce. The raw nonce is never persisted; only a versioned digest is stored.
 */
export async function authenticateServiceRequest(
  input: ServiceRequestAuthInput,
  options: ServiceRequestAuthOptions = {},
): Promise<void> {
  if (Buffer.byteLength(input.body, "utf8") > MAX_REQUEST_BODY_BYTES) {
    throw new ServiceAuthError();
  }
  const serviceId = requiredConfig("PERSONA_IDENTITY_SERVICE_ID", options.serviceId);
  const hmacSecret = requiredConfig("PERSONA_IDENTITY_HMAC_SECRET", options.hmacSecret);
  const timestampHeader = headerValue(input.headers, "x-act-timestamp");
  const nonce = headerValue(input.headers, "x-act-nonce");
  const signature = headerValue(input.headers, "x-act-signature");
  const callerServiceId = headerValue(input.headers, "x-act-service-id");
  if (
    !timestampHeader ||
    !nonce ||
    !signature ||
    !callerServiceId ||
    !safeEqual(callerServiceId, serviceId) ||
    nonce.length < 8 ||
    nonce.length > 256 ||
    !/^[A-Za-z0-9_-]+$/.test(nonce)
  ) {
    throw new ServiceAuthError();
  }

  const timestampSeconds = Number(timestampHeader);
  const now = options.now?.() ?? Date.now();
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(now - timestampSeconds * 1000) > REQUEST_TIMESTAMP_WINDOW_MS
  ) {
    throw new ServiceAuthError();
  }

  const method = input.method.toUpperCase();
  const path = input.path.startsWith("/") ? input.path : `/${input.path}`;
  const bodyHash = sha256(input.body);
  const canonical = [method, path, bodyHash, timestampHeader, nonce].join("\n");
  const expectedSignature = createHmac("sha256", hmacSecret)
    .update(canonical, "utf8")
    .digest("base64url");
  const suppliedSignature = decodeBase64url(signature);
  const expectedSignatureBytes = decodeBase64url(expectedSignature);
  if (
    !suppliedSignature ||
    !expectedSignatureBytes ||
    suppliedSignature.length !== expectedSignatureBytes.length ||
    !timingSafeEqual(suppliedSignature, expectedSignatureBytes)
  ) {
    throw new ServiceAuthError();
  }

  const nonceStore = options.nonceStore ?? prismaNonceStore;
  const expiresAt = new Date(now + REQUEST_NONCE_RETENTION_MS);
  let consumed: boolean;
  try {
    consumed = await nonceStore.consume(nonceDigest(nonce), expiresAt);
  } catch {
    throw new ServiceAuthError("Service authentication is unavailable.", "UNAVAILABLE");
  }
  if (!consumed) throw new ServiceAuthError("Service request has already been used.");
}

export const serviceAuthLimits = {
  timestampWindowMs: REQUEST_TIMESTAMP_WINDOW_MS,
  nonceRetentionMs: REQUEST_NONCE_RETENTION_MS,
  maxBodyBytes: MAX_REQUEST_BODY_BYTES,
};
