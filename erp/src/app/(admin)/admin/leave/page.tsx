import Image from "next/image";
import { db } from "@/lib/db";
import { PageHeader, StatCard } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Plane } from "lucide-react";
import { getAvatarUrl } from "@/lib/format";
import { LeaveReviewButtons } from "./leave-review-buttons";

export const metadata = { title: "Leave management" };

export default async function AdminLeavePage() {
  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch { return fallback; }
  };

  const [pending, recent] = await Promise.all([
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
        orderBy: { reviewedAt: "desc" },
        take: 50,
        include: { employee: { select: { name: true, email: true, profilePic: true } } },
      }),
      [],
    ),
  ]);

  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const stats = await safe(
    db.leaveRequest.groupBy({
      by: ["status"],
      _count: true,
      where: { createdAt: { gte: yearStart } },
    }),
    [] as Array<{ status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"; _count: number }>,
  );
  const statMap = Object.fromEntries(stats.map((s) => [s.status, s._count]));

  return (
    <>
      <PageHeader
        title="Leave management"
        description="Review and approve time-off requests."
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
                        {r.employee.department?.name ?? "—"} · {r.startDate.toLocaleDateString()} → {r.endDate.toLocaleDateString()}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-[10px]">{r.leaveType}</Badge>
                    <span className="font-mono text-xs tabular-nums">{r.totalDays}d</span>
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
                    <li key={r.id} className="grid grid-cols-[36px_1fr_auto_auto] items-center gap-3 p-3">
                      <Avatar src={r.employee.profilePic ?? getAvatarUrl(r.employee.email)} name={r.employee.name} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{r.employee.name}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {r.leaveType} · {r.startDate.toLocaleDateString()} → {r.endDate.toLocaleDateString()} · {r.totalDays}d
                        </p>
                      </div>
                      <Badge variant={variant} className="text-[10px]">{r.status}</Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {r.reviewedAt?.toLocaleDateString() ?? "—"}
                      </span>
                    </li>
                  );
                })}
              </ul>
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
