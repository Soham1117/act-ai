import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageHeader, StatCard } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Clock, MonitorSmartphone } from "lucide-react";
import { TimeEntriesList } from "./time-entries-list";
import { businessDateOnly } from "@/lib/format";
import { isStaleShift, startOfBusinessMonth, startOfBusinessWeek } from "@/lib/time-rules";
import { getPortalLanguage } from "@/lib/portal-i18n/server";

export async function generateMetadata() {
  const { t } = await getPortalLanguage();
  return { title: t("timesheet.title") };
}

export default async function TimeTrackingPage() {
  const { t, formatTime } = await getPortalLanguage();
  const user = await requireUser();
  const employeeId = user.employeeId;

  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch {
      return fallback;
    }
  };

  if (!employeeId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("timesheet.noEmployee")}</CardTitle>
          <CardDescription>
            {t("timesheet.noEmployeeDescription")}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Week (Mon-Sun) and month boundaries are business-timezone calendar days,
  // matching how TimeEntry.date is stored.
  const today = businessDateOnly();
  const weekStart = startOfBusinessWeek(today);
  const monthStart = startOfBusinessMonth(today);
  // Rejected entries never count toward hours.
  const counted = { approvalStatus: { not: "REJECTED" as const } };

  const [active, recent, weekAgg, monthAgg] = await Promise.all([
    safe(
      db.timeEntry.findFirst({
        where: { employeeId, status: { in: ["ACTIVE", "ON_BREAK"] } },
        orderBy: { clockIn: "desc" },
      }),
      null,
    ),
    safe(
      db.timeEntry.findMany({
        where: { employeeId },
        orderBy: [{ date: "desc" }, { clockIn: "desc" }],
        take: 50,
      }),
      [],
    ),
    safe(
      db.timeEntry.aggregate({
        _sum: { totalWorkMin: true },
        where: { employeeId, date: { gte: weekStart }, ...counted },
      }),
      { _sum: { totalWorkMin: 0 } },
    ),
    safe(
      db.timeEntry.aggregate({
        _sum: { totalWorkMin: true },
        where: { employeeId, date: { gte: monthStart }, ...counted },
      }),
      { _sum: { totalWorkMin: 0 } },
    ),
  ]);

  const onBreak = active?.status === "ON_BREAK";
  const staleActive = active ? isStaleShift(active.clockIn) : false;
  const formatTrackedHours = (minutes: number | null | undefined) =>
    minutes === null || minutes === undefined
      ? "—"
      : t("timesheet.hoursFormat", {
          hours: Math.floor(minutes / 60),
          minutes: (minutes % 60).toString().padStart(2, "0"),
        });

  return (
    <>
      <PageHeader
        title={t("timesheet.title")}
        description={t("timesheet.description")}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                {t("timesheet.currentStatus")}
              </p>
              <p className="mt-1 text-base font-semibold">
                {active ? (onBreak ? t("timesheet.onBreak") : t("timesheet.clockedIn")) : t("timesheet.clockedOut")}
              </p>
              {active && staleActive && (
                <p className="mt-0.5 text-[11px] font-medium text-destructive">
                  {t("timesheet.staleShift")}
                </p>
              )}
              {active && (
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {t("timesheet.since", { time: formatTime(active.clockIn) })}
                  {" · "}
                  <span className="font-mono">{active.jobCode}</span>
                </p>
              )}
            </div>
            <Activity
              className={`h-8 w-8 ${active ? "text-primary" : "text-muted-foreground"}`}
            />
          </CardContent>
        </Card>
        <StatCard
          label={t("timesheet.hoursThisWeek")}
          value={formatTrackedHours(weekAgg._sum.totalWorkMin ?? 0)}
          icon={<Clock className="h-4 w-4" />}
        />
        <StatCard
          label={t("timesheet.hoursThisMonth")}
          value={formatTrackedHours(monthAgg._sum.totalWorkMin ?? 0)}
          icon={<Clock className="h-4 w-4" />}
        />
      </div>

      <Card className="mt-6">
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{t("timesheet.recentEntries")}</CardTitle>
            <CardDescription>{t("timesheet.last50RejectedNote")}</CardDescription>
          </div>
          <Badge variant="outline" className="gap-1.5 text-[11px]">
            <MonitorSmartphone className="h-3 w-3" />
            {t("timesheet.kioskClock")}
          </Badge>
        </CardHeader>
        <CardContent>
          <TimeEntriesList
            entries={recent.map((e) => ({
              id: e.id,
              date: e.date.toISOString(),
              clockInIso: e.clockIn.toISOString(),
              clockOutIso: e.clockOut?.toISOString() ?? null,
              jobCode: e.jobCode,
              totalWorkMin: e.totalWorkMin,
              totalBreakMin: e.totalBreakMin,
              status: e.status,
              approvalStatus: e.approvalStatus,
              source: e.source,
              kioskLabel: e.kioskLabel,
              kioskSlug: e.kioskSlug,
              approvalNotes: e.approvalNotes,
              editReason: e.editReason,
              edited: e.lastEditedById !== null,
              autoClosed: e.autoClosed,
            }))}
          />
        </CardContent>
      </Card>
    </>
  );
}
