import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageHeader, StatCard } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plane } from "lucide-react";
import { LeaveRequestDialog } from "./leave-request-dialog";
import { CancelLeaveButton } from "./cancel-leave-button";
import { Progress } from "@/components/ui/progress";

export const metadata = { title: "Leave" };

export default async function EmployeeLeavePage() {
  const user = await requireUser();
  if (!user.employeeId) return <p className="text-sm text-muted-foreground">No employee record.</p>;

  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch { return fallback; }
  };

  const [employee, requests] = await Promise.all([
    safe(db.employee.findUnique({ where: { id: user.employeeId } }), null),
    safe(
      db.leaveRequest.findMany({
        where: { employeeId: user.employeeId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      [],
    ),
  ]);

  const usedPct = employee
    ? Math.min(100, Math.round(((employee.totalLeaves - employee.leavesRemaining) / Math.max(1, employee.totalLeaves)) * 100))
    : 0;

  return (
    <>
      <PageHeader
        title="Leave"
        description="Submit time-off requests and track approvals."
        actions={<LeaveRequestDialog remaining={employee?.leavesRemaining ?? 0} />}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Days remaining" value={employee?.leavesRemaining ?? 0} icon={<Plane className="h-4 w-4" />} />
        <StatCard label="Days taken" value={employee?.leavesTaken ?? 0} />
        <StatCard label="Approved this year" value={employee?.leavesApproved ?? 0} />
      </div>

      <Card className="mt-4">
        <CardContent className="p-4">
          <div className="flex items-baseline justify-between text-xs text-muted-foreground">
            <span>Used</span>
            <span className="font-mono tabular-nums">
              {employee ? employee.totalLeaves - employee.leavesRemaining : 0} / {employee?.totalLeaves ?? 0}
            </span>
          </div>
          <Progress value={usedPct} className="mt-2 h-2" />
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">My requests</CardTitle></CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y">
            {requests.length === 0 && (
              <li className="grid h-32 place-items-center text-xs text-muted-foreground">
                No requests yet.
              </li>
            )}
            {requests.map((r) => {
              const variant =
                r.status === "APPROVED" ? "success" :
                r.status === "REJECTED" ? "destructive" :
                r.status === "CANCELLED" ? "outline" : "warning";
              return (
                <li key={r.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 p-3">
                  <div>
                    <p className="text-sm font-medium">{r.leaveType}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.startDate.toLocaleDateString()} → {r.endDate.toLocaleDateString()}
                    </p>
                  </div>
                  <span className="font-mono text-xs tabular-nums">{r.totalDays}d</span>
                  <Badge variant={variant} className="text-[10px]">{r.status}</Badge>
                  {(r.status === "PENDING" || (r.status === "APPROVED" && r.startDate > new Date())) && (
                    <CancelLeaveButton id={r.id} />
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
