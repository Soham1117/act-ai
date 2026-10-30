import { db } from "@/lib/db";
import { parseDateOnly } from "@/lib/time-rules";
import { exportLoadFrom, type HoursExportEntry } from "@/lib/hours-export";

/**
 * Entries for an export. Loads from the Monday of the range's first week so the
 * weekly overtime line sees the hours worked before the range starts; the CSV
 * builder only writes rows inside the range itself.
 */
export async function loadHoursExportEntries(
  fromStr: string,
  toStr: string,
  departmentId?: string,
): Promise<HoursExportEntry[]> {
  const from = parseDateOnly(exportLoadFrom(fromStr));
  const to = parseDateOnly(toStr);
  if (!from || !to) throw new Error("Invalid export date range.");
  return db.timeEntry.findMany({
    where: {
      date: { gte: from, lte: to },
      ...(departmentId ? { employee: { departmentId } } : {}),
    },
    select: {
      id: true,
      employeeId: true,
      date: true,
      clockIn: true,
      totalWorkMin: true,
      jobCode: true,
      rate: true,
      source: true,
      approvalStatus: true,
      employee: {
        select: {
          employeeId: true,
          name: true,
          exportCode: true,
          defaultHourlyRate: true,
          compensationType: true,
          department: { select: { name: true } },
        },
      },
    },
    orderBy: [{ date: "asc" }, { clockIn: "asc" }],
  });
}
