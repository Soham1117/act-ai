import { holidayName } from "./holidays";
import type { FindingDraft, WatchPolicy } from "./types";

const MIN = 60_000;
const HOUR = 60 * MIN;

/** One finished (or running) punch, flattened for the rules. `date` is the business day, YYYY-MM-DD. */
export type PunchRow = {
  id: string;
  employeeId: string;
  name: string;
  date: string;
  clockIn: Date;
  clockOut: Date | null;
  workMin: number;
  breakMin: number;
  source: string;
  kioskSlug: string | null;
  hasPhotoIn: boolean;
  hasPhotoOut: boolean;
  actualIn: Date | null;
  actualOut: Date | null;
  notes: string | null;
};

const hours = (min: number) => (min / 60).toFixed(1);
const empLink = (id: string) => `/admin/employees/${id}`;

/** time.missing-clock-in: a shift started and nobody punched in. */
export type ExpectedShift = {
  scheduleId: string;
  employeeId: string;
  name: string;
  start: Date;
  hasEntry: boolean;
  onLeave: boolean;
};
export function evaluateMissingClockIn(rows: ExpectedShift[], now: Date): FindingDraft[] {
  const out: FindingDraft[] = [];
  for (const r of rows) {
    if (r.hasEntry || r.onLeave) continue;
    if (now.getTime() < r.start.getTime() + 30 * MIN) continue;
    out.push({
      fingerprint: `time.missing-clock-in:${r.scheduleId}`,
      severity: "WARN",
      subjectType: "Employee",
      subjectId: r.employeeId,
      employeeId: r.employeeId,
      title: `${r.name} is scheduled but has not clocked in`,
      detail: `Shift started ${Math.floor((now.getTime() - r.start.getTime()) / MIN)} minutes ago and there is no punch today.`,
      likelyCause: "Absent, late, or forgot to punch in.",
      suggestedFix: "Check with the supervisor. If they did work, add the punch; if not, record the absence.",
      fixLink: "/admin/time-tracking",
      evidence: { scheduledStart: r.start.toISOString() },
    });
  }
  return out;
}

/** time.overtime-pace: on track to pass the weekly overtime line. */
export type WeekPace = {
  employeeId: string;
  name: string;
  weekStart: string;
  workedMin: number;
  scheduledRemainingMin: number;
};
export function evaluateOvertimePace(rows: WeekPace[], policy: WatchPolicy): FindingDraft[] {
  const out: FindingDraft[] = [];
  const line = policy.weeklyOvertimeHours * 60;
  for (const r of rows) {
    const projected = r.workedMin + r.scheduledRemainingMin;
    if (projected <= line) continue;
    const already = r.workedMin > line;
    out.push({
      fingerprint: `time.overtime-pace:${r.employeeId}:${r.weekStart}`,
      severity: already ? "WARN" : "INFO",
      subjectType: "Employee",
      subjectId: r.employeeId,
      employeeId: r.employeeId,
      title: already
        ? `${r.name} is over ${policy.weeklyOvertimeHours}h this week`
        : `${r.name} is on track for overtime`,
      detail: already
        ? `${hours(r.workedMin)}h worked so far this week.`
        : `${hours(r.workedMin)}h worked plus ${hours(r.scheduledRemainingMin)}h still scheduled = ${hours(projected)}h.`,
      likelyCause: "Long shifts or extra days on the schedule.",
      suggestedFix: "Shorten remaining shifts if overtime is not wanted, otherwise nothing to do.",
      fixLink: "/admin/schedules",
      evidence: { weekStart: r.weekStart, workedMin: r.workedMin, projectedMin: projected },
    });
  }
  return out;
}

