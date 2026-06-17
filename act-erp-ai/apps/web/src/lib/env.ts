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
    SQS_QUEUE_URL: z.string().url(),
    // Internal agent service (apps/ai). The browser never calls it directly.
    AGENT_SERVICE_URL: z.string().url().default("http://localhost:8001"),
    INTERNAL_SERVICE_TOKEN: z.string().min(1),
    // Supabase service role — STILL required: employee/onboarding auth-user
    // creation, realtime notifications, and password-reset flows are not yet
    // migrated off Supabase (tracked as post-Phase-3 follow-up). Storage is S3.
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  },
  client: {
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
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
    SQS_QUEUE_URL: process.env.SQS_QUEUE_URL,
    AGENT_SERVICE_URL: process.env.AGENT_SERVICE_URL,
    INTERNAL_SERVICE_TOKEN: process.env.INTERNAL_SERVICE_TOKEN,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  },
  emptyStringAsUndefined: true,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
});
