import type { FindingDraft, WatchPolicy } from "./types";

const MIN = 60_000;
const HOUR = 60 * MIN;

export type OpenPunch = {
  entryId: string;
  employeeId: string;
  employeeName: string;
  clockIn: Date;
  /** End of today's scheduled shift, when one exists. */
  scheduledEnd: Date | null;
};

/** time.missing-clock-out: punched in, never punched out. */
export function evaluateMissingClockOut(
  punches: OpenPunch[],
  policy: WatchPolicy,
  now: Date,
  periodClosesSoon: boolean,
): FindingDraft[] {
  const out: FindingDraft[] = [];
  for (const p of punches) {
    const ageMs = now.getTime() - p.clockIn.getTime();
    const pastSchedule =
      p.scheduledEnd !== null &&
      now.getTime() > p.scheduledEnd.getTime() + policy.missingClockOutGraceMin * MIN;
    const tooLong = ageMs > 12 * HOUR;
    if (!pastSchedule && !tooLong) continue;
    out.push({
      fingerprint: `time.missing-clock-out:${p.entryId}`,
      severity: periodClosesSoon || ageMs > policy.maxShiftHours * HOUR ? "CRITICAL" : "WARN",
      subjectType: "TimeEntry",
      subjectId: p.entryId,
      employeeId: p.employeeId,
      title: `${p.employeeName} has no clock-out`,
      detail: `Clocked in ${Math.floor(ageMs / HOUR)}h ${Math.floor((ageMs % HOUR) / MIN)}m ago and no clock-out is recorded.`,
      likelyCause: "Forgot to punch out, or the kiosk tap did not register.",
      suggestedFix: "Open the entry and set the clock-out from the real shift end.",
      fixLink: "/admin/time-tracking",
      evidence: {
        clockIn: p.clockIn.toISOString(),
        scheduledEnd: p.scheduledEnd?.toISOString() ?? null,
        ageMinutes: Math.floor(ageMs / MIN),
      },
    });
  }
  return out;
}

export type PeriodBlockers = {
  periodId: string;
  title: string;
  periodEnd: Date;
  closedAt: Date | null;
  pendingApprovals: number;
  openPunches: number;
};

const CLOSE_WATCH_DAYS = 3;

/** payroll.close-blockers: things that stop a period from closing cleanly. */
export function evaluateCloseBlockers(p: PeriodBlockers, now: Date): FindingDraft[] {
  if (p.closedAt) return [];
  const total = p.pendingApprovals + p.openPunches;
  if (total === 0) return [];
  const daysToEnd = (p.periodEnd.getTime() - now.getTime()) / (24 * HOUR);
  // Nothing to chase until close is near; before that, pending items are normal.
  if (daysToEnd > CLOSE_WATCH_DAYS) return [];
  return [
    {
      fingerprint: `payroll.close-blockers:${p.periodId}`,
      severity: daysToEnd <= 2 ? "CRITICAL" : "WARN",
      subjectType: "PayrollCalendar",
      subjectId: p.periodId,
      title: `${p.title}: ${total} item${total === 1 ? "" : "s"} block closing`,
      detail: `${p.pendingApprovals} timesheet${p.pendingApprovals === 1 ? "" : "s"} waiting for approval and ${p.openPunches} open punch${p.openPunches === 1 ? "" : "es"}.`,
      likelyCause: "Approvals not done yet, or forgotten clock-outs.",
      suggestedFix: "Approve pending timesheets and fix open punches before exporting.",
      fixLink: "/admin/hours/timesheets",
      evidence: {
        pendingApprovals: p.pendingApprovals,
        openPunches: p.openPunches,
        daysToPeriodEnd: Math.round(daysToEnd * 10) / 10,
      },
    },
  ];
}

/** payPeriodEnd is a date-only value (UTC midnight); the period is over once that whole day has passed. */
export function periodHasEnded(periodEnd: Date, now: Date): boolean {
  return now.getTime() >= periodEnd.getTime() + HOUR * 24;
}

export type PeriodHours = {
  employeeId: string;
  employeeName: string;
  periodId: string;
  currentMinutes: number;
  previousMinutes: number;
};

/** payroll.hours-variance: hours moved a lot versus the previous period. Hours only, no pay amounts. */
export function evaluateHoursVariance(rows: PeriodHours[], policy: WatchPolicy): FindingDraft[] {
  const out: FindingDraft[] = [];
  for (const r of rows) {
    if (r.previousMinutes <= 0) continue;
    const diffMin = r.currentMinutes - r.previousMinutes;
    const pct = (Math.abs(diffMin) / r.previousMinutes) * 100;
    if (Math.abs(diffMin) < policy.hoursVarianceMinHours * 60) continue;
    if (pct < policy.hoursVariancePct) continue;
    const cur = (r.currentMinutes / 60).toFixed(1);
    const prev = (r.previousMinutes / 60).toFixed(1);
    out.push({
      fingerprint: `payroll.hours-variance:${r.periodId}:${r.employeeId}`,
      severity: "WARN",
      subjectType: "Employee",
      subjectId: r.employeeId,
      employeeId: r.employeeId,
      title: `${r.employeeName}: hours ${diffMin > 0 ? "up" : "down"} ${Math.round(pct)}%`,
      detail: `${cur}h this period vs ${prev}h last period.`,
      likelyCause:
        diffMin > 0
          ? "Extra shifts, overtime, or a duplicate entry."
          : "Missing punches, leave, or fewer shifts.",
      suggestedFix: "Open the employee's timesheet and confirm the hours look right.",
      fixLink: "/admin/hours/timesheets",
      evidence: {
        currentMinutes: r.currentMinutes,
        previousMinutes: r.previousMinutes,
        pct: Math.round(pct),
      },
    });
  }
  return out;
}

export type PersonRow = { id: string; name: string };

function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** data.duplicate-employee: same person, spelled differently. Flag only, never merge. */
export function evaluateDuplicateEmployees(people: PersonRow[]): FindingDraft[] {
  const out: FindingDraft[] = [];
  const parsed = people
    .map((p) => ({ p, t: tokens(p.name) }))
    .filter((x) => x.t.length >= 2);
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      const a = parsed[i];
      const b = parsed[j];
      const sameSorted = [...a.t].sort().join(" ") === [...b.t].sort().join(" ");
      const sameLast = a.t[a.t.length - 1] === b.t[b.t.length - 1];
      const firstClose =
        a.t[0].length >= 4 &&
        b.t[0].length >= 4 &&
        a.t[0][0] === b.t[0][0] &&
        withinOneEdit(a.t[0], b.t[0]);
      if (!sameSorted && !(sameLast && firstClose)) continue;
      const [x, y] = [a.p, b.p].sort((m, n) => (m.id < n.id ? -1 : 1));
      out.push({
        fingerprint: `data.duplicate-employee:${x.id}:${y.id}`,
        severity: "WARN",
        subjectType: "Employee",
        subjectId: x.id,
        title: `Possible duplicate: ${a.p.name} / ${b.p.name}`,
        detail: "Two employee records have nearly the same name.",
        likelyCause: "Same person entered twice with different spelling (import or nickname).",
        suggestedFix:
          "Compare the two records. If they are the same person, merge by hand; if not, dismiss this flag.",
        fixLink: `/admin/employees/${x.id}`,
        evidence: { ids: [x.id, y.id] },
      });
    }
  }
  return out;
}
