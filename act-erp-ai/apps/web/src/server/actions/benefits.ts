"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { BenefitType, Prisma } from "@prisma/client";

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
function checkMemberId(memberId: string | null | undefined, ssnLast4: string | null) {
  if (!memberId) return;
  const trimmed = memberId.trim();
  const looksLikeSSN = /^\d{9}$/.test(trimmed);
  if (!looksLikeSSN) return;
  const last4 = trimmed.slice(-4);
  if (ssnLast4 && last4 === ssnLast4) {
    throw new Error(
      "This member ID is a 9-digit number whose last 4 digits match this employee's SSN on file. " +
        "This system stores last-4 SSN only, never the full number — re-enter the carrier's actual member ID.",
    );
  }
  throw new Error(
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
}

export async function createBenefitPlan(input: z.infer<typeof planSchema>) {
  const admin = await requireAdmin();
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
  return { id: plan.id };
}

export async function updateBenefitPlan(id: string, input: z.infer<typeof planSchema>) {
  await requireAdmin();
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
  return { id: plan.id };
}

export async function deactivateBenefitPlan(id: string) {
  await requireAdmin();
  const plan = await db.benefitPlan.update({ where: { id }, data: { isActive: false } });
  await audit({ action: "benefits.deactivate_plan", resource: `BenefitPlan:${id}` });
  revalidateBenefits();
  return { id: plan.id };
}

const tierPriceSchema = z.object({
  tier: tierEnum,
  employeeCost: z.coerce.number().min(0),
  employerCost: z.coerce.number().min(0),
});

export async function upsertPlanTiers(planId: string, tiers: z.infer<typeof tierPriceSchema>[]) {
  await requireAdmin();
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
  return { id: planId };
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
    employeeCostOverride: z.coerce.number().optional().nullable(),
    employerCostOverride: z.coerce.number().optional().nullable(),
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
export async function upsertEnrollment(input: z.infer<typeof enrollmentSchema>) {
  const admin = await requireAdmin();
  const data = enrollmentSchema.parse(input);
  const effectiveDate = new Date(data.effectiveDate);

  const [employee, plan] = await Promise.all([
    db.employee.findUniqueOrThrow({ where: { id: data.employeeId }, select: { ssnLast4: true } }),
    db.benefitPlan.findUniqueOrThrow({ where: { id: data.planId }, select: { type: true } }),
  ]);
  checkMemberId(data.memberId, employee.ssnLast4);

  const row = await db.$transaction(async (tx) => {
    await assertNoOverlap(tx, "benefitEnrollment", {
      employeeId: data.employeeId,
      planType: plan.type,
      effectiveDate,
      endDate: null,
      excludeId: data.id,
    });

    if (data.id) {
      return tx.benefitEnrollment.update({
        where: { id: data.id },
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
    diff: { employeeId: data.employeeId, planId: data.planId, status: data.status },
  });
  revalidateBenefits();
  return { id: row.id };
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
export async function changeEnrollmentTier(input: z.infer<typeof changeTierSchema>) {
  const admin = await requireAdmin();
  const data = changeTierSchema.parse(input);
  const newEffectiveDate = new Date(data.effectiveDate);

  const created = await db.$transaction(async (tx) => {
    const old = await tx.benefitEnrollment.findUniqueOrThrow({
      where: { id: data.enrollmentId },
      include: { plan: { select: { type: true } } },
    });
    if (newEffectiveDate <= old.effectiveDate) {
      throw new Error("The new tier's effective date must be after the current enrollment's effective date.");
    }

    const employee = await tx.employee.findUniqueOrThrow({
      where: { id: old.employeeId },
      select: { ssnLast4: true },
    });
    const memberId = data.memberId ?? old.memberId ?? undefined;
    checkMemberId(memberId, employee.ssnLast4);

    await tx.benefitEnrollment.update({ where: { id: old.id }, data: { endDate: newEffectiveDate } });

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
  revalidateBenefits();
  return { id: created.id };
}

const endEnrollmentSchema = z.object({
  enrollmentId: z.string(),
  endDate: z.string(),
  notes: z.string().optional(),
});

export async function endEnrollment(input: z.infer<typeof endEnrollmentSchema>) {
  await requireAdmin();
  const data = endEnrollmentSchema.parse(input);
  const row = await db.benefitEnrollment.update({
    where: { id: data.enrollmentId },
    data: {
      endDate: new Date(data.endDate),
      notes: data.notes || undefined,
      confirmedAsOf: new Date(),
    },
  });
  await audit({
    action: "benefits.end_enrollment",
    resource: `BenefitEnrollment:${row.id}`,
    diff: { endDate: data.endDate },
  });
  revalidateBenefits();
  return { id: row.id };
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
  );

export async function upsertRetirementElection(input: z.infer<typeof retirementSchema>) {
  const admin = await requireAdmin();
  const data = retirementSchema.parse(input);
  const effectiveDate = new Date(data.effectiveDate);

  const row = await db.$transaction(async (tx) => {
    await assertNoOverlap(tx, "retirementElection", {
      employeeId: data.employeeId,
      planType: "RETIREMENT_401K",
      effectiveDate,
      endDate: null,
      excludeId: data.id,
    });

    if (data.id) {
      return tx.retirementElection.update({
        where: { id: data.id },
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
  revalidateBenefits();
  return { id: row.id };
}

const endElectionSchema = z.object({
  electionId: z.string(),
  endDate: z.string(),
  notes: z.string().optional(),
});

export async function endRetirementElection(input: z.infer<typeof endElectionSchema>) {
  await requireAdmin();
  const data = endElectionSchema.parse(input);
  const row = await db.retirementElection.update({
    where: { id: data.electionId },
    data: {
      endDate: new Date(data.endDate),
      notes: data.notes || undefined,
      confirmedAsOf: new Date(),
    },
  });
  await audit({
    action: "benefits.end_retirement_election",
    resource: `RetirementElection:${row.id}`,
    diff: { endDate: data.endDate },
  });
  revalidateBenefits();
  return { id: row.id };
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
 * plan-year row, then ends every open enrollment/election on the old plan
 * and mirrors it onto the new one, carrying tier/deferral forward.
 * Cost overrides are deliberately dropped — an override is negotiated
 * against a specific year's rate; carrying it forward silently is worse
 * than losing it.
 */
export async function rollForwardPlanYear(input: z.infer<typeof rollForwardSchema>) {
  const admin = await requireAdmin();
  const data = rollForwardSchema.parse(input);

  const result = await db.$transaction(async (tx) => {
    const oldPlan = await tx.benefitPlan.findUniqueOrThrow({ where: { id: data.oldPlanId } });

    const newPlan = await tx.benefitPlan.create({
      data: {
        type: oldPlan.type,
        name: oldPlan.name,
        carrierName: oldPlan.carrierName,
        groupNumber: oldPlan.groupNumber,
        carrierPhone: oldPlan.carrierPhone,
        carrierPortalUrl: oldPlan.carrierPortalUrl,
        planYearStart: new Date(data.planYearStart),
        planYearEnd: new Date(data.planYearEnd),
        costPeriod: oldPlan.costPeriod,
        matchDescription: oldPlan.matchDescription,
        vestingDescription: oldPlan.vestingDescription,
        createdById: admin.id,
      },
    });

    if (data.tiers && data.tiers.length > 0) {
      await tx.benefitPlanTier.createMany({
        data: data.tiers.map((t) => ({
          planId: newPlan.id,
          tier: t.tier,
          employeeCost: t.employeeCost,
          employerCost: t.employerCost,
        })),
      });
    }

    if (oldPlan.type === "RETIREMENT_401K") {
      const open = await tx.retirementElection.findMany({ where: { planId: oldPlan.id, endDate: null } });
      for (const e of open) {
        await tx.retirementElection.update({ where: { id: e.id }, data: { endDate: oldPlan.planYearEnd } });
        await tx.retirementElection.create({
          data: {
            employeeId: e.employeeId,
            planId: newPlan.id,
            status: e.status,
            preTaxPercent: e.preTaxPercent,
            rothPercent: e.rothPercent,
            flatAmountPerPay: e.flatAmountPerPay,
            effectiveDate: newPlan.planYearStart,
            confirmedAsOf: new Date(),
            createdById: admin.id,
          },
        });
      }
      return { planId: newPlan.id, migratedCount: open.length };
    }

    const open = await tx.benefitEnrollment.findMany({ where: { planId: oldPlan.id, endDate: null } });
    for (const en of open) {
      await tx.benefitEnrollment.update({ where: { id: en.id }, data: { endDate: oldPlan.planYearEnd } });
      await tx.benefitEnrollment.create({
        data: {
          employeeId: en.employeeId,
          planId: newPlan.id,
          tier: en.tier,
          status: en.status,
          effectiveDate: newPlan.planYearStart,
          memberId: en.memberId,
          confirmedAsOf: new Date(),
          createdById: admin.id,
        },
      });
    }
    return { planId: newPlan.id, migratedCount: open.length };
  });

  await audit({
    action: "benefits.roll_forward_plan_year",
    resource: `BenefitPlan:${result.planId}`,
    diff: { oldPlanId: data.oldPlanId, migratedCount: result.migratedCount },
  });
  revalidateBenefits();
  return { id: result.planId };
}

/** For after the annual broker audit — stamps confirmedAsOf=now on every
 * currently-open enrollment and election so the freshness StatCard resets. */
export async function markAllVerifiedToday() {
  await requireAdmin();
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
  return { enrollments: enrollments.count, elections: elections.count };
}