/** time.break-missing and time.break-length. Lunch only: the 15-minute breaks are paid and not logged. */
export function evaluateLunch(entries: PunchRow[], policy: WatchPolicy): FindingDraft[] {
  const out: FindingDraft[] = [];
  for (const e of entries) {
    if (!e.clockOut) continue;
    if (e.workMin > policy.lunchRequiredAfterHours * 60 && e.breakMin === 0) {
      out.push({
        fingerprint: `time.break-missing:${e.id}`,
        severity: "INFO",
        subjectType: "TimeEntry",
        subjectId: e.id,
        employeeId: e.employeeId,
        title: `${e.name}: no lunch logged on a ${hours(e.workMin)}h shift`,
        detail: `${e.date}: no break recorded on a shift over ${policy.lunchRequiredAfterHours}h.`,
        likelyCause: "Lunch not recorded, or worked through lunch.",
        suggestedFix: "Add the lunch to the entry, or note that lunch was skipped.",
        fixLink: "/admin/time-tracking",
        evidence: { workMin: e.workMin, breakMin: e.breakMin },
      });
    } else if (e.breakMin > 0 && (e.breakMin < policy.lunchMinutes - 5 || e.breakMin > 90)) {
      out.push({
        fingerprint: `time.break-length:${e.id}`,
        severity: "INFO",
        subjectType: "TimeEntry",
        subjectId: e.id,
        employeeId: e.employeeId,
        title: `${e.name}: lunch was ${e.breakMin} minutes`,
        detail: `${e.date}: policy lunch is ${policy.lunchMinutes} minutes.`,
        likelyCause: e.breakMin < policy.lunchMinutes ? "Short lunch or a wrong break time." : "Long lunch or a break left open.",
        suggestedFix: "Check the break times on the entry.",
        fixLink: "/admin/time-tracking",
        evidence: { breakMin: e.breakMin },
      });
    }
  }
  return out;
}

/** time.impossible-shift: shift longer than the maximum, or two shifts overlapping. */
export function evaluateImpossibleShifts(entries: PunchRow[], policy: WatchPolicy): FindingDraft[] {
  const out: FindingDraft[] = [];
  const maxMin = policy.maxShiftHours * 60;
  const byPerson = new Map<string, PunchRow[]>();
  for (const e of entries) {
    if (e.clockOut && (e.clockOut.getTime() - e.clockIn.getTime()) / MIN > maxMin) {
      out.push({
        fingerprint: `time.impossible-shift:${e.id}`,
        severity: "CRITICAL",
        subjectType: "TimeEntry",
        subjectId: e.id,
        employeeId: e.employeeId,
        title: `${e.name}: shift longer than ${policy.maxShiftHours}h`,
        detail: `${e.date}: ${hours((e.clockOut.getTime() - e.clockIn.getTime()) / MIN)}h between punch in and out.`,
        likelyCause: "Forgotten clock-out that was fixed late.",
        suggestedFix: "Open the entry and correct the clock-out.",
        fixLink: "/admin/time-tracking",
        evidence: {},
      });
    }
    const list = byPerson.get(e.employeeId) ?? [];
    list.push(e);
    byPerson.set(e.employeeId, list);
  }
  for (const list of byPerson.values()) {
    const sorted = [...list].sort((a, b) => a.clockIn.getTime() - b.clockIn.getTime());
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      if (prev.clockOut && cur.clockIn.getTime() < prev.clockOut.getTime() - MIN) {
        out.push({
          fingerprint: `time.overlap:${prev.id}:${cur.id}`,
          severity: "CRITICAL",
          subjectType: "TimeEntry",
          subjectId: cur.id,
          employeeId: cur.employeeId,
          title: `${cur.name}: two shifts overlap`,
          detail: `${prev.date} and ${cur.date} entries overlap in time.`,
          likelyCause: "Duplicate or mistyped entry.",
          suggestedFix: "Delete or correct one of the two entries.",
          fixLink: "/admin/time-tracking",
          evidence: { ids: [prev.id, cur.id] },
        });
      }
    }
  }
  return out;
}

