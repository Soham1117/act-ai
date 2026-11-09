import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { computeEntryTotals, ADMIN_MAX_SHIFT_MS } from "@/lib/time-rules";

export async function adminWatchProposals() {
  await requireAdmin();
  const proposals = await db.watchProposal.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  const employees = await db.employee.findMany({
    where: { id: { in: [...new Set(proposals.map((p) => p.employeeId))] } },
    select: { id: true, name: true, employeeId: true },
  });
  const people = new Map(employees.map((e) => [e.id, e]));
  return proposals.map((p) => {
    const before = p.before as { date: string; clockIn: string; clockOut: string | null; totalWorkMin: number; totalBreakMin: number; jobCode: string; breaks: { startTime: string; endTime: string | null }[] };
    const proposed = computeEntryTotals({
      clockIn: new Date(before.clockIn),
      clockOut: p.proposedClockOut,
      breaks: before.breaks.map((b) => ({ startTime: new Date(b.startTime), endTime: b.endTime ? new Date(b.endTime) : null })),
      maxShiftMs: ADMIN_MAX_SHIFT_MS,
    });
    const evidence = p.evidence as { scheduleId?: string; scheduleUpdatedAt?: string };
    return {
      id: p.id, status: p.status, entryId: p.entryId, employeeId: p.employeeId, date: before.date.slice(0, 10),
      name: people.get(p.employeeId)?.name ?? "Deleted employee",
      employeeCode: people.get(p.employeeId)?.employeeId ?? p.employeeId,
      clockIn: before.clockIn, originalClockOut: before.clockOut,
      proposedClockOut: p.proposedClockOut.toISOString(),
      proposedWorkMin: proposed.totalWorkMin, breakMin: proposed.totalBreakMin,
      jobCode: before.jobCode, reason: p.reason, lastError: p.lastError,
      scheduleId: evidence.scheduleId ?? null,
      scheduleUpdatedAt: evidence.scheduleUpdatedAt ?? null,
      createdAt: p.createdAt.toISOString(), decidedAt: p.decidedAt?.toISOString() ?? null,
    };
  });
}

export type WatchProposalRow = Awaited<ReturnType<typeof adminWatchProposals>>[number];
