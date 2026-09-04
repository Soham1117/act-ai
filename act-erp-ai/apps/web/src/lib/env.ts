import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    DATABASE_URL: z.string().url(),
    DIRECT_URL: z.string().url().optional(),
    // NextAuth signing secret (generate: `openssl rand -base64 32`).
    AUTH_SECRET: z.string().min(1),
    // Reversible login policy switch. When false, username/email + password
    // signs in directly and employee email fields may be left blank.
    LOGIN_2FA_ENABLED: z.enum(["true", "false"]).default("true"),
    // AWS / storage / queue (Phase 3). Endpoint set for LocalStack/MinIO locally.
    AWS_REGION: z.string().default("us-east-2"),
    AWS_ENDPOINT_URL: z.string().url().optional(),
    S3_BUCKET: z.string().min(1),
    // Login-code delivery. Microsoft Graph is preferred in production so
    // employee recipients never need to be individually verified. SES stays
    // available for local/testing and as an operational fallback.
    EMAIL_PROVIDER: z.enum(["ses", "microsoft-graph"]).default("ses"),
    SES_FROM_EMAIL: z.string().email().optional(),
    MICROSOFT_TENANT_ID: z.string().min(1).optional(),
    MICROSOFT_CLIENT_ID: z.string().min(1).optional(),
    MICROSOFT_CLIENT_SECRET: z.string().min(1).optional(),
    MICROSOFT_SENDER_USER: z.string().email().optional(),
    // Comma-separated exact IPs or IPv4 CIDRs. In production, kiosk
    // activation and clock actions fail closed when this is unset.
    KIOSK_ALLOWED_NETWORKS: z.string().optional(),
    // ── AI document-chat feature (apps/ai agent + SQS ingestion) ────────
    // Off by default. When off, the chat/knowledge routes are disabled and
    // the three vars below are unused — a core-ERP-only deploy does not
    // have to invent placeholder values for them.
    AI_ENABLED: z.enum(["true", "false"]).default("false"),
    SQS_QUEUE_URL: z.string().url().optional(),
    // Internal agent service (apps/ai). The browser never calls it directly.
    AGENT_SERVICE_URL: z.string().url().optional(),
    INTERNAL_SERVICE_TOKEN: z.string().min(1).optional(),
  },
  client: {
    NEXT_PUBLIC_SITE_URL: z.string().url().default("http://localhost:3000"),
  },
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    LOGIN_2FA_ENABLED: process.env.LOGIN_2FA_ENABLED,
    AWS_REGION: process.env.AWS_REGION,
    AWS_ENDPOINT_URL: process.env.AWS_ENDPOINT_URL,
    S3_BUCKET: process.env.S3_BUCKET,
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
    SES_FROM_EMAIL: process.env.SES_FROM_EMAIL,
    MICROSOFT_TENANT_ID: process.env.MICROSOFT_TENANT_ID,
    MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID,
    MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET,
    MICROSOFT_SENDER_USER: process.env.MICROSOFT_SENDER_USER,
    KIOSK_ALLOWED_NETWORKS: process.env.KIOSK_ALLOWED_NETWORKS,
    AI_ENABLED: process.env.AI_ENABLED,
    SQS_QUEUE_URL: process.env.SQS_QUEUE_URL,
    AGENT_SERVICE_URL: process.env.AGENT_SERVICE_URL,
    INTERNAL_SERVICE_TOKEN: process.env.INTERNAL_SERVICE_TOKEN,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  },
  emptyStringAsUndefined: true,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
});

if (process.env.SKIP_ENV_VALIDATION !== "true") {
  if (env.EMAIL_PROVIDER === "ses" && !env.SES_FROM_EMAIL) {
    throw new Error("EMAIL_PROVIDER=ses requires SES_FROM_EMAIL.");
  }
  if (env.EMAIL_PROVIDER === "microsoft-graph") {
    const missing = (
      [
        "MICROSOFT_TENANT_ID",
        "MICROSOFT_CLIENT_ID",
        "MICROSOFT_CLIENT_SECRET",
        "MICROSOFT_SENDER_USER",
      ] as const
    ).filter((key) => !env[key]);
    if (missing.length > 0) {
      throw new Error(`EMAIL_PROVIDER=microsoft-graph requires: ${missing.join(", ")}.`);
    }
  }
}

/**
 * Fail fast on a half-configured AI deploy. Without this, AI_ENABLED=true
 * with a missing agent URL or service token would build and boot fine, then
 * 500 the first time somebody opened the Assistant.
 *
 * Server-side only — every importer of this module runs on the Node runtime.
 */
if (process.env.SKIP_ENV_VALIDATION !== "true" && env.AI_ENABLED === "true") {
  const missing = (
    ["SQS_QUEUE_URL", "AGENT_SERVICE_URL", "INTERNAL_SERVICE_TOKEN"] as const
  ).filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(
      `AI_ENABLED=true but these required vars are unset: ${missing.join(", ")}. ` +
        `Set them, or set AI_ENABLED=false to run the core ERP without the AI feature.`,
    );
  }
}
