import { db } from "@/lib/db";
import type { FindingDraft, WatchPolicy } from "@/lib/watch/types";

export const DAY_MS = 24 * 60 * 60_000;

export type RuleJob = {
  id: string;
  /** Rules that would be noisy on today's data ship switched off. Turn on from the rules list. */
  defaultEnabled?: boolean;
  run: (ctx: { now: Date; policy: WatchPolicy }) => Promise<FindingDraft[]>;
};

/** The period the manager is working on now (CURRENT, else the newest not yet closed). */
export async function currentPeriod() {
  return (
    (await db.payrollCalendar.findFirst({
      where: { status: "CURRENT", closedAt: null },
      orderBy: { payPeriodStart: "desc" },
    })) ??
    (await db.payrollCalendar.findFirst({
      where: { closedAt: null, payPeriodStart: { lte: new Date() } },
      orderBy: { payPeriodStart: "desc" },
    }))
  );
}
