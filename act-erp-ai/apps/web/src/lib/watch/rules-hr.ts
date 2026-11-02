import type { FindingDraft } from "./types";

const DAY = 24 * 60 * 60_000;

/** A flag that lists many people at once, so the page shows one row instead of dozens. */
function summary(args: {
  rule: string;
  key: string;
  severity: FindingDraft["severity"];
  title: string;
  names: string[];
  likelyCause: string;
  suggestedFix: string;
  fixLink: string;
  subjectType?: string;
  evidence?: Record<string, unknown>;
}): FindingDraft {
  const shown = args.names.slice(0, 12).join(", ");
  const more = args.names.length > 12 ? ` and ${args.names.length - 12} more` : "";
  return {
    fingerprint: `${args.rule}:${args.key}`,
    severity: args.severity,
    subjectType: args.subjectType ?? "Company",
    subjectId: args.key,
    title: args.title,
    detail: `${shown}${more}.`,
    likelyCause: args.likelyCause,
    suggestedFix: args.suggestedFix,
    fixLink: args.fixLink,
    evidence: { count: args.names.length, ...(args.evidence ?? {}) },
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** hr.onboarding-stuck: required checklist items waiting more than 3 days. */
export type StuckItem = { employeeId: string; name: string; title: string; status: string; ageDays: number };
export function evaluateOnboardingStuck(items: StuckItem[]): FindingDraft[] {
  const per = new Map<string, { name: string; items: StuckItem[] }>();
  for (const i of items) {
    if (i.ageDays < 3 || ["ACCEPTED", "NOT_APPLICABLE"].includes(i.status)) continue;
    const p = per.get(i.employeeId) ?? { name: i.name, items: [] };
    p.items.push(i);
    per.set(i.employeeId, p);
  }
  return [...per.entries()].map(([id, p]) => {
    const waitingOnHr = p.items.every((i) => i.status === "SUBMITTED");
    return {
      fingerprint: `hr.onboarding-stuck:${id}`,
      severity: "INFO" as const,
      subjectType: "Employee",
      subjectId: id,
      employeeId: id,
      title: `${p.name}: ${plural(p.items.length, "onboarding item")} waiting ${Math.max(...p.items.map((i) => i.ageDays))}+ days`,
      detail: p.items.map((i) => `${i.title} (${i.status.toLowerCase().replace("_", " ")})`).join(", "),
      likelyCause: waitingOnHr ? "Submitted by the employee and waiting for HR review." : "Employee has not submitted yet.",
      suggestedFix: waitingOnHr ? "Review and accept the submitted items." : "Remind the employee.",
      fixLink: "/admin/onboarding/checklists",
      evidence: { items: p.items.length },
    };
  });
}

/** hr.i9-late: I-9 not accepted within 3 business days of the hire date. */
export type I9Row = { employeeId: string; name: string; hireDate: Date; accepted: boolean };
export function businessDaysBetween(from: Date, to: Date): number {
  let n = 0;
  for (let t = from.getTime() + DAY; t <= to.getTime(); t += DAY) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}
export function evaluateI9Late(rows: I9Row[], today: Date): FindingDraft[] {
  return rows
    .filter((r) => !r.accepted && businessDaysBetween(r.hireDate, today) > 3)
    .map((r) => ({
      fingerprint: `hr.i9-late:${r.employeeId}`,
      severity: "WARN" as const,
      subjectType: "Employee",
      subjectId: r.employeeId,
      employeeId: r.employeeId,
      title: `${r.name}: I-9 not accepted ${businessDaysBetween(r.hireDate, today)} business days after hire`,
      detail: `Hired ${r.hireDate.toISOString().slice(0, 10)}. Section 2 is due within 3 business days.`,
      likelyCause: "Documents not shown yet, or not reviewed.",
      suggestedFix: "Complete the I-9 review with the employee now.",
      fixLink: "/admin/onboarding/checklists",
      evidence: {},
    }));
}

/** hr.handbook-unsigned. */
export type HandbookRow = { employeeId: string; name: string; ageDays: number };
export function evaluateHandbookUnsigned(rows: HandbookRow[]): FindingDraft[] {
  const late = rows.filter((r) => r.ageDays >= 7);
  if (late.length === 0) return [];
  return [
    summary({
      rule: "hr.handbook-unsigned",
      key: "all",
      severity: "INFO",
      title: `${plural(late.length, "person", "people")} have not acknowledged the handbook (7+ days)`,
      names: late.map((r) => r.name),
      likelyCause: "Handbook sent but not signed.",
      suggestedFix: "Remind them or record a signed paper copy.",
      fixLink: "/admin/onboarding/checklists",
    }),
  ];
}

/** hr.eligibility-upcoming: benefit or 401(k) date coming up within 30 days. */
export type EligibilityRow = { employeeId: string; name: string; benefitType: string; state: string; proposedDate: string | null };
export function evaluateEligibilityUpcoming(rows: EligibilityRow[], today: Date): FindingDraft[] {
  const end = new Date(today.getTime() + 30 * DAY);
  return rows
    .filter((r) => r.state === "NOT_YET_ELIGIBLE" && r.proposedDate)
    .filter((r) => {
      const d = new Date(`${r.proposedDate}T00:00:00Z`);
      return d >= today && d <= end;
    })
    .map((r) => ({
      fingerprint: `hr.eligibility-upcoming:${r.employeeId}:${r.benefitType}:${r.proposedDate}`,
      severity: "INFO" as const,
      subjectType: "Employee",
      subjectId: r.employeeId,
      employeeId: r.employeeId,
      title: `${r.name}: ${r.benefitType.replace("_", " ").toLowerCase()} eligibility on ${r.proposedDate}`,
      detail: "Proposed date. No enrollment is created automatically.",
      likelyCause: "Waiting period ends soon.",
      suggestedFix: "Send the enrollment forms and confirm the date.",
      fixLink: "/admin/benefits/eligibility",
      evidence: { proposedDate: r.proposedDate },
    }));
}

/** hr.classification-missing: active people with no eligibility classification. */
export function evaluateClassificationMissing(names: string[]): FindingDraft[] {
  if (names.length === 0) return [];
  return [
    summary({
      rule: "hr.classification-missing",
      key: "all",
      severity: "INFO",
      title: `${plural(names.length, "employee")} need a benefit eligibility classification`,
      names,
      likelyCause: "Full-time and part-time share one type, so HR must classify each person.",
      suggestedFix: "Classify them on the eligibility page.",
      fixLink: "/admin/benefits/eligibility",
    }),
  ];
}

/** hr.plan-year-expired: active enrollments on a plan whose year has ended. */
export type ExpiredPlan = { planId: string; planName: string; planYearEnd: string; enrollments: number };
export function evaluatePlanYearExpired(rows: ExpiredPlan[]): FindingDraft[] {
  return rows
    .filter((r) => r.enrollments > 0)
    .map((r) => ({
      fingerprint: `hr.plan-year-expired:${r.planId}`,
      severity: "WARN" as const,
      subjectType: "BenefitPlan",
      subjectId: r.planId,
      title: `${r.planName}: ${plural(r.enrollments, "active enrollment")} on an ended plan year`,
      detail: `Plan year ended ${r.planYearEnd}.`,
      likelyCause: "New plan year not rolled forward.",
      suggestedFix: "Roll the plan forward and re-point enrollments.",
      fixLink: "/admin/benefits",
      evidence: { enrollments: r.enrollments },
    }));
}

/** hr.terminated-login-active: terminated employees who still have a password set. */
export function evaluateTerminatedLogin(names: string[]): FindingDraft[] {
  if (names.length === 0) return [];
  return [
    summary({
      rule: "hr.terminated-login-active",
      key: "all",
      severity: "WARN",
      title: `${plural(names.length, "terminated employee")} still ${names.length === 1 ? "has" : "have"} a login`,
      names,
      likelyCause: "Accounts are not disabled when status changes to terminated.",
      suggestedFix: "Disable or reset these accounts.",
      fixLink: "/admin/employees",
    }),
  ];
}

/** hr.temp-password: accounts still marked "must change password" after a week. */
export function evaluateTempPasswords(rows: Array<{ name: string; ageDays: number }>): FindingDraft[] {
  const old = rows.filter((r) => r.ageDays >= 7);
  if (old.length === 0) return [];
  return [
    summary({
      rule: "hr.temp-password",
      key: "all",
      severity: "WARN",
      title: `${plural(old.length, "account")} still on a temporary password after 7+ days`,
      names: old.map((r) => r.name),
      likelyCause: "New hires have not signed in and changed their password.",
      suggestedFix: "Help them sign in, or rotate the temporary passwords.",
      fixLink: "/admin/employees",
    }),
  ];
}

/** hr.filing-deadline: payroll tax deadlines in the next 14 days. Dates follow the usual IRS and TWC calendar; confirm with the accountant. */
export function filingDeadlines(year: number): Array<{ key: string; label: string; date: Date }> {
  const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0));
  const out: Array<{ key: string; label: string; date: Date }> = [];
  for (const [y, q, m] of [[year - 1, 4, 0], [year, 1, 3], [year, 2, 6], [year, 3, 9]] as const) {
    out.push({ key: `941-${y}-Q${q}`, label: `Form 941 and Texas Workforce Commission report for Q${q} ${y}`, date: lastDay(year, m) });
  }
  out.push({ key: `w2-${year - 1}`, label: `W-2 and W-3 for ${year - 1}`, date: lastDay(year, 0) });
  out.push({ key: `940-${year - 1}`, label: `Form 940 for ${year - 1}`, date: lastDay(year, 0) });
  return out;
}
export function evaluateFilingDeadlines(today: Date): FindingDraft[] {
  const end = new Date(today.getTime() + 14 * DAY);
  return [...filingDeadlines(today.getUTCFullYear()), ...filingDeadlines(today.getUTCFullYear() + 1).filter((d) => d.date.getUTCMonth() === 0)]
    .filter((d) => d.date >= today && d.date <= end)
    .map((d) => ({
      fingerprint: `hr.filing-deadline:${d.key}`,
      severity: "WARN" as const,
      subjectType: "Company",
      subjectId: d.key,
      title: `${d.label} due ${d.date.toISOString().slice(0, 10)}`,
      detail: "Standard due date. Confirm with the accountant, since weekends and extensions move it.",
      likelyCause: "Regular payroll tax calendar.",
      suggestedFix: "Make sure the filing and payment are scheduled.",
      fixLink: "/admin/documents/company",
      evidence: { date: d.date.toISOString().slice(0, 10) },
    }));
}

