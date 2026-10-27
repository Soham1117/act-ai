import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmployeeScheduleCalendar } from "./employee-schedule-calendar";
import { addDays, startOfMonth, endOfMonth } from "date-fns";
import { shiftDateTimes } from "@/lib/schedule-rules";
import { getPortalLanguage } from "@/lib/portal-i18n/server";

export async function generateMetadata() {
  const { t } = await getPortalLanguage();
  return { title: t("time.schedule.title") };
}

export default async function ScheduleViewPage() {
  const { t } = await getPortalLanguage();
  const user = await requireUser();
  if (!user.employeeId)
    return <p className="text-sm text-muted-foreground">{t("time.schedule.noEmployee")}</p>;

  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch { return fallback; }
  };

  // Initial window; the calendar fetches other months on demand.
  const start = addDays(startOfMonth(new Date()), -7);
  const end = addDays(endOfMonth(new Date()), 7);

  const schedules = await safe(
    db.schedule.findMany({
      where: { employeeId: user.employeeId, date: { gte: start, lte: end } },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
    }),
    [],
  );

  const events = schedules.map((s) => {
    const { start: evStart, end: evEnd } = shiftDateTimes(
      s.date.toISOString().split("T")[0]!,
      s.startTime,
      s.endTime,
    );
    return {
      id: s.id,
      title: s.jobCode,
      start: evStart,
      end: evEnd,
      description: s.notes ?? "",
    };
  });

  return (
    <>
      <PageHeader
        title={t("time.schedule.pageTitle")}
        description={t("time.schedule.description")}
      />
      <Card>
        <CardContent className="p-2 sm:p-4">
          <EmployeeScheduleCalendar events={events} />
        </CardContent>
      </Card>
    </>
  );
}
