import Image from "next/image";
import { db } from "@/lib/db";
import { PageHeader, StatCard } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  Clock,
  Globe,
  MonitorSmartphone,
  PenLine,
  Sparkles,
} from "lucide-react";
import {
  businessDateOnly,
  formatBusinessTime,
  formatDateOnly,
  formatHours,
  getAvatarUrl,
} from "@/lib/format";
import { ApproveButton } from "./approve-button";
import type { TimeEntrySource } from "@prisma/client";

export const metadata = { title: "Time tracking" };

export default async function AdminTimeTrackingPage() {
  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch {
      return fallback;
    }
  };

  const today = businessDateOnly();
  const [pending, today_, active] = await Promise.all([
    safe(
      db.timeEntry.findMany({
        where: { approvalStatus: "PENDING", clockOut: { not: null } },
        orderBy: { clockOut: "desc" },
        include: {
          employee: {
            select: { name: true, employeeId: true, profilePic: true, email: true },
          },
        },
        take: 25,
      }),
      [],
    ),
    safe(
      db.timeEntry.findMany({
        where: { date: { gte: today } },
        orderBy: { clockIn: "desc" },
        include: {
          employee: {
            select: {
              name: true,
              employeeId: true,
              profilePic: true,
              email: true,
              department: { select: { name: true } },
            },
          },
        },
      }),
      [],
    ),
    safe(
      db.timeEntry.findMany({
        where: { status: { in: ["ACTIVE", "ON_BREAK"] } },
        include: {
          employee: {
            select: {
              name: true,
              employeeId: true,
              profilePic: true,
              email: true,
              department: { select: { name: true } },
            },
          },
        },
      }),
      [],
    ),
  ]);

  return (
    <>
      <PageHeader
        title="Time tracking"
        description="Live activity, today's entries, and the approval queue."
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Clocked in now"
          value={active.length}
          icon={<Activity className="h-4 w-4 text-primary" />}
        />
        <StatCard
          label="Today's entries"
          value={today_.length}
          icon={<Clock className="h-4 w-4" />}
        />
        <StatCard
          label="Pending approval"
          value={pending.length}
          icon={<Clock className="h-4 w-4" />}
        />
      </div>

      <Tabs defaultValue="pending" className="mt-6 space-y-4">
        <TabsList>
          <TabsTrigger value="pending">Pending approval ({pending.length})</TabsTrigger>
          <TabsTrigger value="today">Today ({today_.length})</TabsTrigger>
          <TabsTrigger value="now">Clocked in ({active.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y">
                {pending.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 p-3">
                    <Avatar
                      src={e.employee.profilePic ?? getAvatarUrl(e.employee.email)}
                      name={e.employee.name}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{e.employee.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {formatDateOnly(e.date)} · {e.jobCode} ·{" "}
                        {formatHours(e.totalWorkMin)}
                      </p>
                    </div>
                    <SourceBadge source={e.source} kioskLabel={e.kioskLabel} />
                    <ApproveButton id={e.id} />
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

        <TabsContent value="today">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Today&apos;s entries</CardTitle>
            </CardHeader>
            <CardContent>
              <EntryGrid entries={today_} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="now">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Currently on shift</CardTitle>
            </CardHeader>
            <CardContent>
              <EntryGrid entries={active} live />
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
      <Image
        src={src}
        alt={name}
        fill
        sizes="36px"
        className="object-cover"
        unoptimized
      />
    </span>
  );
}

type EntryRow = {
  id: string;
  jobCode: string;
  status: string;
  totalWorkMin: number;
  clockIn: Date;
  clockOut: Date | null;
  source: TimeEntrySource;
  kioskLabel: string | null;
  employee: {
    name: string;
    employeeId: string;
    profilePic: string | null;
    email: string | null;
    department: { name: string } | null;
  };
};

function EntryGrid({ entries, live = false }: { entries: EntryRow[]; live?: boolean }) {
  if (entries.length === 0)
    return (
      <p className="py-8 text-center text-xs text-muted-foreground">Nothing here yet.</p>
    );
  return (
    <ul className="divide-y">
      {entries.map((e) => (
        <li
          key={e.id}
          className="grid grid-cols-[36px_1fr_auto_auto_auto_auto] items-center gap-3 py-2.5"
        >
          <Avatar
            src={e.employee.profilePic ?? getAvatarUrl(e.employee.email)}
            name={e.employee.name}
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{e.employee.name}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {e.employee.department?.name ?? "—"}
            </p>
          </div>
          <span className="font-mono text-xs text-muted-foreground">{e.jobCode}</span>
          <span className="font-mono text-xs text-muted-foreground">
            {formatBusinessTime(e.clockIn)}
            {e.clockOut && ` → ${formatBusinessTime(e.clockOut)}`}
          </span>
          <SourceBadge source={e.source} kioskLabel={e.kioskLabel} />
          {live ? (
            <Badge
              variant={e.status === "ON_BREAK" ? "warning" : "success"}
              className="text-[10px]"
            >
              {e.status === "ON_BREAK" ? "On break" : "Working"}
            </Badge>
          ) : (
            <span className="font-mono text-sm tabular-nums">
              {formatHours(e.totalWorkMin)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function SourceBadge({
  source,
  kioskLabel,
}: {
  source: TimeEntrySource;
  kioskLabel?: string | null;
}) {
  const cfg: Record<TimeEntrySource, { label: string; icon: React.ReactNode }> = {
    KIOSK: { label: "Kiosk", icon: <MonitorSmartphone className="h-3 w-3" /> },
    WEB: { label: "Web", icon: <Globe className="h-3 w-3" /> },
    AUTO: { label: "Auto", icon: <Sparkles className="h-3 w-3" /> },
    MANUAL: { label: "Manual", icon: <PenLine className="h-3 w-3" /> },
  };
  const { label, icon } = cfg[source];
  const display = source === "KIOSK" && kioskLabel ? kioskLabel : label;
  return (
    <span
      title={source === "KIOSK" && kioskLabel ? `Kiosk: ${kioskLabel}` : undefined}
      className="inline-flex max-w-[140px] items-center gap-1 truncate rounded border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground"
    >
      {icon}
      <span className="truncate">{display}</span>
    </span>
  );
}
