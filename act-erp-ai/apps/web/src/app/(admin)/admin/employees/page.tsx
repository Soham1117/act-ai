import Link from "next/link";
import { UserCheck } from "lucide-react";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmployeesTable } from "./employees-table";
import { AddEmployeeDialog } from "./add-employee-dialog";
import { PendingHireActions } from "./pending-hire-actions";

export const metadata = { title: "Employees" };

export default async function EmployeesPage() {
  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch { return fallback; }
  };

  const [employees, departments] = await Promise.all([
    safe(
      db.employee.findMany({
        orderBy: { name: "asc" },
        include: { department: true, user: { select: { role: true } } },
      }),
      [],
    ),
    safe(db.department.findMany({ orderBy: { name: "asc" } }), []),
  ]);

  const pendingHires = employees.filter((e) => e.employmentStatus === "PENDING_REVIEW");

  return (
    <>
      <PageHeader
        title="Employees"
        description={`${employees.length} record${employees.length === 1 ? "" : "s"} · ${departments.length} departments`}
        actions={<AddEmployeeDialog departments={departments} />}
      />
      {pendingHires.length > 0 && (
        <Card className="mb-4 border-amber-500/50 bg-amber-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <UserCheck className="h-4 w-4 text-amber-600" />
              {pendingHires.length} new hire{pendingHires.length === 1 ? "" : "s"} awaiting your
              approval
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              They finished onboarding and can sign in, but their account is read-only until you
              approve it. Open a hire to check their details first.
            </p>
          </CardHeader>
          <CardContent className="divide-y">
            {pendingHires.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/admin/employees/${e.id}`} className="min-w-0 hover:underline">
                  <p className="truncate text-sm font-medium">{e.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.employeeId}
                    {e.jobTitle ? ` · ${e.jobTitle}` : ""}
                    {e.department ? ` · ${e.department.name}` : ""}
                  </p>
                </Link>
                <PendingHireActions employeeId={e.id} name={e.name} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
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
          isAdmin: e.user.role === "ADMIN",
          dateOfHire: e.dateOfHire?.toISOString() ?? null,
          profilePic: e.profilePic,
        }))}
      />
      {employees.length === 0 && (
        <p className="mt-8 text-center text-xs text-muted-foreground">
          No employees yet. Add your first one with the button above, or send an invite from{" "}
          <Link className="text-primary hover:underline" href="/admin/onboarding">
            Onboarding
          </Link>
          .
        </p>
      )}
    </>
  );
}
