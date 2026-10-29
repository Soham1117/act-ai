"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { fail, failFromUnknown, ok, type ActionResult } from "@/lib/action-result";
import {
  ELIGIBILITY_TYPES,
  eligibilityDate,
  eligibilityRuleFor,
} from "@/lib/benefit-eligibility";

const day = z
  .string()
  .refine((v) => !!eligibilityDate(v), "Enter a valid calendar date.");
const reason = z
  .string()
  .trim()
  .min(3, "Record the HR decision or source (at least 3 characters).")
  .max(1000);
const type = z.enum(ELIGIBILITY_TYPES);
const policyInput = z.object({
  benefitType: type,
  effectiveFrom: day,
  effectiveTo: day.optional(),
  confirmed: z.boolean(),
  reason,
  expectedUpdatedAt: z.string().optional(),
});

function refresh() {
  revalidatePath("/admin/benefits");
  revalidatePath("/admin/benefits/eligibility");
  revalidatePath("/dashboard/benefits");
}

/** Drafts can be edited; confirmed policy versions are preserved as evidence. */
export async function saveBenefitEligibilityPolicy(
  input: z.input<typeof policyInput>,
): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  try {
    const data = policyInput.parse(input);
    const effectiveFrom = eligibilityDate(data.effectiveFrom)!;
    const effectiveTo = data.effectiveTo ? eligibilityDate(data.effectiveTo)! : null;
    if (effectiveTo && effectiveTo <= effectiveFrom)
      return fail("The end date must be after the start date.");
    const id = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`benefit-eligibility:${data.benefitType}`}))`;
      const previous = await tx.benefitEligibilityPolicy.findUnique({
        where: {
          benefitType_effectiveFrom: { benefitType: data.benefitType, effectiveFrom },
        },
      });
      if (previous?.confirmed)
        throw new Error(
          "A confirmed policy is preserved. End it and create a new effective-dated version instead.",
        );
      if (previous && previous.updatedAt.toISOString() !== data.expectedUpdatedAt)
        throw new Error("This draft changed. Refresh before saving.");
      const overlap = await tx.benefitEligibilityPolicy.findFirst({
        where: {
          benefitType: data.benefitType,
          ...(previous ? { id: { not: previous.id } } : {}),
          ...(effectiveTo ? { effectiveFrom: { lt: effectiveTo } } : {}),
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }],
        },
      });
      if (overlap)
        throw new Error(
          "This range overlaps another policy. End the previous version before adding its replacement.",
        );
      const values = {
        rule: eligibilityRuleFor(data.benefitType),
        effectiveTo,
        confirmed: data.confirmed,
        confirmedById: data.confirmed ? admin.id : null,
        confirmedAt: data.confirmed ? new Date() : null,
      };
      const saved = await tx.benefitEligibilityPolicy.upsert({
        where: {
          benefitType_effectiveFrom: { benefitType: data.benefitType, effectiveFrom },
        },
        create: { benefitType: data.benefitType, effectiveFrom, ...values },
        update: values,
      });
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          actorEmail: admin.email,
          action: "benefits.eligibility.policy.save",
          resource: `BenefitEligibilityPolicy:${saved.id}`,
          diff: {
            benefitType: data.benefitType,
            rule: values.rule,
            effectiveFrom: data.effectiveFrom,
            effectiveTo: data.effectiveTo ?? null,
            confirmed: data.confirmed,
            reason: data.reason,
          },
        },
      });
      return saved.id;
    });
    refresh();
    return ok({ id });
  } catch (error) {
    return failFromUnknown(error);
  }
}

const endInput = z.object({
  id: z.string().min(1),
  effectiveTo: day,
  expectedUpdatedAt: z.string(),
  reason,
});
export async function endBenefitEligibilityPolicy(
  input: z.input<typeof endInput>,
): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  try {
    const data = endInput.parse(input);
    const id = await db.$transaction(async (tx) => {
      const before = await tx.benefitEligibilityPolicy.findUnique({
        where: { id: data.id },
      });
      if (!before) throw new Error("That policy no longer exists.");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`benefit-eligibility:${before.benefitType}`}))`;
      const effectiveTo = eligibilityDate(data.effectiveTo)!;
      if (effectiveTo <= before.effectiveFrom)
        throw new Error("The end date must be after the policy start date.");
      if (before.effectiveTo && effectiveTo > before.effectiveTo)
        throw new Error(
          "An ended policy cannot be extended. Create a new effective-dated version.",
        );
      const saved = await tx.benefitEligibilityPolicy.updateMany({
        where: { id: before.id, updatedAt: new Date(data.expectedUpdatedAt) },
        data: { effectiveTo },
      });
      if (saved.count !== 1)
        throw new Error("This policy changed. Refresh before ending it.");
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          actorEmail: admin.email,
          action: "benefits.eligibility.policy.end",
          resource: `BenefitEligibilityPolicy:${before.id}`,
          diff: {
            previousEnd: before.effectiveTo?.toISOString() ?? null,
            effectiveTo: data.effectiveTo,
            reason: data.reason,
          },
        },
      });
      return before.id;
    });
    refresh();
    return ok({ id });
  } catch (error) {
    return failFromUnknown(error);
  }
}

