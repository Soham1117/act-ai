import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth";
import { PlanForm } from "../plan-form";

export const metadata = { title: "New benefit plan" };

export default async function NewBenefitPlanPage() {
  await requireAdmin();
  return (
    <>
      <PageHeader
        title="New benefit plan"
        description="Add a medical, dental, vision, or retirement plan to the catalog. Options stay on this page — no popup."
      />
      <PlanForm />
    </>
  );
}
