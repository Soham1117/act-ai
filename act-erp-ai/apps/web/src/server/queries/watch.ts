import { db } from "@/lib/db";

export type WatchRow = {
  id: string;
  ruleId: string;
  severity: "INFO" | "WARN" | "CRITICAL";
  status: "OPEN" | "ACKNOWLEDGED" | "SNOOZED" | "RESOLVED" | "DISMISSED";
  title: string;
  detail: string;
  likelyCause: string | null;
  suggestedFix: string | null;
  fixLink: string | null;
  employeeName: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  snoozeUntil: string | null;
  handledNote: string | null;
};

/** Everything the Watch page needs. Employee names are looked up here, never stored on a flag. */
export async function adminWatchData() {
  const [findings, lastRun, resolvedWeek] = await Promise.all([
    db.watchFinding.findMany({
      where: { status: { not: "RESOLVED" } },
      orderBy: [{ severity: "desc" }, { firstSeenAt: "asc" }],
      take: 500,
    }),
    db.watchRun.findFirst({ where: { finishedAt: { not: null } }, orderBy: { startedAt: "desc" } }),
    db.watchFinding.count({
      where: { status: "RESOLVED", resolvedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
    }),
  ]);
  const ids = [...new Set(findings.map((f) => f.employeeId).filter((v): v is string => !!v))];
  const people = ids.length
    ? await db.employee.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  const names = new Map(people.map((p) => [p.id, p.name]));
  const rows: WatchRow[] = findings.map((f) => ({
    id: f.id,
    ruleId: f.ruleId,
    severity: f.severity,
    status: f.status,
    title: f.title,
    detail: f.detail,
    likelyCause: f.likelyCause,
    suggestedFix: f.suggestedFix,
    fixLink: f.fixLink,
    employeeName: f.employeeId ? (names.get(f.employeeId) ?? null) : null,
    firstSeenAt: f.firstSeenAt.toISOString(),
    lastSeenAt: f.lastSeenAt.toISOString(),
    snoozeUntil: f.snoozeUntil?.toISOString() ?? null,
    handledNote: f.handledNote,
  }));
  return {
    rows,
    resolvedThisWeek: resolvedWeek,
    lastRunAt: lastRun?.finishedAt?.toISOString() ?? null,
    lastRunErrors: Array.isArray(lastRun?.errors) ? (lastRun.errors as unknown[]).length : 0,
  };
}
