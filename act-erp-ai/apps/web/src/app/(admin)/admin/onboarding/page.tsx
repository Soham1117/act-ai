import Link from "next/link";
import { UserCheck } from "lucide-react";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OnboardingActions, RowActions } from "./actions";
import { PendingHireActions } from "../employees/pending-hire-actions";

export const metadata = { title: "Onboarding" };

export default async function OnboardingPage() {
  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch { return fallback; }
  };

  const [invites, departments, pendingHires] = await Promise.all([
    safe(
      db.onboardingInvite.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      [],
    ),
    safe(db.department.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }), []),
    safe(
      db.employee.findMany({
        where: { employmentStatus: "PENDING_REVIEW" },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          employeeId: true,
          jobTitle: true,
          createdAt: true,
          department: { select: { name: true } },
        },
      }),
      [],
    ),
  ]);
  const deptName = new Map(departments.map((d) => [d.id, d.name]));

  const pending = invites.filter((i) => i.status === "PENDING" && i.expiresAt > new Date());
  const completed = invites.filter((i) => i.status === "COMPLETED");
  const expired = invites.filter(
    (i) => i.status === "EXPIRED" || (i.status === "PENDING" && i.expiresAt <= new Date()),
  );

  return (
    <>
      <PageHeader
        title="Onboarding"
        description={`${pending.length} pending · ${completed.length} completed · ${expired.length} expired`}
        actions={<OnboardingActions departments={departments} />}
      />

      {pendingHires.length > 0 && (
        <Card className="mb-4 border-amber-500/50 bg-amber-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <UserCheck className="h-4 w-4 text-amber-600" />
              Awaiting your approval ({pendingHires.length})
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              These hires finished onboarding. Their accounts are read-only until you approve
              them. Open one to check their details and documents first.
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
                    {e.department ? ` · ${e.department.name}` : ""} · submitted{" "}
                    {e.createdAt.toLocaleDateString()}
                  </p>
                </Link>
                <PendingHireActions employeeId={e.id} name={e.name} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {invites.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No invites yet. Generate one with the button above.
            </p>
          ) : (
            <ul className="divide-y">
              {invites.map((i) => {
                const isPending = i.status === "PENDING" && i.expiresAt > new Date();
                const isExpired = i.status === "EXPIRED" || (i.status === "PENDING" && i.expiresAt <= new Date());
                const variant = i.status === "COMPLETED" ? "success" : isExpired ? "destructive" : "warning";
                return (
                  <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium">{i.email ?? "(no email)"}</p>
                        <Badge variant={variant} className="text-[10px]">
                          {i.status === "COMPLETED"
                            ? "Completed"
                            : isExpired
                            ? "Expired"
                            : "Pending"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {[
                          i.jobTitle,
                          i.departmentId ? deptName.get(i.departmentId) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        {i.jobTitle || i.departmentId ? " · " : ""}
                        Created {i.createdAt.toLocaleDateString()} · expires{" "}
                        {i.expiresAt.toLocaleDateString()}
                      </p>
                    </div>
                    {i.status === "COMPLETED" && i.completedByEmployeeId && (
                      <Link
                        href={`/admin/employees/${i.completedByEmployeeId}`}
                        className="text-xs text-primary hover:underline"
                      >
                        View employee
                      </Link>
                    )}
                    {isPending && <RowActions inviteId={i.id} token={i.token} />}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