/** hr.company-record-incomplete: company documents with no file version, or a tax record with no year. */
export type CompanyRecord = { id: string; title: string; category: string; versions: number; latestHasDate: boolean };
export function evaluateCompanyRecords(rows: CompanyRecord[]): FindingDraft[] {
  const bad = rows.filter((r) => r.versions === 0 || !r.latestHasDate);
  if (bad.length === 0) return [];
  return [
    summary({
      rule: "hr.company-record-incomplete",
      key: "all",
      severity: "INFO",
      title: `${plural(bad.length, "company record")} missing a file or a year/date`,
      names: bad.map((r) => r.title),
      likelyCause: "Uploaded without full details.",
      suggestedFix: "Open each record and fill in the year, period or effective date.",
      fixLink: "/admin/documents/company",
    }),
  ];
}

/** hr.note-without-status: a termination or resignation note but the person is still active. */
export type NoteStatusRow = { employeeId: string; name: string; kind: string; noteDate: string };
export function evaluateNoteWithoutStatus(rows: NoteStatusRow[]): FindingDraft[] {
  return rows.map((r) => ({
    fingerprint: `hr.note-without-status:${r.employeeId}:${r.kind}`,
    severity: "WARN" as const,
    subjectType: "Employee",
    subjectId: r.employeeId,
    employeeId: r.employeeId,
    title: `${r.name}: ${r.kind.toLowerCase()} note on ${r.noteDate} but still active`,
    detail: "Notes do not change status by themselves.",
    likelyCause: "Status was not updated after the note.",
    suggestedFix: "Set the employment status and termination date.",
    fixLink: `/admin/employees/${r.employeeId}`,
    evidence: { kind: r.kind },
  }));
}

