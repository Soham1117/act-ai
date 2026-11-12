import type { Prisma } from "@prisma/client";
import { ADMIN_MAX_SHIFT_MS, computeEntryTotals, dateOnlyToString } from "@/lib/time-rules";
import { allocateDailyLunch, LEAVE_JOB_CODES, LUNCH_FROM } from "@/lib/lunch";

type Tx = Prisma.TransactionClient;

/**
 * Re-applies the automatic lunch to every closed shift of one worker's
 * business day, from the punches and breaks themselves. Call inside the same
 * transaction (and worker lock) after any write that adds, removes or changes
 * a shift. Pass every date the write touched (old and new date on a move).
 */
export async function applyDailyLunch(
  tx: Tx,
  kind: "employee" | "contract",
  workerId: string,
  ...dates: Array<Date | null | undefined>
): Promise<void> {
  const days = [...new Set(dates.filter((d): d is Date => !!d).map(dateOnlyToString))].filter(
    (d) => d >= LUNCH_FROM,
  );
  for (const day of days) {
    const date = new Date(`${day}T00:00:00.000Z`);
    const rows =
      kind === "employee"
        ? await tx.timeEntry.findMany({
            where: { employeeId: workerId, date, clockOut: { not: null }, importKey: null },
            include: { breaks: true },
          })
        : await tx.contractTimeEntry.findMany({
            where: { contractWorkerId: workerId, date, clockOut: { not: null } },
            include: { breaks: true },
          });
    const shifts = rows
      .filter((r) => kind === "contract" || !LEAVE_JOB_CODES.has(r.jobCode))
      .map((r) => {
        // Contract workers cannot take personal breaks: their time is the whole shift.
        const t = computeEntryTotals({
          clockIn: r.clockIn,
          clockOut: r.clockOut!,
          breaks: kind === "employee" ? r.breaks : [],
          maxShiftMs: ADMIN_MAX_SHIFT_MS,
        });
        return {
          row: r,
          personal: t.totalBreakMin,
          shift: {
            id: r.id,
            clockIn: r.clockIn.getTime(),
            spanMin: t.totalBreakMin + t.totalWorkMin,
            baseMin: t.totalWorkMin,
          },
        };
      });
    const lunch = allocateDailyLunch(shifts.map((s) => s.shift));
    for (const s of shifts) {
      const lunchMin = lunch.get(s.row.id) ?? 0;
      const data = {
        lunchMin,
        totalBreakMin: s.personal + lunchMin,
        totalWorkMin: s.shift.baseMin - lunchMin,
      };
      if (
        s.row.lunchMin === data.lunchMin &&
        s.row.totalBreakMin === data.totalBreakMin &&
        s.row.totalWorkMin === data.totalWorkMin
      )
        continue;
      if (kind === "employee") await tx.timeEntry.update({ where: { id: s.row.id }, data });
      else await tx.contractTimeEntry.update({ where: { id: s.row.id }, data });
    }
  }
}
