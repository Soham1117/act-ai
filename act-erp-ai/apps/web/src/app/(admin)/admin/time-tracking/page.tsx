import Image from "next/image";
import Link from "next/link";
import type { Prisma, TimeEntrySource } from "@prisma/client";
import { db } from "@/lib/db";
import { PageHeader, StatCard } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Activity,
  AlertTriangle,
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
import {
  MAX_SHIFT_MS,
  addDaysDateOnly,
  dateOnlyToString,
  parseDateOnly,
  startOfBusinessWeek,
} from "@/lib/time-rules";
import { EntryActions, ManualEntryButton, PendingQueue } from "./time-tools";
import type { EntryRowData } from "./time-types";

export const metadata = { title: "Time tracking" };

const PAGE_SIZE = 100;
const PENDING_PAGE_SIZE = 50;

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const intParam = (v: string | string[] | undefined) => Math.max(1, Number.parseInt(one(v), 10) || 1);

const entryInclude = {
  breaks: { orderBy: { startTime: "asc" } },
  employee: {
    select: {
      name: true,
      employeeId: true,
      profilePic: true,
      email: true,
      department: { select: { name: true } },
    },
  },
} satisfies Prisma.TimeEntryInclude;

type EntryWithRels = Prisma.TimeEntryGetPayload<{ include: typeof entryInclude }>;

function toRow(e: EntryWithRels): EntryRowData {
  return {
    id: e.id,
    employeeId: e.employeeId,
    employeeName: e.employee.name,
    employeeCode: e.employee.employeeId,
    avatar: e.employee.profilePic ?? getAvatarUrl(e.employee.email),
    date: dateOnlyToString(e.date),
    clockIn: e.clockIn.toISOString(),
    clockOut: e.clockOut?.toISOString() ?? null,
    jobCode: e.jobCode,
    notes: e.timesheetNotes,
    status: e.status,
    approvalStatus: e.approvalStatus,
    approvalNotes: e.approvalNotes,
    editReason: e.editReason,
    autoClosed: e.autoClosed,
    source: e.source,
    kioskLabel: e.kioskLabel,
    totalWorkMin: e.totalWorkMin,
    totalBreakMin: e.totalBreakMin,
    breaks: e.breaks.map((b) => ({
      id: b.id,
      start: b.startTime.toISOString(),
      end: b.endTime?.toISOString() ?? null,
    })),
  };
}

