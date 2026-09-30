"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { notifyEmployees } from "@/lib/notify";
import type { BenefitType, Prisma } from "@prisma/client";
import { tierLabel, utcToday } from "@/lib/benefits";
import { ok, fail, failFromUnknown, type ActionFail, type ActionResult } from "@/lib/action-result";

/**
 * Admin CRUD for the benefits mirror (medical/dental/vision/401(k)). Every
 * action returns `{ id }`, never a raw row — these models carry Decimal
 * fields (costs, percentages) that fail at *runtime in production*, not at
 * build, if they cross the server-action boundary to a client component.
 * See the same note in employees.ts / reimbursements.ts.
 *
 * There is deliberately no `deleteBenefitPlan` action, and no Delete button
 * anywhere in the UI — `deactivateBenefitPlan` is the only removal path. A
 * plan with enrollment history couldn't be deleted anyway: `plan` on
 * BenefitEnrollment/RetirementElection uses `onDelete: Restrict`, so it
 * would just throw Prisma P2003. Not building the action at all is simpler
 * than building one solely to catch and rewrite that error.
 */

const planTypeEnum = z.enum([
  "MEDICAL", "DENTAL", "VISION", "RETIREMENT_401K",
  "LIFE", "DISABILITY_STD", "DISABILITY_LTD", "HSA", "FSA", "OTHER",
]);
const tierEnum = z.enum([
  "EMPLOYEE_ONLY", "EMPLOYEE_SPOUSE", "EMPLOYEE_CHILDREN",
  "EMPLOYEE_PLUS_ONE", "FAMILY", "OTHER",
]);
const costPeriodEnum = z.enum(["PER_PAYCHECK", "MONTHLY", "ANNUAL"]);
const enrollmentStatusEnum = z.enum(["PENDING", "ENROLLED", "WAIVED"]);

/**
 * Rejects a member ID that looks like a raw SSN. Some legacy carrier files
 * still key on full SSN, and this system's own privacy notice promises it
 * stores last-4 only — so a 9-digit numeric member ID is refused outright,
 * and refused with a sharper message when its last 4 digits also match the
 * SSN this system already has on file for the employee.
 */
function failBadMemberId(
  memberId: string | null | undefined,
  ssnLast4: string | null,
): ActionFail | null {
  if (!memberId) return null;
  const trimmed = memberId.trim();
  const looksLikeSSN = /^\d{9}$/.test(trimmed);
  if (!looksLikeSSN) return null;
  const last4 = trimmed.slice(-4);
  if (ssnLast4 && last4 === ssnLast4) {
    return fail(
      "This member ID is a 9-digit number whose last 4 digits match this employee's SSN on file. " +
        "This system stores last-4 SSN only, never the full number — re-enter the carrier's actual member ID.",
    );
  }
  return fail(
    "This member ID is 9 all-numeric digits, which looks like a Social Security Number rather than " +
      "a carrier member ID. Please verify and re-enter the carrier's actual member ID.",
  );
}

const FAR_FUTURE = new Date(8640000000000000);

/**
 * "At most one current row per benefit type" is a temporal invariant no
 * `@@unique` can express — enforced here instead. Violating it double-counts
 * the cost tile and renders two medical cards. Scoped by plan *type*, not
 * plan id, since a renewal creates a new plan row of the same type.
 *
 * Throws a plain Error with a user-facing message so callers can map via
 * failFromUnknown / Error.message when aborting a transaction.
 */
async function assertNoOverlap(
  tx: Prisma.TransactionClient,
  table: "benefitEnrollment" | "retirementElection",
  args: {
    employeeId: string;
    planType: BenefitType;
    effectiveDate: Date;
    endDate: Date | null;
    excludeId?: string;
  },
) {
  const candidates = await (tx[table] as typeof tx.benefitEnrollment).findMany({
    where: {
      employeeId: args.employeeId,
      plan: { type: args.planType },
      id: args.excludeId ? { not: args.excludeId } : undefined,
    },
    select: { effectiveDate: true, endDate: true },
  });
  const newEnd = args.endDate ?? FAR_FUTURE;
  const overlaps = candidates.some((c) => {
    const cEnd = c.endDate ?? FAR_FUTURE;
    return args.effectiveDate < cEnd && c.effectiveDate < newEnd;
  });
  if (overlaps) {
    const label = args.planType.replace(/_/g, " ").toLowerCase();
    throw new Error(
      `This employee already has a ${label} row covering an overlapping date range. At most one ` +
        `current row per benefit type is allowed — end the existing one first, or use "Change tier" ` +
        `for a mid-year switch.`,
    );
  }
}

// ── Plan catalog ──────────────────────────────────────────────────────

