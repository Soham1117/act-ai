import { db } from "@/lib/db";
import { businessLocalToDate, dateOnlyToString } from "@/lib/time-rules";
import {
  evaluateCloseBlockers,
  evaluateDuplicateEmployees,
  evaluateHoursVariance,
  evaluateMissingClockOut,
  type PeriodHours,
} from "@/lib/watch/rules";
import { mergePolicy, type FindingDraft, type WatchPolicy } from "@/lib/watch/types";

const POLICY_ID = "policy";
const STALE_RUN_MS = 10 * 60_000;

export async function loadPolicy(): Promise<WatchPolicy> {
  const row = await db.watchRuleConfig.findUnique({ where: { ruleId: POLICY_ID } });
  return mergePolicy(row?.params);
}

async function isEnabled(ruleId: string): Promise<boolean> {
  const row = await db.watchRuleConfig.findUnique({ where: { ruleId } });
  return row?.enabled ?? true;
}

type RuleJob = { id: string; run: (ctx: { now: Date; policy: WatchPolicy }) => Promise<FindingDraft[]> };

/** The period the manager is working on now (CURRENT, else the newest not yet closed). */
async function currentPeriod() {
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

const DAY_MS = 24 * 60 * 60_000;

const JOBS: RuleJob[] = [
  {
    id: "time.missing-clock-out",
    async run({ now, policy }) {
      const open = await db.timeEntry.findMany({
        where: { clockOut: null, status: { in: ["ACTIVE", "ON_BREAK"] } },
        select: {
          id: true,
          employeeId: true,
          clockIn: true,
          date: true,
          employee: { select: { name: true } },
        },
      });
      if (open.length === 0) return [];
      const schedules = await db.schedule.findMany({
        where: {
          OR: open.map((e) => ({ employeeId: e.employeeId, date: e.date })),
        },
        select: { employeeId: true, date: true, endTime: true },
      });
      const period = await currentPeriod();
      const closesSoon = period ? period.payPeriodEnd.getTime() - now.getTime() <= 2 * DAY_MS : false;
      const punches = open.map((e) => {
        const s = schedules.find(
          (x) => x.employeeId === e.employeeId && x.date.getTime() === e.date.getTime(),
        );
        const scheduledEnd = s ? businessLocalToDate(`${dateOnlyToString(e.date)}T${s.endTime}`) : null;
        return {
          entryId: e.id,
          employeeId: e.employeeId,
          employeeName: e.employee.name,
          clockIn: e.clockIn,
          scheduledEnd,
        };
      });
      return evaluateMissingClockOut(punches, policy, now, closesSoon);
    },
  },
  {
    id: "payroll.close-blockers",
    async run({ now }) {
      const p = await currentPeriod();
      if (!p) return [];
      const range = { gte: p.payPeriodStart, lte: p.payPeriodEnd };
      const [pendingApprovals, openPunches] = await Promise.all([
        db.timeEntry.count({
          where: { date: range, approvalStatus: "PENDING", clockOut: { not: null } },
        }),
        db.timeEntry.count({ where: { date: range, clockOut: null } }),
      ]);
      return evaluateCloseBlockers(
        {
          periodId: p.id,
          title: p.title,
          periodEnd: p.payPeriodEnd,
          closedAt: p.closedAt,
          pendingApprovals,
          openPunches,
        },
        now,
      );
    },
  },
  {
    id: "payroll.hours-variance",
    async run({ policy }) {
      const p = await currentPeriod();
      if (!p) return [];
      const lengthMs = p.payPeriodEnd.getTime() - p.payPeriodStart.getTime() + DAY_MS;
      const prevStart = new Date(p.payPeriodStart.getTime() - lengthMs);
      const prevEnd = new Date(p.payPeriodStart.getTime() - DAY_MS);
      const sums = async (from: Date, to: Date) => {
        const rows = await db.timeEntry.groupBy({
          by: ["employeeId"],
          where: { date: { gte: from, lte: to }, clockOut: { not: null } },
          _sum: { totalWorkMin: true },
        });
        return new Map(rows.map((r) => [r.employeeId, r._sum.totalWorkMin ?? 0]));
      };
      const [cur, prev] = await Promise.all([
        sums(p.payPeriodStart, p.payPeriodEnd),
        sums(prevStart, prevEnd),
      ]);
      const names = await db.employee.findMany({
        where: { id: { in: [...prev.keys()] }, employmentStatus: "ACTIVE" },
        select: { id: true, name: true },
      });
      const rows: PeriodHours[] = names.map((n) => ({
        employeeId: n.id,
        employeeName: n.name,
        periodId: p.id,
        currentMinutes: cur.get(n.id) ?? 0,
        previousMinutes: prev.get(n.id) ?? 0,
      }));
      return evaluateHoursVariance(rows, policy);
    },
  },
  {
    id: "data.duplicate-employee",
    async run() {
      const people = await db.employee.findMany({
        where: { employmentStatus: { in: ["ACTIVE", "ON_LEAVE", "INACTIVE"] } },
        select: { id: true, name: true },
      });
      return evaluateDuplicateEmployees(people);
    },
  },
];

export type WatchRunResult = {
  runId: string;
  skipped?: "already-running";
  created: number;
  updated: number;
  autoResolved: number;
  errors: Array<{ ruleId: string; message: string }>;
};

/**
 * Runs every enabled rule, stores findings, auto-resolves the ones that are no
 * longer true. Read-only with respect to everything except Watch tables.
 */
export async function runWatch(opts: { trigger: "SCHEDULE" | "MANUAL"; shadow?: boolean; now?: Date }): Promise<WatchRunResult> {
  const now = opts.now ?? new Date();
  const running = await db.watchRun.findFirst({
    where: { finishedAt: null, startedAt: { gt: new Date(now.getTime() - STALE_RUN_MS) } },
  });
  if (running) {
    return { runId: running.id, skipped: "already-running", created: 0, updated: 0, autoResolved: 0, errors: [] };
  }
  const run = await db.watchRun.create({ data: { trigger: opts.trigger, shadow: opts.shadow ?? true } });
  const policy = await loadPolicy();
  const errors: WatchRunResult["errors"] = [];
  const rulesRun: string[] = [];
  let created = 0;
  let updated = 0;
  let autoResolved = 0;

  for (const job of JOBS) {
    if (!(await isEnabled(job.id))) continue;
    try {
      const drafts = await job.run({ now, policy });
      rulesRun.push(job.id);
      const counts = await storeFindings(job.id, drafts, now);
      created += counts.created;
      updated += counts.updated;
      autoResolved += counts.autoResolved;
    } catch (err) {
      errors.push({ ruleId: job.id, message: (err instanceof Error ? err.message : String(err)).slice(0, 500) });
    }
  }

  await db.watchRun.update({
    where: { id: run.id },
    data: { finishedAt: new Date(), created, updated, autoResolved, rulesRun, errors },
  });
  return { runId: run.id, created, updated, autoResolved, errors };
}

async function storeFindings(ruleId: string, drafts: FindingDraft[], now: Date) {
  let created = 0;
  let updated = 0;
  const seen = new Set<string>();
  for (const d of drafts) {
    seen.add(d.fingerprint);
    const existing = await db.watchFinding.findUnique({ where: { fingerprint: d.fingerprint } });
    const content = {
      severity: d.severity,
      title: d.title,
      detail: d.detail,
      likelyCause: d.likelyCause ?? null,
      suggestedFix: d.suggestedFix ?? null,
      fixLink: d.fixLink ?? null,
      evidence: d.evidence as object,
      lastSeenAt: now,
    };
    if (!existing) {
      await db.watchFinding.create({
        data: {
          ruleId,
          fingerprint: d.fingerprint,
          subjectType: d.subjectType,
          subjectId: d.subjectId,
          employeeId: d.employeeId ?? null,
          firstSeenAt: now,
          ...content,
        },
      });
      created++;
      continue;
    }
    // Dismissed stays dismissed. Resolved reopens (the problem came back).
    // Snoozed stays quiet until snoozeUntil passes.
    let status = existing.status;
    if (status === "RESOLVED") status = "OPEN";
    if (status === "SNOOZED" && existing.snoozeUntil && existing.snoozeUntil <= now) status = "OPEN";
    await db.watchFinding.update({
      where: { id: existing.id },
      data: { ...content, status, resolvedAt: status === "OPEN" ? null : existing.resolvedAt },
    });
    updated++;
  }
  const stale = await db.watchFinding.updateMany({
    where: {
      ruleId,
      status: { in: ["OPEN", "ACKNOWLEDGED", "SNOOZED"] },
      fingerprint: { notIn: [...seen] },
    },
    data: { status: "RESOLVED", resolvedAt: now },
  });
  return { created, updated, autoResolved: stale.count };
}