/** time.duplicate-punch: two punch-ins within two minutes of each other. */
export function evaluateDuplicatePunches(entries: PunchRow[]): FindingDraft[] {
  const out: FindingDraft[] = [];
  const byPerson = new Map<string, PunchRow[]>();
  for (const e of entries) byPerson.set(e.employeeId, [...(byPerson.get(e.employeeId) ?? []), e]);
  for (const list of byPerson.values()) {
    const sorted = [...list].sort((a, b) => a.clockIn.getTime() - b.clockIn.getTime());
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1]!;
      const b = sorted[i]!;
      if (b.clockIn.getTime() - a.clockIn.getTime() <= 2 * MIN) {
        out.push({
          fingerprint: `time.duplicate-punch:${a.id}:${b.id}`,
          severity: "WARN",
          subjectType: "TimeEntry",
          subjectId: b.id,
          employeeId: b.employeeId,
          title: `${b.name}: duplicate punch`,
          detail: `${b.date}: two punch-ins within 2 minutes.`,
          likelyCause: "Double tap on the kiosk.",
          suggestedFix: "Delete the extra entry.",
          fixLink: "/admin/time-tracking",
          evidence: { ids: [a.id, b.id] },
        });
      }
    }
  }
  return out;
}

/** time.new-kiosk: first time this person punches at a kiosk they never used before. */
export function evaluateNewKiosk(
  recent: PunchRow[],
  history: Map<string, { count: number; kiosks: Set<string> }>,
  policy: WatchPolicy,
): FindingDraft[] {
  const out: FindingDraft[] = [];
  for (const e of recent) {
    if (!e.kioskSlug) continue;
    const h = history.get(e.employeeId);
    if (!h || h.count < policy.newKioskMinPriorEntries || h.kiosks.size === 0 || h.kiosks.has(e.kioskSlug)) continue;
    out.push({
      fingerprint: `time.new-kiosk:${e.employeeId}:${e.kioskSlug}`,
      severity: "INFO",
      subjectType: "Employee",
      subjectId: e.employeeId,
      employeeId: e.employeeId,
      title: `${e.name} punched at a kiosk they have not used before`,
      detail: `${e.date}: kiosk "${e.kioskSlug}". Usual: ${[...h.kiosks].join(", ")}.`,
      likelyCause: "Working at another site, or someone else punching for them.",
      suggestedFix: "Confirm they were at that location.",
      fixLink: empLink(e.employeeId),
      evidence: { kiosk: e.kioskSlug },
    });
  }
  return out;
}

