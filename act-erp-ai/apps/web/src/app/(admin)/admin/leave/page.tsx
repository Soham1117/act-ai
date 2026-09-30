import Image from "next/image";
import Link from "next/link";
import { db } from "@/lib/db";
import { PageHeader, StatCard } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Plane } from "lucide-react";
import { businessDateOnly, formatDateOnly, getAvatarUrl } from "@/lib/format";
import { LEAVE_TYPES, fmtDays, policyFor } from "@/lib/leave-balance";
import { loadLeaveBalancesFor, loadPolicies } from "@/lib/leave-balance-db";
import { LeaveReviewButtons, LeaveRevertButton } from "./leave-review-buttons";
import { AdjustBalanceDialog } from "./adjust-balance-dialog";
import { PolicyEditor } from "./policy-editor";

export const metadata = { title: "Leave management" };

export default async function AdminLeavePage() {
  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch { return fallback; }
  };

  const today = businessDateOnly();
  const year = today.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));

  const [pending, recentRaw, stats, employees, policies] = await Promise.all([
    safe(
      db.leaveRequest.findMany({
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" },
        include: { employee: { select: { name: true, email: true, profilePic: true, department: { select: { name: true } } } } },
      }),
      [],
    ),
    safe(
      db.leaveRequest.findMany({
        where: { status: { not: "PENDING" } },
        orderBy: { updatedAt: "desc" },
        take: 100,
        include: { employee: { select: { name: true, email: true, profilePic: true } } },
      }),
      [],
    ),
    safe(
      db.leaveRequest.groupBy({
        by: ["status"],
        _count: true,
        where: { createdAt: { gte: yearStart } },
      }),
      [] as Array<{ status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"; _count: number }>,
    ),
    safe(
      db.employee.findMany({
        where: { employmentStatus: { in: ["ACTIVE", "ON_LEAVE"] } },
        orderBy: { name: "asc" },
        select: { id: true, name: true, department: { select: { name: true } } },
      }),
      [],
    ),
    safe(loadPolicies(), {}),
  ]);
  const statMap = Object.fromEntries(stats.map((s) => [s.status, s._count]));

  // Decision time = reviewedAt, falling back to updatedAt (cancellations and
  // legacy rows have no reviewedAt). Nulls can no longer sort first.
  const when = (r: { reviewedAt: Date | null; updatedAt: Date }) => r.reviewedAt ?? r.updatedAt;
  const recent = recentRaw
    .slice()
    .sort((a, b) => when(b).getTime() - when(a).getTime())
    .slice(0, 50);

  const balances = await safe(
    loadLeaveBalancesFor(employees.map((e) => e.id), year),
    new Map(),
  );
  const policyRows = LEAVE_TYPES.map((t) => ({ leaveType: t as string, ...policyFor(policies, t) }));

  return (
    <>
      <PageHeader
        title="Leave management"
        description="Review requests, manage balances, and set leave policy."
      />
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Pending" value={pending.length} icon={<Plane className="h-4 w-4 text-primary" />} />
        <StatCard label="Approved YTD" value={statMap.APPROVED ?? 0} />
        <StatCard label="Rejected YTD" value={statMap.REJECTED ?? 0} />
        <StatCard label="Cancelled YTD" value={statMap.CANCELLED ?? 0} />
      </div>

      <Tabs defaultValue="pending" className="mt-6 space-y-4">
        <TabsList>
          <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
          <TabsTrigger value="recent">Recent decisions</TabsTrigger>
          <TabsTrigger value="balances">Balances</TabsTrigger>
          <TabsTrigger value="policy">Policy</TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y">
                {pending.map((r) => (
                  <li key={r.id} className="grid grid-cols-[36px_1fr_auto_auto_auto] items-center gap-3 p-3">
                    <Avatar src={r.employee.profilePic ?? getAvatarUrl(r.employee.email)} name={r.employee.name} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{r.employee.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {r.employee.department?.name ?? "—"} · {formatDateOnly(r.startDate)} → {formatDateOnly(r.endDate)}
                        {(r.startHalfDay || r.endHalfDay) && " · half day"}
                      </p>
                      {r.description && (
                        <p className="truncate text-[11px] text-muted-foreground">“{r.description}”</p>
                      )}
                    </div>
                    <Badge variant="outline" className="text-[10px]">{r.leaveType}</Badge>
                    <span className="font-mono text-xs tabular-nums">{fmtDays(Number(r.totalDays))}</span>
                    <LeaveReviewButtons id={r.id} />
                  </li>
                ))}
                {pending.length === 0 && (
                  <li className="grid h-32 place-items-center text-xs text-muted-foreground">
                    Inbox zero. Nothing pending.
                  </li>
                )}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="recent">
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y">
                {recent.map((r) => {
                  const variant =
                    r.status === "APPROVED" ? "success" :
                    r.status === "REJECTED" ? "destructive" :
                    r.status === "PENDING" ? "warning" : "outline";
                  return (
                    <li key={r.id} className="grid grid-cols-[36px_1fr_auto_auto_auto] items-center gap-3 p-3">
                      <Avatar src={r.employee.profilePic ?? getAvatarUrl(r.employee.email)} name={r.employee.name} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{r.employee.name}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {r.leaveType} · {formatDateOnly(r.startDate)} → {formatDateOnly(r.endDate)} · {fmtDays(Number(r.totalDays))}
                        </p>
                        {r.reviewNotes && (
                          <p className="truncate text-[11px] text-muted-foreground">Note: {r.reviewNotes}</p>
                        )}
                      </div>
                      <Badge variant={variant} className="text-[10px]">{r.status}</Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {when(r).toLocaleDateString()}
                      </span>
                      {r.status === "APPROVED" ? <LeaveRevertButton id={r.id} /> : <span />}
                    </li>
                  );
                })}
                {recent.length === 0 && (
                  <li className="grid h-32 place-items-center text-xs text-muted-foreground">
                    No decisions yet.
                  </li>
                )}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="balances">
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="p-3">Employee ({year})</th>
                    <th className="p-3 text-right">Allowed</th>
                    <th className="p-3 text-right">Taken</th>
                    <th className="p-3 text-right">Upcoming</th>
                    <th className="p-3 text-right">Pending</th>
                    <th className="p-3 text-right">Remaining</th>
                    <th className="p-3" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {employees.map((e) => {
                    const t = balances.get(e.id)?.totals;
                    return (
                      <tr key={e.id}>
                        <td className="p-3">
                          <Link href={`/admin/employees/${e.id}`} className="font-medium hover:underline">
                            {e.name}
                          </Link>
                          <p className="text-[11px] text-muted-foreground">{e.department?.name ?? "—"}</p>
                        </td>
                        <td className="p-3 text-right font-mono tabular-nums">{t?.allowed ?? "—"}</td>
                        <td className="p-3 text-right font-mono tabular-nums">{t?.taken ?? "—"}</td>
                        <td className="p-3 text-right font-mono tabular-nums">{t?.upcoming ?? "—"}</td>
                        <td className="p-3 text-right font-mono tabular-nums">{t?.pending ?? "—"}</td>
                        <td className="p-3 text-right font-mono font-semibold tabular-nums">{t?.available ?? "—"}</td>
                        <td className="p-3 text-right">
                          <AdjustBalanceDialog employeeId={e.id} employeeName={e.name} year={year} />
                        </td>
                      </tr>
                    );
                  })}
                  {employees.length === 0 && (
                    <tr>
                      <td colSpan={7} className="h-24 text-center text-xs text-muted-foreground">
                        No active employees.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <p className="p-3 text-[11px] text-muted-foreground">
                Totals cover balance-limited leave types only. Pending days are reserved against the balance.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="policy">
          <Card>
            <CardContent className="p-0">
              <PolicyEditor initial={policyRows} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}

function Avatar({ src, name }: { src: string; name: string }) {
  return (
    <span className="relative h-9 w-9 overflow-hidden rounded-full bg-muted">
      <Image src={src} alt={name} fill sizes="36px" className="object-cover" unoptimized />
    </span>
  );
}
