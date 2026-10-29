import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { adminBenefitEligibilityData } from "@/server/queries/benefit-eligibility";
import { EligibilityWorkspace } from "./workspace";

export const metadata = { title: "Benefit eligibility" };

export default async function BenefitEligibilityPage() {
  const data = await adminBenefitEligibilityData();
  return (
    <>
      <PageHeader
        title="Benefit eligibility"
        description="Review policy versions, service credit and proposed application dates. No enrollment or timeclock records are changed here."
        actions={
          <Link href="/admin/benefits" className="text-sm underline underline-offset-4">
            Back to benefits
          </Link>
        }
      />
      <EligibilityWorkspace data={data} />
    </>
  );
}
