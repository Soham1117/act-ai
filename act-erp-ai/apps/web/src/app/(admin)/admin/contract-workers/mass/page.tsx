import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { listContractWorkers } from "@/server/queries/contract-workers";
import { MassContractHoursWizard } from "./mass-contract-hours-wizard";

export const metadata = { title: "Contract mass hours" };

export default async function ContractMassHoursPage() {
  await requireAdmin();
  const [workers, jobCodes] = await Promise.all([
    listContractWorkers({}),
    db.jobCode.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: { code: true, title: true },
    }),
  ]);

  return (
    <>
      <PageHeader
        back={{ href: "/admin/contract-workers?tab=hours", label: "Contract hours" }}
        title="Contract mass hours"
        description="Create the same closed shift for many agency workers at once. Active, inactive, and ended workers are allowed. Preview before commit."
      />
      <MassContractHoursWizard
        workers={workers.map((w) => ({
          id: w.id,
          name: w.name,
          workerId: w.workerId,
          agencyName: w.agencyName,
          status: w.status,
          jobCode: w.jobCode,
        }))}
        jobCodes={jobCodes}
      />
    </>
  );
}
