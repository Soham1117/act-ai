import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { HoursSubnav } from "@/components/hours-subnav";
import { MassHoursWizard } from "./mass-hours-wizard";

export const metadata = { title: "Mass hours" };

export default async function MassHoursPage() {
  const [employees, jobCodes] = await Promise.all([
    db.employee.findMany({
      where: { employmentStatus: "ACTIVE" },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        employeeId: true,
        exportCode: true,
        department: { select: { name: true } },
        defaultHourlyRate: true,
      },
    }),
    db.jobCode.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: { code: true, title: true },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Mass hours"
        description="Create the same shift for many employees at once. Preview before commit. Kiosk punches are never silently overwritten."
      />
      <HoursSubnav />
      <MassHoursWizard
        employees={employees.map((e) => ({
          id: e.id,
          name: e.name,
          employeeId: e.employeeId,
          exportCode: e.exportCode,
          department: e.department?.name ?? null,
          defaultHourlyRate: Number(e.defaultHourlyRate.toString()),
        }))}
        jobCodes={jobCodes}
      />
    </>
  );
}