const planSchema = z.object({
  type: planTypeEnum,
  name: z.string().min(2).max(120),
  carrierName: z.string().min(2).max(120),
  groupNumber: z.string().optional(),
  carrierPhone: z.string().optional(),
  carrierPortalUrl: z.string().url().optional().or(z.literal("")),
  planYearStart: z.string(),
  planYearEnd: z.string(),
  costPeriod: costPeriodEnum.default("PER_PAYCHECK"),
  matchDescription: z.string().optional(),
  vestingDescription: z.string().optional(),
  notes: z.string().optional(),
});

function revalidateBenefits() {
  revalidatePath("/dashboard/benefits");
  revalidatePath("/admin/benefits");
  revalidatePath("/admin/employees", "layout");
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const parseDay = (s: string) => new Date(`${s}T00:00:00.000Z`);
const validDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parseDay(s).getTime());

/** In-app notice; never throws, never blocks the admin action. */
function notifyBenefits(employeeIds: string[], title: string, message: string) {
  return notifyEmployees(employeeIds, {
    type: "BENEFITS",
    title,
    message,
    link: "/dashboard/benefits",
  });
}

export async function createBenefitPlan(
  input: z.infer<typeof planSchema>,
): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  try {
    const data = planSchema.parse(input);
    const plan = await db.benefitPlan.create({
      data: {
        type: data.type,
        name: data.name,
        carrierName: data.carrierName,
        groupNumber: data.groupNumber || null,
        carrierPhone: data.carrierPhone || null,
        carrierPortalUrl: data.carrierPortalUrl || null,
        planYearStart: new Date(data.planYearStart),
        planYearEnd: new Date(data.planYearEnd),
        costPeriod: data.costPeriod,
        matchDescription: data.matchDescription || null,
        vestingDescription: data.vestingDescription || null,
        notes: data.notes || null,
        createdById: admin.id,
      },
    });
    await audit({
      action: "benefits.create_plan",
      resource: `BenefitPlan:${plan.id}`,
      diff: { type: data.type, name: data.name },
    });
    revalidateBenefits();
    return ok({ id: plan.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

export async function updateBenefitPlan(
  id: string,
  input: z.infer<typeof planSchema>,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  try {
    const data = planSchema.parse(input);
    const plan = await db.benefitPlan.update({
      where: { id },
      data: {
        type: data.type,
        name: data.name,
        carrierName: data.carrierName,
        groupNumber: data.groupNumber || null,
        carrierPhone: data.carrierPhone || null,
        carrierPortalUrl: data.carrierPortalUrl || null,
        planYearStart: new Date(data.planYearStart),
        planYearEnd: new Date(data.planYearEnd),
        costPeriod: data.costPeriod,
        matchDescription: data.matchDescription || null,
        vestingDescription: data.vestingDescription || null,
        notes: data.notes || null,
      },
    });
    await audit({ action: "benefits.update_plan", resource: `BenefitPlan:${plan.id}` });
    revalidateBenefits();
    return ok({ id: plan.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

export async function deactivateBenefitPlan(id: string): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  try {
    const plan = await db.benefitPlan.update({ where: { id }, data: { isActive: false } });
    await audit({ action: "benefits.deactivate_plan", resource: `BenefitPlan:${id}` });
    revalidateBenefits();
    return ok({ id: plan.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

const tierPriceSchema = z.object({
  tier: tierEnum,
  employeeCost: z.coerce.number().min(0),
  employerCost: z.coerce.number().min(0),
});

export async function upsertPlanTiers(
  planId: string,
  tiers: z.infer<typeof tierPriceSchema>[],
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  try {
    const data = z.array(tierPriceSchema).min(1).parse(tiers);
    await db.$transaction(
      data.map((t) =>
        db.benefitPlanTier.upsert({
          where: { planId_tier: { planId, tier: t.tier } },
          create: { planId, tier: t.tier, employeeCost: t.employeeCost, employerCost: t.employerCost },
          update: { employeeCost: t.employeeCost, employerCost: t.employerCost },
        }),
      ),
    );
    await audit({
      action: "benefits.upsert_plan_tiers",
      resource: `BenefitPlan:${planId}`,
      diff: { tierCount: data.length },
    });
    revalidateBenefits();
    return ok({ id: planId });
  } catch (err) {
    return failFromUnknown(err);
  }
}

const planWithTiersSchema = planSchema.extend({
  id: z.string().optional(),
  /**
   * The COMPLETE desired tier price list for a non-401(k) plan. Omitted tiers
   * are removed (blocked if an enrollment still uses them). Leave undefined to
   * leave tiers untouched.
   */
  tiers: z.array(tierPriceSchema).optional(),
});

/**
 * Create or edit a plan together with its tier prices in ONE transaction, so a
 * failed tier write can never leave a half-saved plan, and a tier can be
 * removed (explicitly, by leaving it out of `tiers`).
 */
export async function upsertBenefitPlan(
  input: z.input<typeof planWithTiersSchema>,
): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  try {
    const data = planWithTiersSchema.parse(input);
    if (!validDay(data.planYearStart) || !validDay(data.planYearEnd)) {
      return fail("Enter a valid plan year start and end date.");
    }
    if (data.planYearEnd <= data.planYearStart) {
      return fail("The plan year must end after it starts.");
    }
    const seen = new Set<string>();
    for (const t of data.tiers ?? []) {
      if (seen.has(t.tier)) return fail(`The ${tierLabel(t.tier)} tier is listed twice.`);
      seen.add(t.tier);
    }

    const planId = await db.$transaction(async (tx) => {
      const fields = {
        type: data.type,
        name: data.name,
        carrierName: data.carrierName,
        groupNumber: data.groupNumber || null,
        carrierPhone: data.carrierPhone || null,
        carrierPortalUrl: data.carrierPortalUrl || null,
        planYearStart: parseDay(data.planYearStart),
        planYearEnd: parseDay(data.planYearEnd),
        costPeriod: data.costPeriod,
        matchDescription: data.matchDescription || null,
        vestingDescription: data.vestingDescription || null,
        notes: data.notes || null,
      };

      let id: string;
      if (data.id) {
        const existing = await tx.benefitPlan.findUnique({ where: { id: data.id } });
        if (!existing) throw new Error("That benefit plan no longer exists. Refresh the page and try again.");
        if (existing.type !== data.type) {
          const used =
            (await tx.benefitEnrollment.count({ where: { planId: existing.id } })) +
            (await tx.retirementElection.count({ where: { planId: existing.id } }));
          if (used > 0) {
            throw new Error("The plan type can't change once employees have coverage under it. Create a new plan instead.");
          }
        }
        await tx.benefitPlan.update({ where: { id: existing.id }, data: fields });
        id = existing.id;
      } else {
        const created = await tx.benefitPlan.create({ data: { ...fields, createdById: admin.id } });
        id = created.id;
      }

      if (data.tiers && data.type !== "RETIREMENT_401K") {
        const keep = new Set(data.tiers.map((t) => t.tier));
        const existingTiers = await tx.benefitPlanTier.findMany({ where: { planId: id } });
        const removed = existingTiers.filter((t) => !keep.has(t.tier));
        if (removed.length > 0) {
          const inUse = await tx.benefitEnrollment.groupBy({
            by: ["tier"],
            where: { planId: id, tier: { in: removed.map((t) => t.tier) } },
            _count: { _all: true },
          });
          if (inUse.length > 0) {
            const names = inUse.map((u) => `${tierLabel(u.tier)} (${u._count._all})`).join(", ");
            throw new Error(
              `Can't remove a tier that employees are enrolled in: ${names}. End or change those enrollments first.`,
            );
          }
          await tx.benefitPlanTier.deleteMany({
            where: { planId: id, tier: { in: removed.map((t) => t.tier) } },
          });
        }
        for (const t of data.tiers) {
          await tx.benefitPlanTier.upsert({
            where: { planId_tier: { planId: id, tier: t.tier } },
            create: { planId: id, tier: t.tier, employeeCost: t.employeeCost, employerCost: t.employerCost },
            update: { employeeCost: t.employeeCost, employerCost: t.employerCost },
          });
        }
      }
      return id;
    });

    await audit({
      action: data.id ? "benefits.update_plan" : "benefits.create_plan",
      resource: `BenefitPlan:${planId}`,
      diff: { type: data.type, name: data.name, tierCount: data.tiers?.length },
    });
    revalidateBenefits();
    return ok({ id: planId });
  } catch (err) {
    return failFromUnknown(err);
  }
}

// ── Enrollments ────────────────────────────────────────────────────────

const enrollmentSchema = z
  .object({
    id: z.string().optional(),
    employeeId: z.string(),
    planId: z.string(),
    tier: tierEnum.nullable(),
    status: enrollmentStatusEnum,
    effectiveDate: z.string(),
    memberId: z.string().optional(),
    employeeCostOverride: z.coerce.number().min(0).optional().nullable(),
    employerCostOverride: z.coerce.number().min(0).optional().nullable(),
    notes: z.string().optional(),
  })
  .refine((d) => (d.status === "WAIVED" ? d.tier === null : d.tier !== null), {
    message: "Select a tier unless the employee waived this benefit",
    path: ["tier"],
  });

/**
 * Create a new enrollment, or correct non-temporal fields (member ID, cost
 * overrides, notes) on an existing one. Does NOT change tier or dates on an
 * existing row in a way that breaks the historical record — a real tier
 * change must go through `changeEnrollmentTier` (end + new row); the admin
 * UI only ever exposes this as create, plus "Change tier" as a separate
 * action.
 */
export async function upsertEnrollment(
  input: z.infer<typeof enrollmentSchema>,
): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  try {
    const data = enrollmentSchema.parse(input);

    const existing = data.id
      ? await db.benefitEnrollment.findUnique({ where: { id: data.id } })
      : null;
    if (data.id && !existing) {
      return fail("That enrollment no longer exists. Refresh the page and try again.");
    }
    if (existing && (existing.employeeId !== data.employeeId || existing.planId !== data.planId)) {
      return fail("An existing enrollment's employee and plan can't be changed. End it and create a new one.");
    }
    if (!existing && !validDay(data.effectiveDate)) {
      return fail("Enter a valid effective date.");
    }
    // On update the stored row dates are authoritative (the form may not even
    // carry them); on create the open-ended new span is what gets checked.
    const effectiveDate = existing ? existing.effectiveDate : parseDay(data.effectiveDate);
    const endDate = existing ? existing.endDate : null;

    const [employee, plan] = await Promise.all([
      db.employee.findUnique({ where: { id: data.employeeId }, select: { ssnLast4: true } }),
      db.benefitPlan.findUnique({
        where: { id: data.planId },
        select: { type: true, name: true, tiers: { select: { tier: true } } },
      }),
    ]);
    if (!employee) {
      return fail("That employee no longer exists. Refresh the page and pick another employee.");
    }
    if (!plan) {
      return fail("That benefit plan no longer exists. Refresh the page and pick another plan.");
    }
    if (plan.type === "RETIREMENT_401K") {
      return fail("Use the 401(k) election form for retirement plans.");
    }
    if (data.tier && plan.tiers.length > 0 && !plan.tiers.some((t) => t.tier === data.tier)) {
      return fail(`${plan.name} has no price for the ${tierLabel(data.tier)} tier. Add it to the plan first.`);
    }
    const memberFail = failBadMemberId(data.memberId, employee.ssnLast4);
    if (memberFail) return memberFail;

    const row = await db.$transaction(async (tx) => {
      await assertNoOverlap(tx, "benefitEnrollment", {
        employeeId: data.employeeId,
        planType: plan.type,
        effectiveDate,
        endDate,
        excludeId: data.id,
      });

      if (existing) {
        return tx.benefitEnrollment.update({
          where: { id: existing.id },
          data: {
            tier: data.tier,
            status: data.status,
            memberId: data.memberId || null,
            employeeCostOverride: data.employeeCostOverride ?? null,
            employerCostOverride: data.employerCostOverride ?? null,
            notes: data.notes || null,
            confirmedAsOf: new Date(),
          },
        });
      }
      return tx.benefitEnrollment.create({
        data: {
          employeeId: data.employeeId,
          planId: data.planId,
          tier: data.tier,
          status: data.status,
          effectiveDate,
          memberId: data.memberId || null,
          employeeCostOverride: data.employeeCostOverride ?? null,
          employerCostOverride: data.employerCostOverride ?? null,
          notes: data.notes || null,
          confirmedAsOf: new Date(),
          createdById: admin.id,
        },
      });
    });

    await audit({
      action: data.id ? "benefits.update_enrollment" : "benefits.create_enrollment",
      resource: `BenefitEnrollment:${row.id}`,
      diff: { employeeId: data.employeeId, planId: data.planId, status: data.status, previousStatus: existing?.status },
    });
    await notifyBenefits(
      [data.employeeId],
      "Benefits updated",
      data.status === "WAIVED"
        ? `Your waiver of ${plan.name} was recorded.`
        : `Your ${plan.name} enrollment was ${existing ? "updated" : "entered"} (${data.status === "PENDING" ? "pending confirmation" : "enrolled"}).`,
    );
    revalidateBenefits();
    return ok({ id: row.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

/** Admin confirms a PENDING enrollment (PENDING -> ENROLLED). */
export async function confirmEnrollment(id: string): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  try {
    const row = await db.benefitEnrollment.findUnique({
      where: { id },
      include: { plan: { select: { name: true } } },
    });
    if (!row) return fail("That enrollment no longer exists. Refresh the page and try again.");
    if (row.status !== "PENDING") {
      return fail("Only a pending enrollment can be confirmed. Refresh the page.");
    }
    if (row.endDate && row.endDate <= utcToday()) {
      return fail("That enrollment has already ended; there is nothing to confirm.");
    }
    await db.benefitEnrollment.update({
      where: { id },
      data: { status: "ENROLLED", confirmedAsOf: new Date() },
    });
    await audit({
      action: "benefits.confirm_enrollment",
      resource: `BenefitEnrollment:${id}`,
      diff: { employeeId: row.employeeId, from: "PENDING", to: "ENROLLED" },
    });
    await notifyBenefits(
      [row.employeeId],
      "Enrollment confirmed",
      `Your ${row.plan.name} enrollment is confirmed, effective ${dayKey(row.effectiveDate)}.`,
    );
    revalidateBenefits();
    return ok({ id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

const changeTierSchema = z.object({
  enrollmentId: z.string(),
  newTier: tierEnum,
  effectiveDate: z.string(),
  memberId: z.string().optional(),
});

/**
 * The only sanctioned way to change tier mid-year: END the current row and
 * CREATE a new one, atomically. In-place edits are never exposed for this
 * because they'd destroy the record of what the employee was paying before
 * the change — the one thing a payroll-deduction mirror exists to preserve.
 */
export async function changeEnrollmentTier(
  input: z.infer<typeof changeTierSchema>,
): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  try {
    const data = changeTierSchema.parse(input);
    if (!validDay(data.effectiveDate)) return fail("Enter a valid effective date.");
    const newEffectiveDate = parseDay(data.effectiveDate);

    const old = await db.benefitEnrollment.findUnique({
      where: { id: data.enrollmentId },
      include: { plan: { select: { type: true, name: true, tiers: { select: { tier: true } } } } },
    });
    if (!old) {
      return fail("That enrollment no longer exists. Refresh the page and try again.");
    }
    if (old.endDate) {
      return fail("That enrollment has already ended, so its tier can't be changed. Enroll the employee again instead.");
    }
    if (old.status === "WAIVED") {
      return fail("A waived benefit has no tier to change. Create a new enrollment instead.");
    }
    if (newEffectiveDate <= old.effectiveDate) {
      return fail(
        "The new tier's effective date must be after the current enrollment's effective date. Pick a later date and try again.",
      );
    }
    if (old.plan.tiers.length > 0 && !old.plan.tiers.some((t) => t.tier === data.newTier)) {
      return fail(`${old.plan.name} has no price for the ${tierLabel(data.newTier)} tier. Add it to the plan first.`);
    }

    const employee = await db.employee.findUnique({
      where: { id: old.employeeId },
      select: { ssnLast4: true },
    });
    if (!employee) {
      return fail("That employee no longer exists. Refresh the page and try again.");
    }
    const memberId = data.memberId ?? old.memberId ?? undefined;
    const memberFail = failBadMemberId(memberId, employee.ssnLast4);
    if (memberFail) return memberFail;

    const created = await db.$transaction(async (tx) => {
      await tx.benefitEnrollment.update({
        where: { id: old.id },
        data: { endDate: newEffectiveDate },
      });

      await assertNoOverlap(tx, "benefitEnrollment", {
        employeeId: old.employeeId,
        planType: old.plan.type,
        effectiveDate: newEffectiveDate,
        endDate: null,
        excludeId: old.id,
      });

      return tx.benefitEnrollment.create({
        data: {
          employeeId: old.employeeId,
          planId: old.planId,
          tier: data.newTier,
          status: "ENROLLED",
          effectiveDate: newEffectiveDate,
          memberId: memberId || null,
          confirmedAsOf: new Date(),
          createdById: admin.id,
        },
      });
    });

    await audit({
      action: "benefits.change_enrollment_tier",
      resource: `BenefitEnrollment:${created.id}`,
      diff: { previousEnrollmentId: data.enrollmentId, newTier: data.newTier },
    });
    await notifyBenefits(
      [old.employeeId],
      "Benefits tier changed",
      `Your ${old.plan.name} coverage changes to ${tierLabel(data.newTier)} effective ${data.effectiveDate}.`,
    );
    revalidateBenefits();
    return ok({ id: created.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

const endEnrollmentSchema = z.object({
  enrollmentId: z.string(),
  endDate: z.string(),
  notes: z.string().optional(),
});

export async function endEnrollment(
  input: z.infer<typeof endEnrollmentSchema>,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  try {
    const data = endEnrollmentSchema.parse(input);
    if (!validDay(data.endDate)) return fail("Enter a valid end date.");
    const endDate = parseDay(data.endDate);
    const existing = await db.benefitEnrollment.findUnique({
      where: { id: data.enrollmentId },
      include: { plan: { select: { name: true } } },
    });
    if (!existing) return fail("That enrollment no longer exists. Refresh the page and try again.");
    if (existing.endDate) {
      return fail(`That enrollment already ended on ${dayKey(existing.endDate)}. Refresh the page.`);
    }
    if (endDate < existing.effectiveDate) {
      return fail(`The end date can't be before the effective date (${dayKey(existing.effectiveDate)}).`);
    }
    const row = await db.benefitEnrollment.update({
      where: { id: data.enrollmentId },
      data: {
        endDate,
        notes: data.notes || undefined,
        confirmedAsOf: new Date(),
      },
    });
    await audit({
      action: "benefits.end_enrollment",
      resource: `BenefitEnrollment:${row.id}`,
      diff: { endDate: data.endDate },
    });
    await notifyBenefits(
      [existing.employeeId],
      "Benefits coverage ending",
      `Your ${existing.plan.name} coverage ends ${data.endDate}.`,
    );
    revalidateBenefits();
    return ok({ id: row.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

// ── Retirement (401(k)) ──────────────────────────────────────────────

const retirementSchema = z
  .object({
    id: z.string().optional(),
    employeeId: z.string(),
    planId: z.string(),
    status: enrollmentStatusEnum,
    preTaxPercent: z.coerce.number().min(0).max(100).optional().nullable(),
    rothPercent: z.coerce.number().min(0).max(100).optional().nullable(),
    flatAmountPerPay: z.coerce.number().min(0).optional().nullable(),
    effectiveDate: z.string(),
    notes: z.string().optional(),
  })
  .refine(
    (d) => {
      const hasPercent = d.preTaxPercent != null || d.rothPercent != null;
      const hasFlat = d.flatAmountPerPay != null;
      return !(hasPercent && hasFlat);
    },
    {
      message: "Enter either a percentage deferral or a flat amount per paycheck, not both",
      path: ["flatAmountPerPay"],
    },
  )
  .refine((d) => (d.preTaxPercent ?? 0) + (d.rothPercent ?? 0) <= 100, {
    message: "Pre-tax and Roth deferral percentages can't add up to more than 100%",
    path: ["rothPercent"],
  });

export async function upsertRetirementElection(
  input: z.infer<typeof retirementSchema>,
): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  try {
    const data = retirementSchema.parse(input);

    const existing = data.id
      ? await db.retirementElection.findUnique({ where: { id: data.id } })
      : null;
    if (data.id && !existing) {
      return fail("That election no longer exists. Refresh the page and try again.");
    }
    if (existing && (existing.employeeId !== data.employeeId || existing.planId !== data.planId)) {
      return fail("An existing election's employee and plan can't be changed. End it and create a new one.");
    }
    if (!existing && !validDay(data.effectiveDate)) return fail("Enter a valid effective date.");
    const effectiveDate = existing ? existing.effectiveDate : parseDay(data.effectiveDate);
    const endDate = existing ? existing.endDate : null;

    const [employee, plan] = await Promise.all([
      db.employee.findUnique({ where: { id: data.employeeId }, select: { id: true } }),
      db.benefitPlan.findUnique({ where: { id: data.planId }, select: { type: true, name: true } }),
    ]);
    if (!employee) return fail("That employee no longer exists. Refresh the page and try again.");
    if (!plan || plan.type !== "RETIREMENT_401K") {
      return fail("Pick a 401(k) plan for a retirement election.");
    }

    const row = await db.$transaction(async (tx) => {
      await assertNoOverlap(tx, "retirementElection", {
        employeeId: data.employeeId,
        planType: "RETIREMENT_401K",
        effectiveDate,
        endDate,
        excludeId: data.id,
      });

      if (existing) {
        return tx.retirementElection.update({
          where: { id: existing.id },
          data: {
            status: data.status,
            preTaxPercent: data.preTaxPercent ?? null,
            rothPercent: data.rothPercent ?? null,
            flatAmountPerPay: data.flatAmountPerPay ?? null,
            notes: data.notes || null,
            confirmedAsOf: new Date(),
          },
        });
      }
      return tx.retirementElection.create({
        data: {
          employeeId: data.employeeId,
          planId: data.planId,
          status: data.status,
          preTaxPercent: data.preTaxPercent ?? null,
          rothPercent: data.rothPercent ?? null,
          flatAmountPerPay: data.flatAmountPerPay ?? null,
          effectiveDate,
          notes: data.notes || null,
          confirmedAsOf: new Date(),
          createdById: admin.id,
        },
      });
    });

    await audit({
      action: data.id ? "benefits.update_retirement_election" : "benefits.create_retirement_election",
      resource: `RetirementElection:${row.id}`,
      diff: { employeeId: data.employeeId, status: data.status },
    });
    await notifyBenefits(
      [data.employeeId],
      "Benefits updated",
      `Your ${plan.name} 401(k) election was ${existing ? "updated" : "entered"}.`,
    );
    revalidateBenefits();
    return ok({ id: row.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

/** Admin confirms a PENDING 401(k) election (PENDING -> ENROLLED). */
export async function confirmRetirementElection(id: string): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  try {
    const row = await db.retirementElection.findUnique({
      where: { id },
      include: { plan: { select: { name: true } } },
    });
    if (!row) return fail("That election no longer exists. Refresh the page and try again.");
    if (row.status !== "PENDING") return fail("Only a pending election can be confirmed. Refresh the page.");
    if (row.endDate && row.endDate <= utcToday()) {
      return fail("That election has already ended; there is nothing to confirm.");
    }
    await db.retirementElection.update({
      where: { id },
      data: { status: "ENROLLED", confirmedAsOf: new Date() },
    });
    await audit({
      action: "benefits.confirm_retirement_election",
      resource: `RetirementElection:${id}`,
      diff: { employeeId: row.employeeId, from: "PENDING", to: "ENROLLED" },
    });
    await notifyBenefits(
      [row.employeeId],
      "401(k) election confirmed",
      `Your ${row.plan.name} 401(k) election is confirmed.`,
    );
    revalidateBenefits();
    return ok({ id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

const endElectionSchema = z.object({
  electionId: z.string(),
  endDate: z.string(),
  notes: z.string().optional(),
});

export async function endRetirementElection(
  input: z.infer<typeof endElectionSchema>,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  try {
    const data = endElectionSchema.parse(input);
    if (!validDay(data.endDate)) return fail("Enter a valid end date.");
    const endDate = parseDay(data.endDate);
    const existing = await db.retirementElection.findUnique({
      where: { id: data.electionId },
      include: { plan: { select: { name: true } } },
    });
    if (!existing) return fail("That election no longer exists. Refresh the page and try again.");
    if (existing.endDate) {
      return fail(`That election already ended on ${dayKey(existing.endDate)}. Refresh the page.`);
    }
    if (endDate < existing.effectiveDate) {
      return fail(`The end date can't be before the effective date (${dayKey(existing.effectiveDate)}).`);
    }
    const row = await db.retirementElection.update({
      where: { id: data.electionId },
      data: {
        endDate,
        notes: data.notes || undefined,
        confirmedAsOf: new Date(),
      },
    });
    await audit({
      action: "benefits.end_retirement_election",
      resource: `RetirementElection:${row.id}`,
      diff: { endDate: data.endDate },
    });
    await notifyBenefits(
      [existing.employeeId],
      "401(k) election ended",
      `Your ${existing.plan.name} 401(k) deferral stops ${data.endDate}.`,
    );
    revalidateBenefits();
    return ok({ id: row.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

// ── Annual renewal ────────────────────────────────────────────────────

const rollForwardSchema = z.object({
  oldPlanId: z.string(),
  planYearStart: z.string(),
  planYearEnd: z.string(),
  tiers: z.array(tierPriceSchema).optional(),
});

/**
 * Makes the annual renewal a click: clones the plan (+ tiers) into a new
 * plan-year row, then ends every open enrollment/election on the old plan at
 * the new plan's start date and mirrors it onto the new one, carrying
 * tier/deferral forward. Runs in ONE transaction and is idempotent: the new
 * plan records `rolledFromId` (unique), so a plan can only be rolled once, and
 * the old plan is deactivated. Tier prices default to the old plan's; any
 * supplied in `tiers` override. Cost overrides are deliberately dropped — an
 * override is negotiated against a specific year's rate.
 */
export async function rollForwardPlanYear(
  input: z.infer<typeof rollForwardSchema>,
): Promise<ActionResult<{ id: string; migratedCount: number }>> {
  const admin = await requireAdmin();
  try {
    const data = rollForwardSchema.parse(input);
    if (!validDay(data.planYearStart) || !validDay(data.planYearEnd)) {
      return fail("Enter a valid start and end date for the new plan year.");
    }
    const newStart = parseDay(data.planYearStart);
    const newEnd = parseDay(data.planYearEnd);
    if (newEnd <= newStart) return fail("The new plan year must end after it starts.");

    const result = await db.$transaction(async (tx) => {
      const oldPlan = await tx.benefitPlan.findUnique({
        where: { id: data.oldPlanId },
        include: { tiers: true },
      });
      if (!oldPlan) {
        throw new Error("That benefit plan no longer exists. Refresh the page and try again.");
      }
      const already = await tx.benefitPlan.findUnique({
        where: { rolledFromId: oldPlan.id },
        select: { name: true, planYearStart: true, planYearEnd: true },
      });
      if (already) {
        throw new Error(
          `This plan was already rolled forward (new plan year ${dayKey(already.planYearStart)} to ${dayKey(already.planYearEnd)}). Refresh the page.`,
        );
      }
      if (newStart < oldPlan.planYearEnd) {
        throw new Error(
          `The new plan year can't start before the current one ends (${dayKey(oldPlan.planYearEnd)}).`,
        );
      }

      // Tier prices: the old plan's, overridden by whatever was supplied.
      const prices = new Map(
        oldPlan.tiers.map((t) => [
          t.tier,
          { employeeCost: Number(t.employeeCost), employerCost: Number(t.employerCost) },
        ]),
      );
      if (oldPlan.type !== "RETIREMENT_401K") {
        for (const t of data.tiers ?? []) {
          prices.set(t.tier, { employeeCost: t.employeeCost, employerCost: t.employerCost });
        }
      }

      const isRetirement = oldPlan.type === "RETIREMENT_401K";
      const openEnrollments = isRetirement
        ? []
        : await tx.benefitEnrollment.findMany({ where: { planId: oldPlan.id, endDate: null } });
      const openElections = isRetirement
        ? await tx.retirementElection.findMany({ where: { planId: oldPlan.id, endDate: null } })
        : [];

      for (const row of [...openEnrollments, ...openElections]) {
        if (row.effectiveDate >= newStart) {
          throw new Error(
            "An open enrollment starts on or after the new plan year start. Pick a later start date, or end that enrollment first.",
          );
        }
      }
      for (const en of openEnrollments) {
        if (en.tier && !prices.has(en.tier)) {
          throw new Error(
            `Employees are enrolled in the ${tierLabel(en.tier)} tier but it has no price. Enter a price for it.`,
          );
        }
      }

      const newPlan = await tx.benefitPlan.create({
        data: {
          type: oldPlan.type,
          name: oldPlan.name,
          carrierName: oldPlan.carrierName,
          groupNumber: oldPlan.groupNumber,
          carrierPhone: oldPlan.carrierPhone,
          carrierPortalUrl: oldPlan.carrierPortalUrl,
          planYearStart: newStart,
          planYearEnd: newEnd,
          costPeriod: oldPlan.costPeriod,
          matchDescription: oldPlan.matchDescription,
          vestingDescription: oldPlan.vestingDescription,
          rolledFromId: oldPlan.id,
          createdById: admin.id,
        },
      });

      if (prices.size > 0) {
        await tx.benefitPlanTier.createMany({
          data: [...prices.entries()].map(([tier, p]) => ({
            planId: newPlan.id,
            tier,
            employeeCost: p.employeeCost,
            employerCost: p.employerCost,
          })),
        });
      }

      for (const e of openElections) {
        await tx.retirementElection.update({ where: { id: e.id }, data: { endDate: newStart } });
        await tx.retirementElection.create({
          data: {
            employeeId: e.employeeId,
            planId: newPlan.id,
            status: e.status,
            preTaxPercent: e.preTaxPercent,
            rothPercent: e.rothPercent,
            flatAmountPerPay: e.flatAmountPerPay,
            effectiveDate: newStart,
            confirmedAsOf: new Date(),
            createdById: admin.id,
          },
        });
      }
      for (const en of openEnrollments) {
        await tx.benefitEnrollment.update({ where: { id: en.id }, data: { endDate: newStart } });
        await tx.benefitEnrollment.create({
          data: {
            employeeId: en.employeeId,
            planId: newPlan.id,
            tier: en.tier,
            status: en.status,
            effectiveDate: newStart,
            memberId: en.memberId,
            confirmedAsOf: new Date(),
            createdById: admin.id,
          },
        });
      }

      await tx.benefitPlan.update({ where: { id: oldPlan.id }, data: { isActive: false } });

      return {
        planId: newPlan.id,
        planName: oldPlan.name,
        employeeIds: [...openEnrollments, ...openElections].map((r) => r.employeeId),
      };
    });

    await audit({
      action: "benefits.roll_forward_plan_year",
      resource: `BenefitPlan:${result.planId}`,
      diff: { oldPlanId: data.oldPlanId, migratedCount: result.employeeIds.length },
    });
    await notifyBenefits(
      result.employeeIds,
      "Benefits renewed",
      `Your ${result.planName} coverage was renewed for the plan year starting ${data.planYearStart}.`,
    );
    revalidateBenefits();
    return ok({ id: result.planId, migratedCount: result.employeeIds.length });
  } catch (err) {
    if ((err as { code?: string } | null)?.code === "P2002") {
      return fail("This plan was already rolled forward. Refresh the page.");
    }
    return failFromUnknown(err);
  }
}

/** For after the annual broker audit — stamps confirmedAsOf=now on every
 * currently-open enrollment and election so the freshness StatCard resets. */
export async function markAllVerifiedToday(): Promise<
  ActionResult<{ enrollments: number; elections: number }>
> {
  await requireAdmin();
  try {
    const now = new Date();
    const [enrollments, elections] = await db.$transaction([
      db.benefitEnrollment.updateMany({ where: { endDate: null }, data: { confirmedAsOf: now } }),
      db.retirementElection.updateMany({ where: { endDate: null }, data: { confirmedAsOf: now } }),
    ]);
    await audit({
      action: "benefits.mark_all_verified",
      resource: "BenefitEnrollment:*",
      diff: { enrollments: enrollments.count, elections: elections.count },
    });
    revalidateBenefits();
    return ok({ enrollments: enrollments.count, elections: elections.count });
  } catch (err) {
    return failFromUnknown(err);
  }
}
