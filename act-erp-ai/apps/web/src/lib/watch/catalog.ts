import type { WatchPolicy } from "./types";

/** Plain-English names for every rule, shown on the rules list. Unknown ids fall back to the id. */
export const RULE_LABELS: Record<string, { label: string; group: string }> = {
  "time.missing-clock-out": { label: "Punched in, never punched out", group: "Time" },
  "time.missing-clock-in": { label: "Scheduled but no punch-in (30 min late)", group: "Time" },
  "time.overtime-pace": { label: "On track for weekly overtime", group: "Time" },
  "time.lunch": { label: "Lunch missing, short or long", group: "Time" },
  "time.impossible-shift": { label: "Unreviewed long shift, or two shifts overlap", group: "Time" },
  "time.duplicate-punch": { label: "Double punch within 2 minutes", group: "Time" },
  "time.new-kiosk": { label: "Punch at a kiosk they never used", group: "Time" },
  "time.photo-missing": { label: "Kiosk punches without a photo", group: "Time" },
  "time.early-arrival-pattern": { label: "Often punches in well before schedule", group: "Time" },
  "time.rounding-drift": { label: "Rounding always goes one way", group: "Time" },
  "time.holiday-work": { label: "Worked a holiday with no note", group: "Time" },
  "time.schedule-variance": { label: "Hours differ from the schedule", group: "Time" },
  "contract.missing-clock-out": { label: "Contract worker never punched out", group: "Contract crew" },
  "contract.entries": { label: "Contract entries: no job code, wrong code, no photo", group: "Contract crew" },
  "contract.long-tenure": { label: "Contract worker past the review point", group: "Contract crew" },
  "payroll.close-blockers": { label: "Things blocking pay period close", group: "Payroll" },
  "payroll.hours-variance": { label: "Person's hours changed a lot vs last period", group: "Payroll" },
  "payroll.hours-total-spike": { label: "Total hours far above recent average", group: "Payroll" },
  "payroll.entry-sanity": { label: "Zero hours or totals that do not add up", group: "Payroll" },
  "payroll.duplicate-paystub": { label: "Two pay documents for one period", group: "Payroll" },
  "payroll.terminated-with-hours": { label: "Hours after a termination date", group: "Payroll" },
  "payroll.new-hire-forms": { label: "New hire has hours but no accepted W-4 or I-9", group: "Payroll" },
  "payroll.reimbursement-unpaid": { label: "Approved reimbursement not paid", group: "Payroll" },
  "payroll.period-gap": { label: "Gap or overlap between pay periods", group: "Payroll" },
  "payroll.overtime-forecast": { label: "Overtime forecast for this period", group: "Payroll" },
  "leave.coverage": { label: "Leave request leaves a department short", group: "Leave" },
  "leave.overdrawn": { label: "Leave request goes below zero balance", group: "Leave" },
  "reimbursement.issues": { label: "Reimbursement: no receipt or duplicate", group: "Leave" },
  "hr.onboarding-stuck": { label: "Onboarding items waiting 3+ days", group: "HR" },
  "hr.i9-late": { label: "I-9 not done within 3 business days", group: "HR" },
  "hr.handbook-unsigned": { label: "Handbook not acknowledged", group: "HR" },
  "hr.eligibility-upcoming": { label: "Benefit or 401(k) date in the next 30 days", group: "HR" },
  "hr.classification-missing": { label: "No benefit eligibility classification", group: "HR" },
  "hr.plan-year-expired": { label: "Enrollments on an ended plan year", group: "HR" },
  "hr.terminated-login-active": { label: "Terminated employee still has a login", group: "HR" },
  "hr.temp-password": { label: "Still on a temporary password after a week", group: "HR" },
  "hr.filing-deadline": { label: "Payroll tax filing due within 14 days", group: "HR" },
  "hr.company-record-incomplete": { label: "Company record missing a file or date", group: "HR" },
  "hr.note-without-status": { label: "Termination note but still active", group: "HR" },
  "notifications.unread": { label: "People ignoring notices", group: "HR" },
  "data.duplicate-employee": { label: "Possible duplicate employee", group: "Data quality" },
  "data.missing-fields": { label: "Missing department, location or supervisor", group: "Data quality" },
  "data.unknown-jobcode": { label: "Punches use a job code that does not exist", group: "Data quality" },
  "data.placeholder-values": { label: "Placeholder values from imports", group: "Data quality" },
  "data.schedule-gap": { label: "Past schedules but none coming up", group: "Data quality" },
  "sec.audit-watch": { label: "Late-night admin actions, exports, bulk downloads", group: "Security" },
  "sys.kiosk-stale": { label: "Kiosk not used for 3+ days", group: "System" },
  "sys.db-size": { label: "Database larger than expected", group: "System" },
  "report.contract-hours": { label: "Report: contract hours by agency", group: "Reports" },
  "report.payroll-summary": { label: "Report: payroll summary", group: "Reports" },
  "report.weekly-digest": { label: "Report: weekly summary", group: "Reports" },
  "report.watch-quality": { label: "Report: flag quality", group: "Reports" },
  "report.staffing-forecast": { label: "Report: staffing forecast", group: "Reports" },
  "report.overtime-by-department": { label: "Report: overtime by department", group: "Reports" },
  "report.new-hire-ramp": { label: "Report: new hires, first 30 days", group: "Reports" },
  "report.falling-hours": { label: "Report: hours falling 3 weeks in a row", group: "Reports" },
};

