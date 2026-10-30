import { db } from "@/lib/db";
import { formatDateOnly } from "@/lib/format";

/**
 * Message when any of these business dates falls in a closed pay period, else
 * null. Hours in a closed period were exported, so they must not change until
 * an admin reopens it. Kiosk punches are not affected.
 */
export async function closedPeriodMessage(...dates: Date[]): Promise<string | null> {
  if (dates.length === 0) return null;
  const hit = await db.payrollCalendar.findFirst({
    where: {
      closedAt: { not: null },
      OR: dates.map((d) => ({ payPeriodStart: { lte: d }, payPeriodEnd: { gte: d } })),
    },
    select: { title: true, payPeriodStart: true, payPeriodEnd: true },
  });
  if (!hit) return null;
  return `That date is in "${hit.title}" (${formatDateOnly(hit.payPeriodStart)} to ${formatDateOnly(hit.payPeriodEnd)}), a closed pay period. Reopen it on the Payroll page to change hours.`;
}

export type PeriodCounts = { pending: number; open: number };

/** Entries still needing attention inside each period: pending approval, and still clocked in. */
export async function loadPeriodCounts(
  periods: { id: string; payPeriodStart: Date; payPeriodEnd: Date }[],
): Promise<Map<string, PeriodCounts>> {
  const out = new Map<string, PeriodCounts>(periods.map((p) => [p.id, { pending: 0, open: 0 }]));
  if (periods.length === 0) return out;
  const from = periods.reduce((m, p) => (p.payPeriodStart < m ? p.payPeriodStart : m), periods[0]!.payPeriodStart);
  const to = periods.reduce((m, p) => (p.payPeriodEnd > m ? p.payPeriodEnd : m), periods[0]!.payPeriodEnd);
  const entries = await db.timeEntry.findMany({
    where: {
      date: { gte: from, lte: to },
      OR: [
        { approvalStatus: "PENDING", clockOut: { not: null } },
        { status: { in: ["ACTIVE", "ON_BREAK"] } },
      ],
    },
    select: { date: true, clockOut: true, status: true },
  });
  for (const e of entries) {
    const isOpen = e.status === "ACTIVE" || e.status === "ON_BREAK";
    for (const p of periods) {
      if (e.date < p.payPeriodStart || e.date > p.payPeriodEnd) continue;
      const c = out.get(p.id)!;
      if (isOpen) c.open += 1;
      else c.pending += 1;
    }
  }
  return out;
}