const assessmentInput = z.object({
  employeeId: z.string().min(1),
  benefitType: type,
  classification: z.enum(["ELIGIBLE", "INELIGIBLE", "REVIEW_REQUIRED"]),
  serviceDate: day.optional(),
  notes: reason,
  expectedUpdatedAt: z.string().optional(),
});
export async function saveBenefitEligibilityAssessment(
  input: z.input<typeof assessmentInput>,
): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  try {
    const data = assessmentInput.parse(input);
    const id = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`benefit-assessment:${data.employeeId}:${data.benefitType}`}))`;
      const employee = await tx.employee.findUnique({
        where: { id: data.employeeId },
        select: { dateOfHire: true },
      });
      if (!employee) throw new Error("That employee no longer exists.");
      const serviceDate = data.serviceDate
        ? eligibilityDate(data.serviceDate)
        : eligibilityDate(employee.dateOfHire);
      if (data.classification === "ELIGIBLE" && !serviceDate)
        throw new Error(
          "Confirm the hire or credited-service date before marking the employee eligible.",
        );
      const key = { employeeId: data.employeeId, benefitType: data.benefitType };
      const before = await tx.benefitEligibilityAssessment.findUnique({
        where: { employeeId_benefitType: key },
      });
      if (before && before.updatedAt.toISOString() !== data.expectedUpdatedAt)
        throw new Error("This assessment changed. Refresh before saving.");
      const values = {
        classification: data.classification,
        serviceDate,
        notes: data.notes,
        confirmedById: admin.id,
        confirmedAt: new Date(),
      };
      const saved = await tx.benefitEligibilityAssessment.upsert({
        where: { employeeId_benefitType: key },
        create: { ...key, ...values },
        update: values,
      });
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          actorEmail: admin.email,
          action: "benefits.eligibility.assessment.save",
          resource: `BenefitEligibilityAssessment:${saved.id}`,
          diff: {
            employeeId: data.employeeId,
            benefitType: data.benefitType,
            previousClassification: before?.classification ?? null,
            classification: data.classification,
            previousServiceDate: before?.serviceDate?.toISOString() ?? null,
            serviceDate: serviceDate?.toISOString() ?? null,
          },
        },
      });
      return saved.id;
    });
    refresh();
    return ok({ id });
  } catch (error) {
    return failFromUnknown(error);
  }
}

const metadataInput = z.object({
  id: z.string().min(1),
  planCode: z.string().trim().max(60).optional(),
  planDesignation: z.enum(["BASE", "BUY_UP"]).optional(),
  resourceVersionId: z.string().trim().max(200).optional(),
  expectedUpdatedAt: z.string(),
});
export async function saveBenefitPlanMetadata(
  input: z.input<typeof metadataInput>,
): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  try {
    const data = metadataInput.parse(input);
    const id = await db.$transaction(async (tx) => {
      const before = await tx.benefitPlan.findUnique({ where: { id: data.id } });
      if (!before) throw new Error("That plan no longer exists.");
      if (data.planDesignation && before.type !== "MEDICAL")
        throw new Error("Base and buy-up designations apply to medical plans only.");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`benefit-plan-metadata:${before.type}:${before.planYearStart.toISOString()}`}))`;
      if (data.planDesignation === "BASE") {
        const otherBase = await tx.benefitPlan.findFirst({
          where: {
            id: { not: before.id },
            type: "MEDICAL",
            isActive: true,
            planYearStart: before.planYearStart,
            planDesignation: "BASE",
          },
        });
        if (otherBase)
          throw new Error(
            "An active base medical plan already exists for this plan year.",
          );
      }
      if (data.resourceVersionId) {
        const version = await tx.companyDocumentVersion.findUnique({
          where: { id: data.resourceVersionId },
          include: { document: true },
        });
        if (
          !version ||
          version.status !== "APPROVED" ||
          version.purpose !== "BENEFIT_RESOURCE" ||
          version.document.category !== "BENEFITS" ||
          version.document.isArchived
        )
          throw new Error(
            "Choose an approved benefits resource from the company library.",
          );
      }
      const fields = {
        planCode: data.planCode || null,
        planDesignation: data.planDesignation ?? null,
        resourceVersionId: data.resourceVersionId || null,
      };
      const saved = await tx.benefitPlan.updateMany({
        where: { id: before.id, updatedAt: new Date(data.expectedUpdatedAt) },
        data: fields,
      });
      if (saved.count !== 1)
        throw new Error("This plan changed. Refresh before saving its information.");
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          actorEmail: admin.email,
          action: "benefits.plan.metadata",
          resource: `BenefitPlan:${before.id}`,
          diff: {
            before: {
              planCode: before.planCode,
              planDesignation: before.planDesignation,
              resourceVersionId: before.resourceVersionId,
            },
            after: fields,
          },
        },
      });
      return before.id;
    });
    refresh();
    return ok({ id });
  } catch (error) {
    return failFromUnknown(error);
  }
}