export type PolicyNumberKey = Exclude<keyof WatchPolicy, "digestRecipientEmails">;

/** Editable numbers on the settings screen. */
export const POLICY_FIELDS: Array<{ key: PolicyNumberKey; label: string; unit: string; min: number; max: number; step: number }> = [
  { key: "weeklyOvertimeHours", label: "Weekly overtime starts after", unit: "hours", min: 1, max: 80, step: 1 },
  { key: "lunchRequiredAfterHours", label: "Lunch expected on shifts longer than", unit: "hours", min: 1, max: 24, step: 0.5 },
  { key: "lunchMinutes", label: "Lunch length", unit: "minutes", min: 5, max: 120, step: 5 },
  { key: "maxShiftHours", label: "Long-shift review threshold", unit: "hours", min: 4, max: 24, step: 1 },
  { key: "missingClockOutGraceMin", label: "Wait this long after shift end before flagging a missing clock-out", unit: "minutes", min: 0, max: 600, step: 15 },
  { key: "hoursVariancePct", label: "Flag hours that changed by more than", unit: "percent", min: 5, max: 200, step: 5 },
  { key: "hoursVarianceMinHours", label: "...and by at least", unit: "hours", min: 1, max: 80, step: 1 },
  { key: "earlyArrivalMinutes", label: "Early arrival means this many minutes before schedule", unit: "minutes", min: 5, max: 120, step: 5 },
  { key: "earlyArrivalCount", label: "Flag after this many early days in 2 weeks", unit: "days", min: 1, max: 14, step: 1 },
  { key: "scheduleVarianceHours", label: "Flag when weekly hours differ from schedule by", unit: "hours", min: 1, max: 40, step: 1 },
  { key: "contractTenureDays", label: "Review contract workers after", unit: "days", min: 7, max: 730, step: 1 },
  { key: "newKioskMinPriorEntries", label: "New-kiosk check needs this much history", unit: "punches", min: 1, max: 100, step: 1 },
  { key: "leaveMaxShare", label: "Most of a department that may be off at once", unit: "share (0.25 = 25%)", min: 0.05, max: 1, step: 0.05 },
  { key: "dbSizeWarnGb", label: "Warn when the database passes", unit: "GB", min: 1, max: 500, step: 1 },
  { key: "digestHourLocal", label: "Daily digest time (Central, 24-hour)", unit: "hour", min: 0, max: 23, step: 1 },
];

export type PolicyFormResult = { ok: true; policy: WatchPolicy } | { ok: false; error: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validate what the settings form sends. Strings in, a full policy out. */
export function parsePolicyForm(input: { numbers: Record<string, unknown>; recipients: string }): PolicyFormResult {
  const policy = {} as Record<string, unknown>;
  for (const f of POLICY_FIELDS) {
    const raw = input.numbers[f.key];
    const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
    if (!Number.isFinite(n) || String(raw ?? "").trim() === "") return { ok: false, error: `${f.label}: enter a number.` };
    if (n < f.min || n > f.max) return { ok: false, error: `${f.label}: must be between ${f.min} and ${f.max}.` };
    policy[f.key] = n;
  }
  const emails = input.recipients
    .split(/[,\s;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (emails.length === 0) return { ok: false, error: "Add at least one recipient email." };
  const bad = emails.find((e) => !EMAIL.test(e));
  if (bad) return { ok: false, error: `"${bad}" is not a valid email.` };
  policy.digestRecipientEmails = [...new Set(emails)];
  return { ok: true, policy: policy as WatchPolicy };
}
