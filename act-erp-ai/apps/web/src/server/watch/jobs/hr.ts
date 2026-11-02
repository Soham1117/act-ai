import { db } from "@/lib/db";
import { assessBenefitEligibility, effectiveEligibilityPolicy, ELIGIBILITY_TYPES } from "@/lib/benefit-eligibility";
import { dateOnlyToString, dateToBusinessLocal, parseDateOnly } from "@/lib/time-rules";
import {
  evaluateAfterHoursAdmin,
  evaluateClassificationMissing,
  evaluateCompanyRecords,
  evaluateDbSize,
  evaluateEligibilityUpcoming,
  evaluateFilingDeadlines,
  evaluateHandbookUnsigned,
  evaluateI9Late,
  evaluateKioskStale,
  evaluateLargeExports,
  evaluateMissingFields,
  evaluateNoteWithoutStatus,
  evaluateOnboardingStuck,
  evaluatePlaceholders,
  evaluatePlanYearExpired,
  evaluateScheduleGaps,
  evaluateSensitiveDownloads,
  evaluateTempPasswords,
  evaluateTerminatedLogin,
  evaluateUnknownJobCodes,
  evaluateUnreadNotices,
} from "@/lib/watch/rules-hr";
import { DAY_MS, type RuleJob } from "../context";

const businessToday = (now: Date) => parseDateOnly(dateToBusinessLocal(now).slice(0, 10)) ?? new Date(0);
const ageDays = (from: Date, now: Date) => Math.floor((now.getTime() - from.getTime()) / DAY_MS);

