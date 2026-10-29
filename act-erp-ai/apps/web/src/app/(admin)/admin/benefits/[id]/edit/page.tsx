import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { PlanForm, type PlanForEdit } from "../../plan-form";

export const metadata = { title: "Edit benefit plan" };

export default async function EditBenefitPlanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const plan = await db.benefitPlan.findUnique({
    where: { id },
    include: { tiers: true, ageRates: { orderBy: { ageFrom: "asc" } } },
  });
  if (!plan) notFound();

  const initial: PlanForEdit = {
    id: plan.id,
    type: plan.type,
    name: plan.name,
    carrierName: plan.carrierName,
    groupNumber: plan.groupNumber,
    carrierPhone: plan.carrierPhone,
    carrierPortalUrl: plan.carrierPortalUrl,
    planYearStart: plan.planYearStart.toISOString().slice(0, 10),
    planYearEnd: plan.planYearEnd.toISOString().slice(0, 10),
    costPeriod: plan.costPeriod,
    planCode: plan.planCode,
    planDesignation: plan.planDesignation,
    matchDescription: plan.matchDescription,
    vestingDescription: plan.vestingDescription,
    notes: plan.notes,
    tiers: plan.tiers.map((t) => ({
      tier: t.tier,
      employeeCost: Number(t.employeeCost),
      employerCost: Number(t.employerCost),
    })),
    ageRates: plan.ageRates.map((r) => ({
      ageFrom: r.ageFrom,
      ageTo: r.ageTo,
      monthlyEmployeeCost: Number(r.monthlyEmployeeCost),
      perPay26EmployeeCost: Number(r.perPay26EmployeeCost),
    })),
  };

  return (
    <>
      <PageHeader
        title={`Edit ${plan.name}`}
        description="Update catalog fields, tier prices, and medical age bands on this page."
      />
      <PlanForm plan={initial} />
    </>
  );
}