/** notifications.unread: people with a pile of old unread notices. */
export function evaluateUnreadNotices(rows: Array<{ name: string; unread: number }>): FindingDraft[] {
  const heavy = rows.filter((r) => r.unread >= 5);
  if (heavy.length === 0) return [];
  return [
    summary({
      rule: "notifications.unread",
      key: "all",
      severity: "INFO",
      title: `${plural(heavy.length, "person", "people")} have 5+ unread notices older than 14 days`,
      names: heavy.map((r) => `${r.name} (${r.unread})`),
      likelyCause: "They do not use the portal, or notices go to the wrong place.",
      suggestedFix: "Use another way to reach them for important notices.",
      fixLink: "/admin/notifications",
    }),
  ];
}

/** data.missing-fields: active people missing a department, work location or supervisor. */
export type FieldRow = { name: string; departmentId: string | null; workLocation: string | null; supervisorId: string | null };
export function evaluateMissingFields(rows: FieldRow[]): FindingDraft[] {
  const out: FindingDraft[] = [];
  const checks: Array<[string, string, (r: FieldRow) => boolean]> = [
    ["department", "a department", (r) => !r.departmentId],
    ["location", "a work location", (r) => !r.workLocation],
    ["supervisor", "a supervisor", (r) => !r.supervisorId],
  ];
  for (const [key, label, missing] of checks) {
    const names = rows.filter(missing).map((r) => r.name);
    if (names.length === 0) continue;
    out.push(
      summary({
        rule: "data.missing-fields",
        key,
        severity: "INFO",
        title: `${plural(names.length, "active employee")} without ${label}`,
        names,
        likelyCause: "Imported or created without this detail.",
        suggestedFix: "Fill it in on each profile.",
        fixLink: "/admin/employees",
      }),
    );
  }
  return out;
}