/** One summary flag for a group of punches without photos (a flag per person would bury the list). */
function photoSummary(
  rule: string,
  scope: string,
  groups: Map<string, { name: string; count: number }>,
  weekKey: string,
  fixLink: string,
): FindingDraft[] {
  if (groups.size === 0) return [];
  const total = [...groups.values()].reduce((n, g) => n + g.count, 0);
  const top = [...groups.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((g) => `${g.name} (${g.count})`)
    .join(", ");
  return [
    {
      fingerprint: `${rule}:${weekKey}`,
      severity: "INFO",
      subjectType: "Kiosk",
      subjectId: weekKey,
      title: `${total} ${scope} kiosk punch${total === 1 ? "" : "es"} without a photo (${groups.size} ${groups.size === 1 ? "person" : "people"})`,
      detail: `Most affected: ${top}.`,
      likelyCause: "Camera blocked, permission off on the tablet, or the photo upload failed.",
      suggestedFix: "Check the kiosk camera and permissions.",
      fixLink,
      evidence: { total, people: groups.size },
    },
  ];
}

/** time.photo-missing: kiosk punches with no photo, summed over the window. */
export function evaluatePhotoMissing(entries: PunchRow[], weekKey: string): FindingDraft[] {
  const groups = new Map<string, { name: string; count: number }>();
  for (const e of entries) {
    if (e.source !== "KIOSK") continue;
    if (e.hasPhotoIn && (e.clockOut === null || e.hasPhotoOut)) continue;
    const g = groups.get(e.employeeId) ?? { name: e.name, count: 0 };
    g.count++;
    groups.set(e.employeeId, g);
  }
  return photoSummary("time.photo-missing", "employee", groups, weekKey, "/admin/kiosks");
}

/** time.early-arrival-pattern: punching in well before the schedule, again and again. */
export type EarlyRow = { employeeId: string; name: string; date: string; minutesEarly: number };
export function evaluateEarlyArrival(rows: EarlyRow[], policy: WatchPolicy, windowKey: string): FindingDraft[] {
  const per = new Map<string, { name: string; days: number }>();
  for (const r of rows) {
    if (r.minutesEarly < policy.earlyArrivalMinutes) continue;
    const p = per.get(r.employeeId) ?? { name: r.name, days: 0 };
    p.days++;
    per.set(r.employeeId, p);
  }
  return [...per.entries()]
    .filter(([, p]) => p.days >= policy.earlyArrivalCount)
    .map(([id, p]) => ({
      fingerprint: `time.early-arrival-pattern:${id}:${windowKey}`,
      severity: "INFO" as const,
      subjectType: "Employee",
      subjectId: id,
      employeeId: id,
      title: `${p.name} often punches in early`,
      detail: `${p.days} days with a punch-in ${policy.earlyArrivalMinutes}+ minutes before the scheduled start.`,
      likelyCause: "Arriving early, or hours padded before the shift.",
      suggestedFix: "Decide if early time is paid; talk to the supervisor.",
      fixLink: empLink(id),
      evidence: { days: p.days },
    }));
}

/** time.rounding-drift: rounding always lands in one direction. Needs raw punch times. */
export function evaluateRoundingDrift(entries: PunchRow[]): FindingDraft[] {
  const per = new Map<string, { name: string; favor: number; total: number; minutes: number }>();
  for (const e of entries) {
    if (!e.actualIn || !e.actualOut || !e.clockOut) continue;
    // Positive = rounding gave the employee more paid time.
    const gain = (e.actualIn.getTime() - e.clockIn.getTime() + (e.clockOut.getTime() - e.actualOut.getTime())) / MIN;
    if (gain === 0) continue;
    const p = per.get(e.employeeId) ?? { name: e.name, favor: 0, total: 0, minutes: 0 };
    p.total++;
    if (gain > 0) p.favor++;
    p.minutes += gain;
    per.set(e.employeeId, p);
  }
  const out: FindingDraft[] = [];
  for (const [id, p] of per) {
    if (p.total < 10) continue;
    const ratio = p.favor / p.total;
    if (ratio < 0.8 && ratio > 0.2) continue;
    out.push({
      fingerprint: `time.rounding-drift:${id}`,
      severity: "INFO",
      subjectType: "Employee",
      subjectId: id,
      employeeId: id,
      title: `${p.name}: rounding mostly goes ${ratio >= 0.5 ? "in their favor" : "against them"}`,
      detail: `${Math.round(ratio * 100)}% of ${p.total} rounded shifts, ${Math.round(p.minutes)} minutes in total.`,
      likelyCause: "Punch habits that line up with rounding boundaries.",
      suggestedFix: "Review the rounding rule or the pattern with the supervisor.",
      fixLink: empLink(id),
      evidence: { total: p.total, favor: p.favor },
    });
  }
  return out;
}

/** time.holiday-work: worked on a major US holiday with no note on the entry. */
export function evaluateHolidayWork(entries: PunchRow[]): FindingDraft[] {
  const out: FindingDraft[] = [];
  for (const e of entries) {
    const name = holidayName(e.date);
    if (!name || (e.notes && e.notes.trim())) continue;
    out.push({
      fingerprint: `time.holiday-work:${e.id}`,
      severity: "INFO",
      subjectType: "TimeEntry",
      subjectId: e.id,
      employeeId: e.employeeId,
      title: `${e.name} worked on ${name}`,
      detail: `${e.date}: ${hours(e.workMin)}h with no manager note.`,
      likelyCause: "Planned holiday shift, or a mistaken entry.",
      suggestedFix: "Add a note, and check holiday pay rules.",
      fixLink: "/admin/time-tracking",
      evidence: { holiday: name },
    });
  }
  return out;
}

/** time.schedule-variance: worked hours differ a lot from the scheduled hours. */
export type WeekVariance = { employeeId: string; name: string; weekStart: string; scheduledMin: number; workedMin: number };
export function evaluateScheduleVariance(rows: WeekVariance[], policy: WatchPolicy): FindingDraft[] {
  return rows
    .filter((r) => r.scheduledMin > 0 && Math.abs(r.workedMin - r.scheduledMin) >= policy.scheduleVarianceHours * 60)
    .map((r) => ({
      fingerprint: `time.schedule-variance:${r.employeeId}:${r.weekStart}`,
      severity: "INFO" as const,
      subjectType: "Employee",
      subjectId: r.employeeId,
      employeeId: r.employeeId,
      title: `${r.name}: ${hours(r.workedMin)}h worked vs ${hours(r.scheduledMin)}h scheduled`,
      detail: `Week of ${r.weekStart}.`,
      likelyCause: "Extra or missed shifts, or the schedule was not updated.",
      suggestedFix: "Check the schedule and the timesheet for that week.",
      fixLink: "/admin/schedules",
      evidence: { scheduledMin: r.scheduledMin, workedMin: r.workedMin },
    }));
}

/** Contract crew: no photo, no job code, or a job code different from their usual one. */
export type ContractPunch = {
  id: string;
  workerId: string;
  name: string;
  date: string;
  jobCode: string;
  workerJobCode: string | null;
  hasPhotoIn: boolean;
  /** Photos only exist for kiosk punches; hand-entered hours never have one. */
  viaKiosk: boolean;
};
export function evaluateContractEntries(entries: ContractPunch[], weekKey: string): FindingDraft[] {
  const out: FindingDraft[] = [];
  const noPhoto = new Map<string, { name: string; count: number }>();
  for (const e of entries) {
    if (e.viaKiosk && !e.hasPhotoIn) {
      noPhoto.set(e.workerId, { name: e.name, count: (noPhoto.get(e.workerId)?.count ?? 0) + 1 });
    }
    if (!e.jobCode.trim()) {
      out.push({
        fingerprint: `contract.jobcode-missing:${e.id}`,
        severity: "WARN",
        subjectType: "ContractTimeEntry",
        subjectId: e.id,
        title: `${e.name}: contract entry with no job code`,
        detail: `${e.date}: hours cannot be billed to a job.`,
        likelyCause: "Entry created without a job code.",
        suggestedFix: "Set the job code on the entry.",
        fixLink: "/admin/contract-workers",
        evidence: {},
      });
    } else if (e.workerJobCode && e.jobCode.trim() !== e.workerJobCode.trim()) {
      out.push({
        fingerprint: `contract.jobcode-mismatch:${e.id}`,
        severity: "INFO",
        subjectType: "ContractTimeEntry",
        subjectId: e.id,
        title: `${e.name}: worked under ${e.jobCode}, usually ${e.workerJobCode}`,
        detail: `${e.date}: job code differs from the worker's usual code.`,
        likelyCause: "Moved to another task or department, or a wrong code.",
        suggestedFix: "Confirm the job code so the hours are billed correctly.",
        fixLink: "/admin/contract-workers",
        evidence: { jobCode: e.jobCode, usual: e.workerJobCode },
      });
    }
  }
  out.push(...photoSummary("contract.photo-missing", "contract", noPhoto, weekKey, "/admin/contract-workers"));
  return out;
}

/** contract.long-tenure: contract worker has been on site longer than the review limit. */
export type TenureRow = { id: string; name: string; agency: string; startDate: Date };
export function evaluateContractTenure(rows: TenureRow[], policy: WatchPolicy, now: Date): FindingDraft[] {
  return rows
    .map((r) => ({ r, days: Math.floor((now.getTime() - r.startDate.getTime()) / (24 * HOUR)) }))
    .filter((x) => x.days >= policy.contractTenureDays)
    .map(({ r, days }) => ({
      fingerprint: `contract.long-tenure:${r.id}`,
      severity: "INFO" as const,
      subjectType: "ContractWorker",
      subjectId: r.id,
      title: `${r.name} (${r.agency}) has been here ${days} days`,
      detail: `Past the ${policy.contractTenureDays}-day review point.`,
      likelyCause: "Long assignment that may be a permanent role.",
      suggestedFix: "Decide whether to convert to an employee or renew with the agency.",
      fixLink: "/admin/contract-workers",
      evidence: { days },
    }));
}
