import Link from "next/link";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { EmployeesTable } from "./employees-table";
import { AddEmployeeDialog } from "./add-employee-dialog";

export const metadata = { title: "Employees" };

export default async function EmployeesPage() {
  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch { return fallback; }
  };

  const [employees, departments] = await Promise.all([
    safe(
      db.employee.findMany({
        orderBy: { name: "asc" },
        include: { department: true },
      }),
      [],
    ),
    safe(db.department.findMany({ orderBy: { name: "asc" } }), []),
  ]);

  return (
    <>
      <PageHeader
        title="Employees"
        description={`${employees.length} record${employees.length === 1 ? "" : "s"} · ${departments.length} departments`}
        actions={<AddEmployeeDialog departments={departments} />}
      />
      <EmployeesTable
        rows={employees.map((e) => ({
          id: e.id,
          employeeId: e.employeeId,
          name: e.name,
          email: e.email,
          jobTitle: e.jobTitle,
          departmentName: e.department?.name ?? null,
          employmentType: e.employmentType,
          employmentStatus: e.employmentStatus,
          dateOfHire: e.dateOfHire?.toISOString() ?? null,
          profilePic: e.profilePic,
        }))}
      />
      {employees.length === 0 && (
        <p className="mt-8 text-center text-xs text-muted-foreground">
          No employees yet. Add your first one with{" "}
          <Link className="text-primary hover:underline" href="#">the button above</Link>{" "}
          or wait for the Phase 6 seed.
        </p>
      )}
    </>
  );
}
