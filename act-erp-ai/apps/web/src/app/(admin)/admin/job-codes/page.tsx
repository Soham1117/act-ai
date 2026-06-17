import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { JobCodesTable } from "./job-codes-table";
import { JobCodeDialog } from "./job-code-dialog";

export const metadata = { title: "Job codes" };

export default async function JobCodesPage() {
  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch { return fallback; }
  };

  const [jobCodes, departments] = await Promise.all([
    safe(
      db.jobCode.findMany({
        orderBy: [{ isDefault: "desc" }, { code: "asc" }],
        include: {
          _count: { select: { assignments: true } },
          department: { select: { id: true, name: true } },
        },
      }),
      [],
    ),
    safe(
      db.department.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      [],
    ),
  ]);

  const active = jobCodes.filter((j) => j.isActive).length;
  const inactive = jobCodes.length - active;

  return (
    <>
      <PageHeader
        title="Job codes"
        description={`${jobCodes.length} total · ${active} active · ${inactive} inactive`}
        actions={<JobCodeDialog departments={departments} />}
      />
      <Card>
        <CardContent className="p-0">
          <JobCodesTable
            departments={departments}
            rows={jobCodes.map((j) => ({
              id: j.id,
              code: j.code,
              title: j.title,
              description: j.description,
              rate: j.rate,
              isActive: j.isActive,
              isDefault: j.isDefault,
              assignmentCount: j._count.assignments,
              departmentId: j.departmentId,
              departmentName: j.department?.name ?? null,
            }))}
          />
        </CardContent>
      </Card>
    </>
  );
}
