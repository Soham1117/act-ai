import type { FindingDraft } from "./types";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const hours = (min: number) => (min / 60).toFixed(1);

/** payroll.hours-total-spike: the finished period has far more hours than the recent average. */
export type PeriodTotal = { periodId: string; title: string; minutes: number };
export function evaluateHoursTotalSpike(current: PeriodTotal, previous: PeriodTotal[]): FindingDraft[] {
  const usable = previous.filter((p) => p.minutes > 0);
  if (usable.length < 2) return [];
  const avg = usable.reduce((n, p) => n + p.minutes, 0) / usable.length;
  const diff = current.minutes - avg;
  if (diff < avg * 0.1 || diff < 20 * 60) return [];
  return [
    {
      fingerprint: `payroll.hours-total-spike:${current.periodId}`,
      severity: "WARN",
      subjectType: "PayrollCalendar",
      subjectId: current.periodId,
      title: `${current.title}: total hours ${Math.round((diff / avg) * 100)}% above recent average`,
      detail: `${hours(current.minutes)}h this period vs ${hours(avg)}h average of the last ${usable.length}.`,
      likelyCause: "Extra headcount, overtime, or duplicate or manual entries.",
      suggestedFix: "Review the biggest increases per person before closing.",
      fixLink: "/admin/hours/timesheets",
      evidence: { currentMinutes: current.minutes, averageMinutes: Math.round(avg) },
    },
  ];
}

/** payroll.entry-sanity: finished entries whose numbers do not add up. */
export type SanityRow = {
  id: string;
  employeeId: string;
  name: string;
  date: string;
  clockIn: Date;
  clockOut: Date;
  workMin: number;
  breakMin: number;
  source: string;
};
export function evaluateEntrySanity(rows: SanityRow[]): FindingDraft[] {
  const out: FindingDraft[] = [];
  for (const r of rows) {
    const spanMin = (r.clockOut.getTime() - r.clockIn.getTime()) / MIN;
    if (spanMin > 0 && spanMin < 5 && r.workMin <= 0) {
      // Tap in, tap out: kiosk testing or a mistaken punch. Pays nothing, so only a note.
      out.push({
        fingerprint: `payroll.entry-zero:${r.id}`,
        severity: "INFO",
        subjectType: "TimeEntry",
        subjectId: r.id,
        employeeId: r.employeeId,
        title: `${r.name}: very short entry (${Math.round(spanMin * 60)} seconds)`,
        detail: `${r.date}: clocked in and out almost at once, 0 hours recorded.`,
        likelyCause: "Kiosk test or an accidental punch.",
        suggestedFix: "Delete the entry if it was a test.",
        fixLink: "/admin/time-tracking",
        evidence: { spanSeconds: Math.round(spanMin * 60) },
      });
    } else if (spanMin <= 0 || r.workMin <= 0) {
      out.push({
        fingerprint: `payroll.entry-zero:${r.id}`,
        severity: "CRITICAL",
        subjectType: "TimeEntry",
        subjectId: r.id,
        employeeId: r.employeeId,
        title: `${r.name}: entry with zero or negative hours`,
        detail: `${r.date}: ${hours(r.workMin)}h recorded.`,
        likelyCause: "Clock-out at or before clock-in, or a break longer than the shift.",
        suggestedFix: "Correct or delete the entry.",
        fixLink: "/admin/time-tracking",
        evidence: { workMin: r.workMin, spanMin: Math.round(spanMin) },
      });
    } else if (r.source !== "TCP" && Math.abs(spanMin - r.breakMin - r.workMin) > 2) {
      out.push({
        fingerprint: `payroll.entry-mismatch:${r.id}`,
        severity: "WARN",
        subjectType: "TimeEntry",
        subjectId: r.id,
        employeeId: r.employeeId,
        title: `${r.name}: stored hours do not match the punches`,
        detail: `${r.date}: ${hours(r.workMin)}h stored vs ${hours(spanMin - r.breakMin)}h from punch times and breaks.`,
        likelyCause: "Edited punch times without recalculating, or a manual hours entry.",
        suggestedFix: "Open the entry and save it again so totals are recalculated.",
        fixLink: "/admin/time-tracking",
        evidence: { workMin: r.workMin, expectedMin: Math.round(spanMin - r.breakMin) },
      });
    }
  }
  return out;
}