export default async function AdminTimeTrackingPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch (err) {
      console.error("[admin/time-tracking] query failed", err);
      return fallback;
    }
  };

  // Date range filter; defaults to the current Mon-Sun business week.
  const today = businessDateOnly();
  const weekStart = startOfBusinessWeek(today);
  const fromParsed = parseDateOnly(one(sp.from));
  const toParsed = parseDateOnly(one(sp.to));
  const from = fromParsed ?? weekStart;
  const to = toParsed ?? addDaysDateOnly(weekStart, 6);
  const rangeFrom = from <= to ? from : to;
  const rangeTo = from <= to ? to : from;
  const q = one(sp.q).trim();
  const page = intParam(sp.page);
  const ppage = intParam(sp.ppage);

  const employeeFilter: Prisma.TimeEntryWhereInput = q
    ? {
        employee: {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { employeeId: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        },
      }
    : {};

  const now = new Date();
  const staleCutoff = new Date(now.getTime() - MAX_SHIFT_MS);
  const rangeWhere: Prisma.TimeEntryWhereInput = {
    date: { gte: rangeFrom, lte: rangeTo },
    ...employeeFilter,
  };
  const pendingWhere: Prisma.TimeEntryWhereInput = {
    approvalStatus: "PENDING",
    status: "COMPLETED",
    clockOut: { not: null },
    ...employeeFilter,
  };

  const [
    pending,
    pendingCount,
    entries,
    entriesCount,
    totalsByEmployee,
    rangeSum,
    live,
    stale,
    autoClosed,
    jobCodes,
    employees,
  ] = await Promise.all([
    safe(
      db.timeEntry.findMany({
        where: pendingWhere,
        orderBy: [{ date: "asc" }, { clockOut: "asc" }],
        include: entryInclude,
        take: PENDING_PAGE_SIZE,
        skip: (ppage - 1) * PENDING_PAGE_SIZE,
      }),
      [],
    ),
    safe(db.timeEntry.count({ where: pendingWhere }), 0),
    safe(
      db.timeEntry.findMany({
        where: rangeWhere,
        orderBy: [{ date: "desc" }, { clockIn: "desc" }],
        include: entryInclude,
        take: PAGE_SIZE,
        skip: (page - 1) * PAGE_SIZE,
      }),
      [],
    ),
    safe(db.timeEntry.count({ where: rangeWhere }), 0),
    safe(
      db.timeEntry.groupBy({
        by: ["employeeId"],
        where: { ...rangeWhere, approvalStatus: { not: "REJECTED" } },
        _sum: { totalWorkMin: true },
        _count: true,
      }),
      [],
    ),
    safe(
      db.timeEntry.aggregate({
        where: { ...rangeWhere, approvalStatus: { not: "REJECTED" } },
        _sum: { totalWorkMin: true },
      }),
      { _sum: { totalWorkMin: 0 } },
    ),
    safe(
      db.timeEntry.findMany({
        where: { status: { in: ["ACTIVE", "ON_BREAK"] }, clockIn: { gte: staleCutoff } },
        orderBy: { clockIn: "asc" },
        include: entryInclude,
      }),
      [],
    ),
    safe(
      db.timeEntry.findMany({
        where: { status: { in: ["ACTIVE", "ON_BREAK"] }, clockIn: { lt: staleCutoff } },
        orderBy: { clockIn: "asc" },
        include: entryInclude,
      }),
      [],
    ),
    safe(
      db.timeEntry.findMany({
        where: { autoClosed: true, approvalStatus: "PENDING", clockOut: { not: null } },
        orderBy: { clockIn: "asc" },
        include: entryInclude,
      }),
      [],
    ),
    safe(
      db.jobCode.findMany({
        where: { isActive: true },
        orderBy: { code: "asc" },
        select: { code: true, title: true },
      }),
      [],
    ),
    safe(
      db.employee.findMany({
        where: { employmentStatus: { in: ["ACTIVE", "ON_LEAVE", "TERMINATED"] } },
        orderBy: { name: "asc" },
        select: { id: true, name: true, employeeId: true, employmentStatus: true },
      }),
      [],
    ),
  ]);

  const nameById = new Map(employees.map((e) => [e.id, e]));
  const totals = totalsByEmployee
    .map((t) => ({
      employeeId: t.employeeId,
      name: nameById.get(t.employeeId)?.name ?? "Unknown",
      code: nameById.get(t.employeeId)?.employeeId ?? "",
      minutes: t._sum.totalWorkMin ?? 0,
      count: t._count,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const attentionCount = stale.length + autoClosed.length;
  const defaultTab = one(sp.tab) || (attentionCount > 0 ? "attention" : "pending");
  const pendingRows = pending.map(toRow);
  const entryRows = entries.map(toRow);
  const liveRows = live.map(toRow);
  const staleRows = stale.map(toRow);
  const autoRows = autoClosed.map(toRow);

  const base: Record<string, string> = {
    from: dateOnlyToString(rangeFrom),
    to: dateOnlyToString(rangeTo),
    ...(q ? { q } : {}),
  };
  const href = (extra: Record<string, string>) =>
    `/admin/time-tracking?${new URLSearchParams({ ...base, ...extra }).toString()}`;
  const pages = Math.max(1, Math.ceil(entriesCount / PAGE_SIZE));
  const ppages = Math.max(1, Math.ceil(pendingCount / PENDING_PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Time tracking"
        description="Live activity, approvals, history, and corrections. All times are Central."
        actions={
          <ManualEntryButton
            employees={employees.map((e) => ({ id: e.id, name: e.name, employeeId: e.employeeId }))}
            jobCodes={jobCodes}
          />
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Clocked in now"
          value={live.length}
          icon={<Activity className="h-4 w-4 text-primary" />}
        />
        <StatCard
          label="Needs attention"
          value={attentionCount}
          icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
        />
        <StatCard
          label="Pending approval"
          value={pendingCount}
          icon={<Clock className="h-4 w-4" />}
        />
        <StatCard
          label="Hours in range"
          value={formatHours(rangeSum._sum.totalWorkMin ?? 0)}
          icon={<Clock className="h-4 w-4" />}
        />
      </div>

      <Tabs defaultValue={defaultTab} className="mt-6 space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="attention">Needs attention ({attentionCount})</TabsTrigger>
          <TabsTrigger value="pending">Pending approval ({pendingCount})</TabsTrigger>
          <TabsTrigger value="entries">Entries ({entriesCount})</TabsTrigger>
          <TabsTrigger value="now">Clocked in ({live.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="attention" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Shifts open over 16 hours ({staleRows.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {staleRows.length === 0 ? (
                <p className="py-8 text-center text-xs text-muted-foreground">
                  No stale shifts. Nothing is open longer than 16 hours.
                </p>
              ) : (
                <ul className="divide-y">
                  {staleRows.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center gap-3 p-3">
                      <Avatar src={e.avatar} name={e.employeeName} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{e.employeeName}</p>
                        <p className="text-[11px] text-destructive">
                          Clocked in {formatDateOnly(e.date)} at {formatBusinessTime(e.clockIn)} and
                          never clocked out ({Math.floor((now.getTime() - new Date(e.clockIn).getTime()) / 3_600_000)}h ago).
                          The employee can still clock in again; this shift is closed and flagged then.
                        </p>
                      </div>
                      <EntryActions entry={e} jobCodes={jobCodes} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Auto-closed at the cap, awaiting review ({autoRows.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {autoRows.length === 0 ? (
                <p className="py-8 text-center text-xs text-muted-foreground">Nothing auto-closed.</p>
              ) : (
                <PendingQueue entries={autoRows} jobCodes={jobCodes} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pending">
          <Card>
            <CardContent className="p-0">
              <PendingQueue entries={pendingRows} jobCodes={jobCodes} />
              {ppages > 1 && (
                <Pager
                  page={ppage}
                  pages={ppages}
                  prev={href({ tab: "pending", ppage: String(ppage - 1) })}
                  next={href({ tab: "pending", ppage: String(ppage + 1) })}
                  label={`${pendingCount} pending`}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="entries" className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <form method="get" action="/admin/time-tracking" className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tab" value="entries" />
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground" htmlFor="tt-from">From</label>
                  <Input id="tt-from" type="date" name="from" defaultValue={dateOnlyToString(rangeFrom)} className="h-9 w-40" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground" htmlFor="tt-to">To</label>
                  <Input id="tt-to" type="date" name="to" defaultValue={dateOnlyToString(rangeTo)} className="h-9 w-40" />
                </div>
                <div className="min-w-[200px] flex-1 space-y-1">
                  <label className="text-xs text-muted-foreground" htmlFor="tt-q">Employee</label>
                  <Input id="tt-q" name="q" defaultValue={q} placeholder="Search name, ID, or email" className="h-9" />
                </div>
                <Button type="submit" size="sm">Apply</Button>
                <Button asChild type="button" variant="ghost" size="sm">
                  <Link href="/admin/time-tracking?tab=entries">Current week</Link>
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Totals by employee ({formatDateOnly(rangeFrom)} to {formatDateOnly(rangeTo)})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {totals.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">No entries in this range.</p>
              ) : (
                <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                  {totals.map((t) => (
                    <li key={t.employeeId} className="flex items-center justify-between border-b py-1.5 text-sm">
                      <span className="truncate">
                        {t.name} <span className="text-[11px] text-muted-foreground">{t.count} entr{t.count === 1 ? "y" : "ies"}</span>
                      </span>
                      <span className="font-mono tabular-nums">{formatHours(t.minutes)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">Rejected entries are excluded from totals.</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <EntryList entries={entryRows} jobCodes={jobCodes} />
              {pages > 1 && (
                <Pager
                  page={page}
                  pages={pages}
                  prev={href({ tab: "entries", page: String(page - 1) })}
                  next={href({ tab: "entries", page: String(page + 1) })}
                  label={`${entriesCount} entries`}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="now">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Currently on shift</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <EntryList entries={liveRows} jobCodes={jobCodes} live />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}

function Pager({
  page,
  pages,
  prev,
  next,
  label,
}: {
  page: number;
  pages: number;
  prev: string;
  next: string;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between border-t p-3 text-xs text-muted-foreground">
      <span>
        {label} · page {page} of {pages}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Button asChild size="sm" variant="outline"><Link href={prev}>Previous</Link></Button>
        ) : (
          <Button size="sm" variant="outline" disabled>Previous</Button>
        )}
        {page < pages ? (
          <Button asChild size="sm" variant="outline"><Link href={next}>Next</Link></Button>
        ) : (
          <Button size="sm" variant="outline" disabled>Next</Button>
        )}
      </div>
    </div>
  );
}

function Avatar({ src, name }: { src: string; name: string }) {
  return (
    <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-muted">
      <Image src={src} alt={name} fill sizes="36px" className="object-cover" unoptimized />
    </span>
  );
}

function EntryList({
  entries,
  jobCodes,
  live = false,
}: {
  entries: EntryRowData[];
  jobCodes: { code: string; title: string }[];
  live?: boolean;
}) {
  if (entries.length === 0)
    return <p className="py-8 text-center text-xs text-muted-foreground">Nothing here.</p>;
  return (
    <ul className="divide-y">
      {entries.map((e) => (
        <li key={e.id} className="flex flex-wrap items-center gap-3 p-3">
          <Avatar src={e.avatar} name={e.employeeName} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {e.employeeName}{" "}
              <span className="text-[11px] font-normal text-muted-foreground">{formatDateOnly(e.date)}</span>
            </p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {e.jobCode} · {formatBusinessTime(e.clockIn)}
              {e.clockOut && ` → ${formatBusinessTime(e.clockOut)}`}
              {e.totalBreakMin > 0 && ` · breaks ${formatHours(e.totalBreakMin)}`}
            </p>
            {e.editReason && (
              <p className="truncate text-[11px] text-muted-foreground">{e.editReason}</p>
            )}
          </div>
          {e.autoClosed && (
            <Badge variant="destructive" className="text-[10px]">Auto-closed</Badge>
          )}
          <SourceBadge source={e.source} kioskLabel={e.kioskLabel} />
          {live ? (
            <Badge variant={e.status === "ON_BREAK" ? "warning" : "success"} className="text-[10px]">
              {e.status === "ON_BREAK" ? "On break" : "Working"}
            </Badge>
          ) : (
            <>
              <Badge
                variant={
                  e.approvalStatus === "APPROVED"
                    ? "success"
                    : e.approvalStatus === "REJECTED"
                      ? "destructive"
                      : "warning"
                }
                className="text-[10px]"
              >
                {e.status === "ACTIVE" || e.status === "ON_BREAK" ? "Open" : e.approvalStatus}
              </Badge>
              <span className="w-16 text-right font-mono text-sm tabular-nums">
                {formatHours(e.totalWorkMin)}
              </span>
            </>
          )}
          <EntryActions entry={e} jobCodes={jobCodes} compact />
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
