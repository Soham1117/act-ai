/**
 * Seed LeavePolicy rows from the code defaults (DEFAULT_LEAVE_POLICIES).
 *
 *   pnpm tsx --env-file=.env.local scripts/seed-leave-policy.ts
 *
 * Idempotent and non-destructive: only creates rows for leave types that have
 * no policy yet; existing rows (edited by admins) are never overwritten.
 * (Without rows the app falls back to the same defaults in code, so running
 * this is optional but makes the policy visible/editable in the DB.)
 */
import { PrismaClient } from "@prisma/client";
import { DEFAULT_LEAVE_POLICIES, LEAVE_TYPES } from "../src/lib/leave-balance";

const db = new PrismaClient();

async function main() {
  let created = 0;
  for (const t of LEAVE_TYPES) {
    const exists = await db.leavePolicy.findUnique({ where: { leaveType: t } });
    if (exists) continue;
    await db.leavePolicy.create({ data: { leaveType: t, ...DEFAULT_LEAVE_POLICIES[t] } });
    created++;
  }
  console.log(`Leave policy: ${created} row(s) created, ${LEAVE_TYPES.length - created} already existed.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