async function namesById(ids: string[]) {
  if (ids.length === 0) return new Map<string, string>();
  const rows = await db.employee.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

export const HR_JOBS: RuleJob[] = [
  {
    id: "hr.onboarding-stuck",
    async run({ now }) {
      const items = await db.onboardingChecklistItem.findMany({
        where: { employeeId: { not: null }, required: true, status: { notIn: ["ACCEPTED", "NOT_APPLICABLE"] } },
        select: { employeeId: true, title: true, status: true, updatedAt: true },
      });
      const names = await namesById([...new Set(items.map((i) => i.employeeId!))]);
      return evaluateOnboardingStuck(
        items.map((i) => ({ employeeId: i.employeeId!, name: names.get(i.employeeId!) ?? "Unknown", title: i.title, status: i.status, ageDays: ageDays(i.updatedAt, now) })),
      );
    },
  },
  {
    id: "hr.i9-late",
    async run({ now }) {
      const items = await db.onboardingChecklistItem.findMany({
        where: { employeeId: { not: null }, title: { contains: "I-9", mode: "insensitive" } },
        select: { employeeId: true, status: true },
      });
      if (items.length === 0) return [];
      const people = await db.employee.findMany({
        where: { id: { in: items.map((i) => i.employeeId!) }, employmentStatus: "ACTIVE", dateOfHire: { not: null, gte: new Date(now.getTime() - 60 * DAY_MS) } },
        select: { id: true, name: true, dateOfHire: true },
      });
      return evaluateI9Late(
        people.map((p) => ({ employeeId: p.id, name: p.name, hireDate: p.dateOfHire!, accepted: items.some((i) => i.employeeId === p.id && i.status === "ACCEPTED") })),
        businessToday(now),
      );
    },
  },
  {
    id: "hr.handbook-unsigned",
    async run({ now }) {
      const items = await db.onboardingChecklistItem.findMany({
        where: { employeeId: { not: null }, itemType: "HANDBOOK", status: { notIn: ["ACCEPTED", "NOT_APPLICABLE"] }, acknowledgment: null },
        select: { employeeId: true, createdAt: true },
      });
      const names = await namesById([...new Set(items.map((i) => i.employeeId!))]);
      return evaluateHandbookUnsigned(items.map((i) => ({ employeeId: i.employeeId!, name: names.get(i.employeeId!) ?? "Unknown", ageDays: ageDays(i.createdAt, now) })));
    },
  },
  {
    id: "hr.eligibility-upcoming",
    async run({ now }) {
      const today = businessToday(now);
      const [people, policies, assessments] = await Promise.all([
        db.employee.findMany({ where: { employmentStatus: "ACTIVE" }, select: { id: true, name: true, dateOfHire: true, employmentStatus: true } }),
        db.benefitEligibilityPolicy.findMany(),
        db.benefitEligibilityAssessment.findMany(),
      ]);
      const rows = people.flatMap((e) =>
        ELIGIBILITY_TYPES.map((benefitType) => {
          const r = assessBenefitEligibility({
            benefitType,
            hireDate: e.dateOfHire,
            employmentStatus: e.employmentStatus,
            assessment: assessments.find((a) => a.employeeId === e.id && a.benefitType === benefitType) ?? null,
            policy: effectiveEligibilityPolicy(policies, benefitType, today),
            today,
          });
          return { employeeId: e.id, name: e.name, benefitType, state: r.state, proposedDate: r.proposedDate };
        }),
      );
      return evaluateEligibilityUpcoming(rows, today);
    },
  },
  {
    id: "hr.classification-missing",
    async run() {
      const people = await db.employee.findMany({
        where: { employmentStatus: "ACTIVE", eligibilityAssessments: { none: {} } },
        select: { name: true },
      });
      return evaluateClassificationMissing(people.map((p) => p.name));
    },
  },
  {
    id: "hr.plan-year-expired",
    async run({ now }) {
      const today = businessToday(now);
      const plans = await db.benefitPlan.findMany({
        where: { planYearEnd: { lt: today }, enrollments: { some: { endDate: null, status: "ENROLLED" } } },
        select: { id: true, name: true, planYearEnd: true, _count: { select: { enrollments: { where: { endDate: null, status: "ENROLLED" } } } } },
      });
      return evaluatePlanYearExpired(plans.map((p) => ({ planId: p.id, planName: p.name, planYearEnd: dateOnlyToString(p.planYearEnd), enrollments: p._count.enrollments })));
    },
  },
  {
    id: "hr.terminated-login-active",
    async run() {
      const people = await db.employee.findMany({
        where: { employmentStatus: "TERMINATED", user: { passwordHash: { not: null } } },
        select: { name: true },
      });
      return evaluateTerminatedLogin(people.map((p) => p.name));
    },
  },
  {
    id: "hr.temp-password",
    async run({ now }) {
      const users = await db.user.findMany({
        where: { mustChangePassword: true, employee: { employmentStatus: "ACTIVE" } },
        select: { name: true, createdAt: true },
      });
      return evaluateTempPasswords(users.map((u) => ({ name: u.name, ageDays: ageDays(u.createdAt, now) })));
    },
  },
  { id: "hr.filing-deadline", async run({ now }) { return evaluateFilingDeadlines(businessToday(now)); } },
  {
    id: "hr.company-record-incomplete",
    async run() {
      const docs = await db.companyDocument.findMany({
        where: { isArchived: false },
        select: { id: true, title: true, category: true, versions: { orderBy: { version: "desc" }, take: 1, select: { year: true, periodEnd: true, effectiveDate: true } } },
      });
      return evaluateCompanyRecords(
        docs.map((d) => {
          const v = d.versions[0];
          return { id: d.id, title: d.title, category: d.category, versions: d.versions.length, latestHasDate: !!(v && (v.year || v.periodEnd || v.effectiveDate)) };
        }),
      );
    },
  },
  {
    id: "hr.note-without-status",
    async run() {
      const notes = await db.employeeNote.findMany({
        where: { isArchived: false, kind: { in: ["TERMINATION", "RESIGNATION"] }, employee: { employmentStatus: "ACTIVE" } },
        select: { kind: true, noteDate: true, employee: { select: { id: true, name: true } } },
      });
      return evaluateNoteWithoutStatus(notes.map((n) => ({ employeeId: n.employee.id, name: n.employee.name, kind: n.kind, noteDate: dateOnlyToString(n.noteDate) })));
    },
  },
  {
    id: "notifications.unread",
    async run({ now }) {
      const groups = await db.notificationRecipient.groupBy({
        by: ["employeeId"],
        where: { read: false, notification: { createdAt: { lt: new Date(now.getTime() - 14 * DAY_MS) } }, employee: { employmentStatus: "ACTIVE" } },
        _count: { _all: true },
        having: { employeeId: { _count: { gte: 5 } } },
      });
      const names = await namesById(groups.map((g) => g.employeeId));
      return evaluateUnreadNotices(groups.map((g) => ({ name: names.get(g.employeeId) ?? "Unknown", unread: g._count._all })));
    },
  },
  {
    id: "data.missing-fields",
    async run() {
      const people = await db.employee.findMany({
        where: { employmentStatus: "ACTIVE" },
        select: { name: true, departmentId: true, workLocation: true, supervisorId: true },
      });
      return evaluateMissingFields(people);
    },
  },
  {
    id: "data.unknown-jobcode",
    async run({ now }) {
      const since = new Date(businessToday(now).getTime() - 30 * DAY_MS);
      const [used, codes] = await Promise.all([
        db.timeEntry.groupBy({ by: ["jobCode"], where: { date: { gte: since } }, _count: { _all: true } }),
        db.jobCode.findMany({ select: { code: true } }),
      ]);
      const known = new Set(codes.map((c) => c.code.trim().toLowerCase()));
      return evaluateUnknownJobCodes(used.filter((u) => u.jobCode.trim() && !known.has(u.jobCode.trim().toLowerCase())).map((u) => ({ code: u.jobCode, entries: u._count._all })));
    },
  },
  {
    id: "data.placeholder-values",
    async run() {
      const people = await db.employee.findMany({ where: { employmentStatus: "ACTIVE", gender: "OTHER" }, select: { name: true, gender: true } });
      return evaluatePlaceholders(people);
    },
  },
  {
    id: "data.schedule-gap",
    async run({ now }) {
      const today = businessToday(now);
      const people = await db.employee.findMany({
        where: {
          employmentStatus: "ACTIVE",
          schedules: { some: { date: { gte: new Date(today.getTime() - 60 * DAY_MS), lt: today } }, none: { date: { gte: today, lte: new Date(today.getTime() + 14 * DAY_MS) } } },
        },
        select: { name: true },
      });
      return evaluateScheduleGaps(people.map((p) => p.name));
    },
  },
  {
    id: "sec.audit-watch",
    async run({ now }) {
      const rows = await db.auditLog.findMany({
        where: { createdAt: { gte: new Date(now.getTime() - DAY_MS) }, actorEmail: { not: null } },
        select: { actorEmail: true, action: true, createdAt: true },
      });
      const mapped = rows.map((r) => ({ actor: r.actorEmail!, action: r.action, hourLocal: Number(dateToBusinessLocal(r.createdAt).slice(11, 13)), at: r.createdAt }));
      return [...evaluateAfterHoursAdmin(mapped), ...evaluateLargeExports(mapped), ...evaluateSensitiveDownloads(mapped)];
    },
  },
  {
    id: "sys.kiosk-stale",
    async run({ now }) {
      const sessions = await db.kioskSession.findMany({
        where: { revokedAt: null, expiresAt: { gt: now } },
        select: { id: true, label: true, slug: true, lastUsedAt: true },
      });
      return evaluateKioskStale(sessions.map((s) => ({ id: s.id, label: s.label ?? s.slug ?? "Kiosk", lastUsedAt: s.lastUsedAt })), now);
    },
  },
  {
    id: "sys.db-size",
    async run({ policy }) {
      const [row] = await db.$queryRaw<Array<{ bytes: bigint }>>`SELECT pg_database_size(current_database())::bigint AS bytes`;
      return evaluateDbSize(Number(row?.bytes ?? 0), policy.dbSizeWarnGb);
    },
  },
];
