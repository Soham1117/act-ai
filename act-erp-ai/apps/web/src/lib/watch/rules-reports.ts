import type { FindingDraft } from "./types";

/**
 * Reports are "flags" with severity INFO whose rule id starts with "report.".
 * They show on the Reports tab, never in Needs attention, and replace themselves each week.
 */
const hours = (min: number) => (min / 60).toFixed(1);
const pct = (cur: number, prev: number) => (prev > 0 ? `${cur >= prev ? "+" : ""}${Math.round(((cur - prev) / prev) * 100)}%` : "new");

function report(rule: string, key: string, title: string, lines: string[], fixLink: string, evidence: Record<string, unknown> = {}): FindingDraft {
  return {
    fingerprint: `${rule}:${key}`,
    severity: "INFO",
    subjectType: "Report",
    subjectId: key,
    title,
    detail: lines.join("\n"),
    fixLink,
    evidence,
  };
}

/** report.contract-hours: last week by agency and job code, with change, plus employee hours on the same job codes. */
export type ContractHoursRow = { agency: string; jobCode: string; minutes: number; prevMinutes: number };
export function reportContractHours(weekKey: string, rows: ContractHoursRow[], employeeMinutesByJobCode: Map<string, number>): FindingDraft[] {
  if (rows.length === 0) return [];
  const total = rows.reduce((n, r) => n + r.minutes, 0);
  const prev = rows.reduce((n, r) => n + r.prevMinutes, 0);
  const lines = [...rows]
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 15)
    .map((r) => {
      const emp = employeeMinutesByJobCode.get(r.jobCode.toLowerCase());
      return `${r.agency} · ${r.jobCode || "(no code)"}: ${hours(r.minutes)}h (${pct(r.minutes, r.prevMinutes)} vs prior week)${emp ? `; employees on this code: ${hours(emp)}h` : ""}`;
    });
  return [report("report.contract-hours", weekKey, `Contract hours, week of ${weekKey}: ${hours(total)}h (${pct(total, prev)})`, lines, "/admin/contract-workers")];
}

/** report.payroll-summary: the pay period so far, in plain words. */
export function reportPayrollSummary(args: {
  periodId: string;
  title: string;
  minutes: number;
  headcount: number;
  prevMinutes: number;
  daysElapsed: number;
  daysTotal: number;
  topIncreases: Array<{ name: string; minutes: number; prevMinutes: number }>;
}): FindingDraft[] {
  const pace = args.daysElapsed > 0 ? (args.minutes / args.daysElapsed) * args.daysTotal : 0;
  const lines = [
    `${hours(args.minutes)}h worked by ${args.headcount} people so far (day ${args.daysElapsed} of ${args.daysTotal}).`,
    `At this pace the period ends near ${hours(pace)}h; the last period was ${hours(args.prevMinutes)}h (${pct(pace, args.prevMinutes)}).`,
    ...args.topIncreases.map((p) => `${p.name}: ${hours(p.minutes)}h vs ${hours(p.prevMinutes)}h in the same days last period`),
  ];
  return [report("report.payroll-summary", args.periodId, `${args.title}: payroll summary`, lines, "/admin/hours")];
}

/** report.weekly-digest: repeat offenders and what happened this week. */
export function reportWeeklyDigest(args: {
  weekKey: string;
  raised: number;
  cleared: number;
  openNow: number;
  repeat: Array<{ name: string; count: number }>;
}): FindingDraft[] {
  const lines = [
    `${args.raised} flags raised, ${args.cleared} cleared, ${args.openNow} open now.`,
    args.repeat.length
      ? `People with 3+ flags in 4 weeks: ${args.repeat.map((r) => `${r.name} (${r.count})`).join(", ")}.`
      : "Nobody has 3 or more flags in the last 4 weeks.",
  ];
  return [report("report.weekly-digest", args.weekKey, `Weekly summary, week of ${args.weekKey}`, lines, "/admin/watch")];
}

