import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    DATABASE_URL: z.string().url(),
    DIRECT_URL: z.string().url().optional(),
    // NextAuth signing secret (generate: `openssl rand -base64 32`).
    AUTH_SECRET: z.string().min(1),
    // AWS / storage / queue (Phase 3). Endpoint set for LocalStack/MinIO locally.
    AWS_REGION: z.string().default("us-east-2"),
    AWS_ENDPOINT_URL: z.string().url().optional(),
    S3_BUCKET: z.string().min(1),
    // Sender identity for login 2FA codes — must be a verified SES identity
    // (SES starts in sandbox mode: only verified addresses can receive mail
    // until production access is requested).
    SES_FROM_EMAIL: z.string().email(),
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
    AWS_REGION: process.env.AWS_REGION,
    AWS_ENDPOINT_URL: process.env.AWS_ENDPOINT_URL,
    S3_BUCKET: process.env.S3_BUCKET,
    SES_FROM_EMAIL: process.env.SES_FROM_EMAIL,
    AI_ENABLED: process.env.AI_ENABLED,
    SQS_QUEUE_URL: process.env.SQS_QUEUE_URL,
    AGENT_SERVICE_URL: process.env.AGENT_SERVICE_URL,
    INTERNAL_SERVICE_TOKEN: process.env.INTERNAL_SERVICE_TOKEN,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  },
  emptyStringAsUndefined: true,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
});

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