/** data.unknown-jobcode: punches using a job code that does not exist. */
export function evaluateUnknownJobCodes(codes: Array<{ code: string; entries: number }>): FindingDraft[] {
  if (codes.length === 0) return [];
  return [
    summary({
      rule: "data.unknown-jobcode",
      key: "all",
      severity: "WARN",
      title: `${plural(codes.length, "job code")} used on recent punches ${codes.length === 1 ? "does" : "do"} not exist`,
      names: codes.map((c) => `${c.code} (${plural(c.entries, "entry", "entries")})`),
      likelyCause: "Job code was deleted or mistyped.",
      suggestedFix: "Recreate the code or correct the entries.",
      fixLink: "/admin/job-codes",
    }),
  ];
}

/** data.placeholder-values: values that only exist to fill a required field. */
export function evaluatePlaceholders(rows: Array<{ name: string; gender: string }>): FindingDraft[] {
  const names = rows.filter((r) => r.gender === "OTHER").map((r) => r.name);
  if (names.length === 0) return [];
  return [
    summary({
      rule: "data.placeholder-values",
      key: "gender",
      severity: "INFO",
      title: `${plural(names.length, "employee")} with gender set to "Other" (likely an import placeholder)`,
      names,
      likelyCause: "Imported records default to this value.",
      suggestedFix: "Update to the real value or confirm it is correct.",
      fixLink: "/admin/employees",
    }),
  ];
}

/** data.schedule-gap: people who had schedules but have none in the next 14 days. */
export function evaluateScheduleGaps(names: string[]): FindingDraft[] {
  if (names.length === 0) return [];
  return [
    summary({
      rule: "data.schedule-gap",
      key: "all",
      severity: "INFO",
      title: `${plural(names.length, "person", "people")} with past schedules but nothing in the next 14 days`,
      names,
      likelyCause: "Schedule import ended, or the schedule has not been extended.",
      suggestedFix: "Extend the schedule or mark them as not scheduled.",
      fixLink: "/admin/schedules",
    }),
  ];
}

