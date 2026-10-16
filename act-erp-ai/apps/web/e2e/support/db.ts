import { PrismaClient } from "@prisma/client";

/** Direct DB access for assertions and cleanup. Refuses anything but an e2e database. */
const url = process.env.DATABASE_URL ?? "";
if (!new URL(url).pathname.includes("e2e")) {
  throw new Error("E2E tests must run against a database whose name contains 'e2e'.");
}
export const db = new PrismaClient();

/** YYYY-MM-DD in the business time zone, `daysAgo` days back. */
export function businessYmd(daysAgo = 0): string {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