/** payroll.duplicate-paystub: two pay documents for the same person, period and category. */
export type PaystubRow = {
  id: string;
  employeeId: string;
  name: string;
  category: string;
  start: string;
  end: string;
  sha: string | null;
};
export function evaluateDuplicatePaystubs(rows: PaystubRow[]): FindingDraft[] {
  const groups = new Map<string, PaystubRow[]>();
  for (const r of rows) {
    const k = `${r.employeeId}|${r.category}|${r.start}|${r.end}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out: FindingDraft[] = [];
  for (const [k, list] of groups) {
    if (list.length < 2) continue;
    const first = list[0]!;
    out.push({
      fingerprint: `payroll.duplicate-paystub:${k}`,
      severity: "WARN",
      subjectType: "Employee",
      subjectId: first.employeeId,
      employeeId: first.employeeId,
      title: `${first.name}: ${list.length} ${first.category} documents for ${first.start} to ${first.end}`,
      detail: list.some((l) => l.sha && l.sha !== first.sha) ? "The files differ." : "The files are identical.",
      likelyCause: "Imported twice, or a corrected stub added next to the original.",
      suggestedFix: "Keep the correct one and delete the other.",
      fixLink: `/admin/employees/${first.employeeId}`,
      evidence: { ids: list.map((l) => l.id) },
    });
  }
  return out;
}

/** payroll.terminated-with-hours: hours dated after a termination date. */
export type TermHours = { employeeId: string; name: string; terminationDate: string; lastEntryDate: string; entries: number };
export function evaluateTerminatedWithHours(rows: TermHours[]): FindingDraft[] {
  return rows.map((r) => ({
    fingerprint: `payroll.terminated-with-hours:${r.employeeId}:${r.terminationDate}`,
    severity: "CRITICAL" as const,
    subjectType: "Employee",
    subjectId: r.employeeId,
    employeeId: r.employeeId,
    title: `${r.name}: ${r.entries} entr${r.entries === 1 ? "y" : "ies"} after the termination date`,
    detail: `Terminated ${r.terminationDate}; latest entry ${r.lastEntryDate}.`,
    likelyCause: "Termination date entered wrongly, or entries for the wrong person.",
    suggestedFix: "Check the termination date and the entries.",
    fixLink: `/admin/employees/${r.employeeId}`,
    evidence: { entries: r.entries },
  }));
}

/** payroll.new-hire-forms: hours worked while W-4 or I-9 is still not accepted. */
export type NewHireForms = { employeeId: string; name: string; hireDate: string; missing: string[] };
export function evaluateNewHireForms(rows: NewHireForms[]): FindingDraft[] {
  return rows
    .filter((r) => r.missing.length > 0)
    .map((r) => ({
      fingerprint: `payroll.new-hire-forms:${r.employeeId}`,
      severity: "WARN" as const,
      subjectType: "Employee",
      subjectId: r.employeeId,
      employeeId: r.employeeId,
      title: `${r.name} has hours but ${r.missing.join(" and ")} not accepted`,
      detail: `Hired ${r.hireDate}.`,
      likelyCause: "Paperwork not submitted or not reviewed yet.",
      suggestedFix: "Review the onboarding checklist for this person.",
      fixLink: "/admin/onboarding/checklists",
      evidence: { missing: r.missing },
    }));
}

/** payroll.reimbursement-unpaid: approved a while ago, not paid yet. */
export type UnpaidReimb = { id: string; employeeId: string; name: string; title: string; approvedDays: number };
export function evaluateUnpaidReimbursements(rows: UnpaidReimb[]): FindingDraft[] {
  return rows
    .filter((r) => r.approvedDays >= 14)
    .map((r) => ({
      fingerprint: `payroll.reimbursement-unpaid:${r.id}`,
      severity: "INFO" as const,
      subjectType: "Reimbursement",
      subjectId: r.id,
      employeeId: r.employeeId,
      title: `${r.name}: "${r.title}" approved ${r.approvedDays} days ago, not paid`,
      detail: "Approved but no paid date recorded.",
      likelyCause: "Not added to a payroll run, or paid but not marked.",
      suggestedFix: "Mark it paid or add it to the next payroll.",
      fixLink: "/admin/reimbursements",
      evidence: { approvedDays: r.approvedDays },
    }));
}

/** payroll.period-gap: pay periods that overlap or leave days uncovered. */
export type CalendarRow = { id: string; title: string; start: Date; end: Date };
export function evaluatePeriodGaps(rows: CalendarRow[]): FindingDraft[] {
  const sorted = [...rows].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: FindingDraft[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    const expected = prev.end.getTime() + DAY;
    if (cur.start.getTime() === expected) continue;
    const gapDays = Math.round((cur.start.getTime() - expected) / DAY);
    out.push({
      fingerprint: `payroll.period-gap:${prev.id}:${cur.id}`,
      severity: "WARN",
      subjectType: "PayrollCalendar",
      subjectId: cur.id,
      title: gapDays > 0 ? `${gapDays}-day gap between pay periods` : `Pay periods overlap by ${-gapDays} day(s)`,
      detail: `"${prev.title}" ends ${prev.end.toISOString().slice(0, 10)}; "${cur.title}" starts ${cur.start.toISOString().slice(0, 10)}.`,
      likelyCause: "A period was edited or created by hand.",
      suggestedFix: "Fix the dates so each period starts the day after the last one ends.",
      fixLink: "/admin/payroll",
      evidence: { gapDays },
    });
  }
  return out;
}

/** payroll.overtime-forecast: how much overtime this period is heading for. */
export type WeekMinutes = { employeeId: string; name: string; weekStart: string; minutes: number };
export function evaluateOvertimeForecast(
  periodId: string,
  periodTitle: string,
  weeks: WeekMinutes[],
  overtimeHours: number,
): FindingDraft[] {
  const line = overtimeHours * 60;
  const people = new Map<string, { name: string; ot: number }>();
  for (const w of weeks) {
    const ot = Math.max(0, w.minutes - line);
    if (ot <= 0) continue;
    const p = people.get(w.employeeId) ?? { name: w.name, ot: 0 };
    p.ot += ot;
    people.set(w.employeeId, p);
  }
  if (people.size === 0) return [];
  const total = [...people.values()].reduce((n, p) => n + p.ot, 0);
  const top = [...people.values()]
    .sort((a, b) => b.ot - a.ot)
    .slice(0, 8)
    .map((p) => `${p.name} (${hours(p.ot)}h)`)
    .join(", ");
  return [
    {
      fingerprint: `payroll.overtime-forecast:${periodId}`,
      severity: "INFO",
      subjectType: "PayrollCalendar",
      subjectId: periodId,
      title: `${periodTitle}: about ${hours(total)}h overtime across ${people.size} people`,
      detail: `Counting hours worked plus hours still scheduled, weeks over ${overtimeHours}h. Most: ${top}.`,
      likelyCause: "Heavy weeks on the schedule.",
      suggestedFix: "Adjust remaining shifts if overtime is not wanted.",
      fixLink: "/admin/schedules",
      evidence: { totalMinutes: total, people: people.size },
    },
  ];
}

/** leave.coverage: too many people from one department off at once. */
export type CoverageRequest = {
  requestId: string;
  employeeId: string;
  name: string;
  department: string;
  start: Date;
  end: Date;
  headcount: number;
  others: Array<{ start: Date; end: Date }>;
};
export function evaluateLeaveCoverage(rows: CoverageRequest[], maxShare: number): FindingDraft[] {
  const out: FindingDraft[] = [];
  for (const r of rows) {
    if (r.headcount < 2) continue;
    let peak = 0;
    for (let t = r.start.getTime(); t <= r.end.getTime(); t += DAY) {
      const off = 1 + r.others.filter((o) => o.start.getTime() <= t && o.end.getTime() >= t).length;
      peak = Math.max(peak, off);
    }
    if (peak < 2 || peak / r.headcount <= maxShare) continue;
    out.push({
      fingerprint: `leave.coverage:${r.requestId}`,
      severity: "WARN",
      subjectType: "LeaveRequest",
      subjectId: r.requestId,
      employeeId: r.employeeId,
      title: `${r.name}'s leave leaves ${r.department} short`,
      detail: `Up to ${peak} of ${r.headcount} people in ${r.department} would be off on the same day.`,
      likelyCause: "Several requests overlap.",
      suggestedFix: "Approve with changed dates, or check coverage with the supervisor first.",
      fixLink: "/admin/leave",
      evidence: { peak, headcount: r.headcount },
    });
  }
  return out;
}