/** security: admin writes at odd hours, big exports, repeated sensitive downloads. */
export type AuditRow = { actor: string; action: string; hourLocal: number; at: Date };
export function evaluateAfterHoursAdmin(rows: AuditRow[]): FindingDraft[] {
  const odd = rows.filter((r) => (r.hourLocal < 5 || r.hourLocal >= 22) && !r.action.startsWith("watch."));
  const per = new Map<string, number>();
  for (const r of odd) per.set(r.actor, (per.get(r.actor) ?? 0) + 1);
  if (per.size === 0) return [];
  const names = [...per.entries()].map(([a, n]) => `${a} (${n})`);
  return [
    summary({
      rule: "sec.after-hours-admin",
      key: odd[0]!.at.toISOString().slice(0, 10),
      severity: "INFO",
      title: `${odd.length} admin action${odd.length === 1 ? "" : "s"} between 10 pm and 5 am`,
      names,
      likelyCause: "Late-night work, or an account used by someone else.",
      suggestedFix: "Check the activity log if this is unexpected.",
      fixLink: "/admin/activity",
    }),
  ];
}
export function evaluateLargeExports(rows: AuditRow[]): FindingDraft[] {
  return rows
    .filter((r) => /export/.test(r.action))
    .map((r) => ({
      fingerprint: `sec.large-export:${r.actor}:${r.at.toISOString()}`,
      severity: "INFO" as const,
      subjectType: "Company",
      subjectId: r.at.toISOString(),
      title: `${r.actor} ran an export (${r.action})`,
      detail: `At ${r.at.toISOString()}.`,
      likelyCause: "Regular payroll or reporting work.",
      suggestedFix: "No action if expected.",
      fixLink: "/admin/activity",
      evidence: { action: r.action },
    }));
}
export function evaluateSensitiveDownloads(rows: AuditRow[]): FindingDraft[] {
  const per = new Map<string, number>();
  for (const r of rows) if (r.action === "company.document.download") per.set(r.actor, (per.get(r.actor) ?? 0) + 1);
  return [...per.entries()]
    .filter(([, n]) => n >= 10)
    .map(([actor, n]) => ({
      fingerprint: `sec.sensitive-download:${actor}:${rows[0]?.at.toISOString().slice(0, 10) ?? ""}`,
      severity: "WARN" as const,
      subjectType: "Company",
      subjectId: actor,
      title: `${actor} downloaded ${n} company documents in a day`,
      detail: "Company records can contain payroll and tax information.",
      likelyCause: "Bulk review, or copying records.",
      suggestedFix: "Confirm with the person.",
      fixLink: "/admin/activity",
      evidence: { downloads: n },
    }));
}

/** sys.kiosk-stale: kiosk sessions nobody has used in a while. */
export type KioskRow = { id: string; label: string; lastUsedAt: Date | null };
export function evaluateKioskStale(rows: KioskRow[], now: Date): FindingDraft[] {
  return rows
    .filter((r) => !r.lastUsedAt || now.getTime() - r.lastUsedAt.getTime() > 3 * DAY)
    .map((r) => ({
      fingerprint: `sys.kiosk-stale:${r.id}`,
      severity: "INFO" as const,
      subjectType: "Kiosk",
      subjectId: r.id,
      title: `Kiosk "${r.label}" not used for ${r.lastUsedAt ? Math.floor((now.getTime() - r.lastUsedAt.getTime()) / DAY) : "many"} days`,
      detail: r.lastUsedAt ? `Last used ${r.lastUsedAt.toISOString()}.` : "Never used.",
      likelyCause: "Tablet off, offline, or signed out.",
      suggestedFix: "Check the tablet, or end the session if retired.",
      fixLink: "/admin/kiosks",
      evidence: {},
    }));
}

/** sys.db-size: database bigger than expected. */
export function evaluateDbSize(bytes: number, warnGb: number): FindingDraft[] {
  const gb = bytes / 1024 ** 3;
  if (gb < warnGb) return [];
  return [
    {
      fingerprint: "sys.db-size:warn",
      severity: "WARN",
      subjectType: "Company",
      subjectId: "database",
      title: `Database is ${gb.toFixed(1)} GB`,
      detail: `Above the ${warnGb} GB warning line.`,
      likelyCause: "Growth from imports, photos, or logs.",
      suggestedFix: "Check which tables grew, and the server disk space.",
      fixLink: "/admin/activity",
      evidence: { bytes },
    },
  ];
}
