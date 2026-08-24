import { env } from "@/lib/env";

/**
 * Feature flags.
 *
 * SERVER-ONLY — reads a server env var, so importing this from a client
 * component will throw. Client components that need a flag should receive it
 * as a prop from a Server Component (see the admin/employee layouts passing
 * `aiEnabled` into the sidebars).
 */

/**
 * The AI document-chat feature: the `agent` service, the knowledge base, and
 * SQS-driven ingestion. Off by default — the core ERP (employees, HR,
 * time-tracking, payroll, documents) does not depend on it.
 *
 * When false: chat/knowledge pages 404, `/api/chat` returns 503, and
 * knowledge upload refuses rather than enqueueing to a queue that isn't there.
 */
export const aiEnabled = env.AI_ENABLED === "true";
