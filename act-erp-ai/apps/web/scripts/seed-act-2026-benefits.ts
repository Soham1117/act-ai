/**
 * Idempotent seed: ACT 2026-07 medical (age-banded) + vision flat rates.
 *
 *   pnpm exec tsx --env-file=.env.prod scripts/seed-act-2026-benefits.ts
 *   # or via compose tools profile
 */
import { PrismaClient } from "@prisma/client";
import {
  ACT_2026_MEDICAL_PLANS,
  ACT_2026_PLAN_YEAR,
  ACT_2026_VISION_PLAN,
  ageRatesForMetal,
} from "../src/lib/act-2026-benefit-seed-data";

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

async function main() {
  const db = new PrismaClient({ log: [] });
  const start = day(ACT_2026_PLAN_YEAR.start);
  const end = day(ACT_2026_PLAN_YEAR.end);
  const report: Array<Record<string, unknown>> = [];

  try {
    for (const meta of ACT_2026_MEDICAL_PLANS) {
      const existing = await db.benefitPlan.findFirst({
        where: { type: "MEDICAL", name: meta.name, planYearStart: start },
      });
      const rates = ageRatesForMetal(meta.key);
      const plan = existing
        ? await db.benefitPlan.update({
            where: { id: existing.id },
            data: {
              carrierName: meta.carrierName,
              carrierPhone: meta.carrierPhone,
              carrierPortalUrl: meta.carrierPortalUrl,
              planCode: meta.planCode,
              planDesignation: meta.planDesignation,
              planYearEnd: end,
              costPeriod: "MONTHLY",
              notes: meta.notes,
              isActive: true,
            },
          })
        : await db.benefitPlan.create({
            data: {
              type: "MEDICAL",
              name: meta.name,
              carrierName: meta.carrierName,
              carrierPhone: meta.carrierPhone,
              carrierPortalUrl: meta.carrierPortalUrl,
              planCode: meta.planCode,
              planDesignation: meta.planDesignation,
              planYearStart: start,
              planYearEnd: end,
              costPeriod: "MONTHLY",
              notes: meta.notes,
              isActive: true,
            },
          });

      for (const tier of ["EMPLOYEE_ONLY", "EMPLOYEE_SPOUSE", "EMPLOYEE_CHILDREN", "FAMILY"] as const) {
        await db.benefitPlanTier.upsert({
          where: { planId_tier: { planId: plan.id, tier } },
          create: { planId: plan.id, tier, employeeCost: 0, employerCost: 0 },
          update: { employeeCost: 0, employerCost: 0 },
        });
      }

      await db.benefitPlanAgeRate.deleteMany({ where: { planId: plan.id } });
      await db.benefitPlanAgeRate.createMany({
        data: rates.map((r) => ({
          planId: plan.id,
          ageFrom: r.ageFrom,
          ageTo: r.ageTo,
          monthlyEmployeeCost: r.monthlyEmployeeCost,
          perPay26EmployeeCost: r.perPay26EmployeeCost,
        })),
      });

      report.push({
        type: "MEDICAL",
        planCode: meta.planCode,
        id: plan.id,
        status: existing ? "updated" : "created",
        ageBands: rates.length,
      });
    }

    const visionName = ACT_2026_VISION_PLAN.name;
    const visionExisting = await db.benefitPlan.findFirst({
      where: { type: "VISION", name: visionName, planYearStart: start },
    });
    const vision = visionExisting
      ? await db.benefitPlan.update({
          where: { id: visionExisting.id },
          data: {
            carrierName: ACT_2026_VISION_PLAN.carrierName,
            groupNumber: ACT_2026_VISION_PLAN.groupNumber,
            carrierPhone: ACT_2026_VISION_PLAN.carrierPhone,
            carrierPortalUrl: ACT_2026_VISION_PLAN.carrierPortalUrl,
            planCode: ACT_2026_VISION_PLAN.planCode,
            planDesignation: ACT_2026_VISION_PLAN.planDesignation,
            planYearEnd: end,
            costPeriod: "MONTHLY",
            notes: ACT_2026_VISION_PLAN.notes,
            isActive: true,
          },
        })
      : await db.benefitPlan.create({
          data: {
            type: "VISION",
            name: visionName,
            carrierName: ACT_2026_VISION_PLAN.carrierName,
            groupNumber: ACT_2026_VISION_PLAN.groupNumber,
            carrierPhone: ACT_2026_VISION_PLAN.carrierPhone,
            carrierPortalUrl: ACT_2026_VISION_PLAN.carrierPortalUrl,
            planCode: ACT_2026_VISION_PLAN.planCode,
            planDesignation: ACT_2026_VISION_PLAN.planDesignation,
            planYearStart: start,
            planYearEnd: end,
            costPeriod: "MONTHLY",
            notes: ACT_2026_VISION_PLAN.notes,
            isActive: true,
          },
        });

    for (const t of ACT_2026_VISION_PLAN.tiers) {
      await db.benefitPlanTier.upsert({
        where: { planId_tier: { planId: vision.id, tier: t.tier } },
        create: {
          planId: vision.id,
          tier: t.tier,
          employeeCost: t.employeeCost,
          employerCost: t.employerCost,
        },
        update: { employeeCost: t.employeeCost, employerCost: t.employerCost },
      });
    }

    report.push({
      type: "VISION",
      planCode: ACT_2026_VISION_PLAN.planCode,
      id: vision.id,
      status: visionExisting ? "updated" : "created",
    });

    // Handbook / ACT rule: medical + vision = first of month after 60 days.
    for (const benefitType of ["MEDICAL", "VISION"] as const) {
      const policy = await db.benefitEligibilityPolicy.upsert({
        where: {
          benefitType_effectiveFrom: { benefitType, effectiveFrom: start },
        },
        create: {
          benefitType,
          rule: "INSURANCE_60_DAYS",
          effectiveFrom: start,
          confirmed: true,
          confirmedAt: new Date(),
        },
        update: {
          rule: "INSURANCE_60_DAYS",
          effectiveTo: null,
          confirmed: true,
          confirmedAt: new Date(),
        },
      });
      report.push({
        type: "ELIGIBILITY",
        benefitType,
        id: policy.id,
        rule: "INSURANCE_60_DAYS",
      });
    }

    console.log(JSON.stringify({ ok: true, report }, null, 2));
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : "seed failed");
  process.exitCode = 1;
});