/** report.watch-quality: how the manager handled flags, per rule. */
export type RuleStats = { ruleId: string; raised: number; acknowledged: number; dismissed: number; snoozed: number };
export function reportWatchQuality(weekKey: string, stats: RuleStats[]): FindingDraft[] {
  if (stats.length === 0) return [];
  const lines = [...stats]
    .sort((a, b) => b.raised - a.raised)
    .slice(0, 15)
    .map((s) => {
      const handled = s.acknowledged + s.dismissed + s.snoozed;
      const fp = handled > 0 ? `${Math.round((s.dismissed / handled) * 100)}% dismissed` : "not handled yet";
      return `${s.ruleId}: ${s.raised} raised, ${s.acknowledged} acknowledged, ${s.dismissed} dismissed, ${s.snoozed} snoozed (${fp})`;
    });
  return [report("report.watch-quality", weekKey, `Flag quality, week of ${weekKey}`, lines, "/admin/watch")];
}

/** report.staffing-forecast: next two weeks, scheduled people vs approved leave. */
export type DayForecast = { date: string; weekday: string; scheduled: number; onLeave: number };
export function reportStaffingForecast(weekKey: string, days: DayForecast[]): FindingDraft[] {
  const working = days.filter((d) => d.scheduled > 0 || d.onLeave > 0);
  if (working.length === 0) return [];
  const lines = working.map((d) => `${d.weekday} ${d.date}: ${d.scheduled} scheduled, ${d.onLeave} on approved leave`);
  return [report("report.staffing-forecast", weekKey, "Staffing forecast, next 14 days", lines, "/admin/schedules")];
}

/** report.overtime-by-department: where overtime hours sit this week. */
export type DeptWeek = { department: string; minutes: number; overtimeMinutes: number; people: number };
export function reportOvertimeByDepartment(weekKey: string, rows: DeptWeek[]): FindingDraft[] {
  const withHours = rows.filter((r) => r.minutes > 0);
  if (withHours.length === 0) return [];
  const lines = [...withHours]
    .sort((a, b) => b.overtimeMinutes - a.overtimeMinutes)
    .map((r) => `${r.department}: ${hours(r.minutes)}h across ${r.people} people, ${hours(r.overtimeMinutes)}h overtime`);
  return [report("report.overtime-by-department", weekKey, `Overtime by department, week of ${weekKey}`, lines, "/admin/hours")];
}

/** report.new-hire-ramp: first 30 days of recent hires. */
export type RampRow = { name: string; hireDate: string; minutes: number; days: number; itemsDone: number; itemsTotal: number };
export function reportNewHireRamp(weekKey: string, rows: RampRow[]): FindingDraft[] {
  if (rows.length === 0) return [];
  const lines = rows.map(
    (r) => `${r.name} (hired ${r.hireDate}): ${hours(r.minutes)}h over ${r.days} days; onboarding ${r.itemsTotal ? `${r.itemsDone}/${r.itemsTotal} items accepted` : "no checklist"}`,
  );
  return [report("report.new-hire-ramp", weekKey, `New hires, first 30 days (${rows.length})`, lines, "/admin/onboarding/checklists")];
}

/** report.falling-hours: hours dropping week after week. A signal to check in, not a conclusion. */
export type WeeklyHours = { name: string; weeks: number[] };
export function reportFallingHours(weekKey: string, rows: WeeklyHours[]): FindingDraft[] {
  const falling = rows.filter((r) => {
    const w = r.weeks;
    return w.length >= 4 && w[0]! >= 20 * 60 && w[1]! < w[0]! * 0.85 && w[2]! < w[1]! * 0.85 && w[3]! < w[2]! * 0.85 && w[3]! < w[0]! * 0.7;
  });
  if (falling.length === 0) return [];
  const lines = falling.map((r) => `${r.name}: ${r.weeks.map((m) => hours(m)).join("h → ")}h`);
  return [report("report.falling-hours", weekKey, `Hours falling 3 weeks in a row (${falling.length})`, lines, "/admin/employees")];
}
