import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageHeader, StatCard } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plane } from "lucide-react";
import { LeaveRequestDialog, type DialogBalances } from "./leave-request-dialog";
import { CancelLeaveButton } from "./cancel-leave-button";
import { Progress } from "@/components/ui/progress";
import { businessDateOnly, formatDateOnly } from "@/lib/format";
import { LEAVE_TYPES, computeBalances, dateKey, fmtDays } from "@/lib/leave-balance";
import { loadBalanceInput } from "@/lib/leave-balance-db";

export const metadata = { title: "Leave" };

export default async function EmployeeLeavePage() {
  const user = await requireUser();
  if (!user.employeeId) return <p className="text-sm text-muted-foreground">No employee record.</p>;

  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch { return fallback; }
  };

  const today = businessDateOnly();
  const year = today.getUTCFullYear();

  const [input, requests] = await Promise.all([
    safe(loadBalanceInput(user.employeeId, [year, year + 1]), null),
    safe(
      db.leaveRequest.findMany({
        where: { employeeId: user.employeeId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      [],
    ),
  ]);

  const cur = input ? computeBalances(input, year) : null;
  const next = input ? computeBalances(input, year + 1) : null;
  const balances: DialogBalances = {};
  for (const yb of [cur, next]) {
    if (!yb) continue;
    balances[yb.year] = Object.fromEntries(
      Object.entries(yb.types).map(([t, b]) => [t, { available: b.available }]),
    );
  }
  const totals = cur?.totals;
  const usedPct = totals && totals.allowed > 0
    ? Math.min(100, Math.round((totals.used / totals.allowed) * 100))
    : 0;
  const limited = cur
    ? LEAVE_TYPES.map((t) => cur.types[t]!).filter((b) => !b.unlimited && (b.allowed > 0 || b.used > 0))
    : [];
  const unlimited = cur ? LEAVE_TYPES.filter((t) => cur.types[t]!.unlimited) : [];

  return (
    <>
      <PageHeader
        title="Leave"
        description={`Submit time-off requests and track approvals. Balances are for ${year}.`}
        actions={<LeaveRequestDialog balances={balances} today={dateKey(today)} />}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Days remaining" value={totals?.available ?? 0} icon={<Plane className="h-4 w-4" />} />
        <StatCard label="Taken / approved" value={(totals?.taken ?? 0) + (totals?.upcoming ?? 0)} />
        <StatCard label="Pending approval" value={totals?.pending ?? 0} />
      </div>

      <Card className="mt-4">
        <CardContent className="p-4">
          <div className="flex items-baseline justify-between text-xs text-muted-foreground">
            <span>Used (including pending)</span>
            <span className="font-mono tabular-nums">
              {totals?.used ?? 0} / {totals?.allowed ?? 0}
            </span>
          </div>
          <Progress value={usedPct} className="mt-2 h-2" />
          {limited.length > 0 && (
            <ul className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
              {limited.map((b) => (
                <li key={b.leaveType} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <span className="font-medium">{b.leaveType}</span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {b.available} left of {b.allowed}
                    {b.carryover > 0 && ` (incl. ${b.carryover} carried over)`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {unlimited.length > 0 && (
            <p className="mt-3 text-[11px] text-muted-foreground">
              Not balance-limited: {unlimited.join(", ")}.
            </p>
          )}
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
              const canCancel =
                r.status === "PENDING" || (r.status === "APPROVED" && r.startDate > today);
              return (
                <li key={r.id} className="space-y-1 p-3">
                  <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3">
                    <div>
                      <p className="text-sm font-medium">{r.leaveType}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateOnly(r.startDate)} → {formatDateOnly(r.endDate)}
                        {(r.startHalfDay || r.endHalfDay) && " · half day"}
                      </p>
                    </div>
                    <span className="font-mono text-xs tabular-nums">{fmtDays(Number(r.totalDays))}</span>
                    <Badge variant={variant} className="text-[10px]">{r.status}</Badge>
                    {canCancel ? (
                      <CancelLeaveButton id={r.id} approved={r.status === "APPROVED"} />
                    ) : (
                      <span className="w-8" />
                    )}
                  </div>
                  {r.reviewNotes && (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">Note from reviewer:</span> {r.reviewNotes}
                    </p>
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
