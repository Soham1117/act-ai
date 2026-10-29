import Image from "next/image";
import { db } from "@/lib/db";
import { PageHeader, StatCard } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ClipboardList } from "lucide-react";
import { getAvatarUrl } from "@/lib/format";
import { MobileTabsList } from "@/components/mobile";
import { RequestStatusButtons } from "./request-status-buttons";
import { formatDistanceToNow } from "date-fns";

export const metadata = { title: "Requests" };

export default async function AdminRequestsPage() {
  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch { return fallback; }
  };

  const [pending, processing, all, counts] = await Promise.all([
    safe(
      db.request.findMany({
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" },
        include: { employee: { select: { name: true, email: true, profilePic: true } } },
      }),
      [],
    ),
    safe(
      db.request.findMany({
        where: { status: "PROCESSING" },
        orderBy: { createdAt: "asc" },
        include: { employee: { select: { name: true, email: true, profilePic: true } } },
      }),
      [],
    ),
    safe(
      db.request.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { employee: { select: { name: true, email: true, profilePic: true } } },
      }),
      [],
    ),
    // Totals come from counts, not from the (capped) list above.
    safe(
      db.request.groupBy({ by: ["status"], _count: true }),
      [] as Array<{ status: string; _count: number }>,
    ),
  ]);
  const countBy = Object.fromEntries(counts.map((c) => [c.status, c._count])) as Record<string, number>;
  const totalCount = counts.reduce((s, c) => s + c._count, 0);

  return (
    <>
      <PageHeader
        title="Requests"
        description="General-purpose request queue (12 types)."
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Pending" value={countBy.PENDING ?? 0} icon={<ClipboardList className="h-4 w-4 text-primary" />} />
        <StatCard label="Processing" value={countBy.PROCESSING ?? 0} />
        <StatCard label="Total" value={totalCount} />
      </div>

      <Tabs defaultValue="pending" className="mt-6 space-y-4">
        <MobileTabsList>
          <TabsTrigger value="pending">Pending ({countBy.PENDING ?? 0})</TabsTrigger>
          <TabsTrigger value="processing">Processing ({countBy.PROCESSING ?? 0})</TabsTrigger>
          <TabsTrigger value="all">All (latest {all.length} of {totalCount})</TabsTrigger>
        </MobileTabsList>
        <TabsContent value="pending"><RequestList rows={pending} /></TabsContent>
        <TabsContent value="processing"><RequestList rows={processing} /></TabsContent>
        <TabsContent value="all"><RequestList rows={all} /></TabsContent>
      </Tabs>
    </>
  );
}

type RequestRow = {
  id: string;
  title: string;
  description: string;
  adminNotes: string | null;
  type: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "REJECTED";
  createdAt: Date;
  employee: { name: string; email: string | null; profilePic: string | null };
};

function RequestList({ rows }: { rows: RequestRow[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="grid h-32 place-items-center text-xs text-muted-foreground">
          Nothing here.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="p-0">
        <ul className="divide-y">
          {rows.map((r) => {
            const variant =
              r.status === "COMPLETED" ? "success" :
              r.status === "REJECTED" ? "destructive" :
              r.status === "PROCESSING" ? "warning" :
              r.status === "PENDING" ? "warning" : "outline";
            return (
              <li key={r.id} className="flex flex-col gap-2 p-3 sm:grid sm:grid-cols-[36px_minmax(0,1fr)_auto_auto] sm:items-start sm:gap-3">
                <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-muted">
                  <Image src={r.employee.profilePic ?? getAvatarUrl(r.employee.email)} alt={r.employee.name} fill sizes="36px" className="object-cover" unoptimized />
                </span>
                <div className="min-w-0 sm:col-start-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium">{r.title}</p>
                    <Badge variant="outline" className="text-[10px]">{r.type.replace(/_/g, " ")}</Badge>
                    <Badge variant={variant} className="text-[10px] sm:hidden">{r.status}</Badge>
                  </div>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{r.description}</p>
                  {r.adminNotes && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <span className="font-medium">Admin note:</span> {r.adminNotes}
                    </p>
                  )}
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {r.employee.name} · {formatDistanceToNow(r.createdAt, { addSuffix: true })}
                  </p>
                </div>
                <Badge variant={variant} className="hidden text-[10px] sm:inline-flex">{r.status}</Badge>
                <div className="min-w-0 sm:col-span-full">
                  <RequestStatusButtons id={r.id} current={r.status} />
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