/** leave.overdrawn: a pending or approved request that takes a balance below zero. */
export type OverdrawnRequest = { requestId: string; employeeId: string; name: string; leaveType: string; years: number[] };
export function evaluateLeaveOverdrawn(rows: OverdrawnRequest[]): FindingDraft[] {
  return rows
    .filter((r) => r.years.length > 0)
    .map((r) => ({
      fingerprint: `leave.overdrawn:${r.requestId}`,
      severity: "WARN" as const,
      subjectType: "LeaveRequest",
      subjectId: r.requestId,
      employeeId: r.employeeId,
      title: `${r.name}: ${r.leaveType.toLowerCase()} leave would go below zero`,
      detail: `Balance is overdrawn for ${r.years.join(", ")}.`,
      likelyCause: "Request is larger than the days left.",
      suggestedFix: "Reduce the days, or adjust the balance if there is a reason.",
      fixLink: "/admin/leave",
      evidence: { years: r.years },
    }));
}

/** reimbursement.issues: no receipt, or the same expense entered twice. */
export type ReimbRow = {
  id: string;
  employeeId: string;
  name: string;
  title: string;
  amount: string;
  expenseDate: string;
  status: string;
  receipts: number;
};
export function evaluateReimbursements(rows: ReimbRow[]): FindingDraft[] {
  const out: FindingDraft[] = [];
  const seen = new Map<string, ReimbRow>();
  for (const r of rows) {
    if (r.status === "REJECTED") continue;
    if (r.receipts === 0 && (r.status === "PENDING" || r.status === "UNDER_REVIEW")) {
      out.push({
        fingerprint: `reimbursement.no-receipt:${r.id}`,
        severity: "INFO",
        subjectType: "Reimbursement",
        subjectId: r.id,
        employeeId: r.employeeId,
        title: `${r.name}: "${r.title}" ($${r.amount}) has no receipt`,
        detail: `Expense dated ${r.expenseDate}.`,
        likelyCause: "Receipt not uploaded.",
        suggestedFix: "Ask for the receipt before approving.",
        fixLink: "/admin/reimbursements",
        evidence: {},
      });
    }
    const key = `${r.employeeId}|${r.amount}|${r.expenseDate}`;
    const earlier = seen.get(key);
    if (earlier) {
      out.push({
        fingerprint: `reimbursement.duplicate:${earlier.id}:${r.id}`,
        severity: "WARN",
        subjectType: "Reimbursement",
        subjectId: r.id,
        employeeId: r.employeeId,
        title: `${r.name}: possible duplicate reimbursement ($${r.amount})`,
        detail: `Two requests with the same amount and expense date (${r.expenseDate}).`,
        likelyCause: "Submitted twice.",
        suggestedFix: "Reject the duplicate.",
        fixLink: "/admin/reimbursements",
        evidence: { ids: [earlier.id, r.id] },
      });
    } else seen.set(key, r);
  }
  return out;
}
