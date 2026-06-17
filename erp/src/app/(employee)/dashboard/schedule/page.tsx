import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmployeeScheduleCalendar } from "./employee-schedule-calendar";
import { addDays, startOfMonth, endOfMonth } from "date-fns";

export const metadata = { title: "Schedule" };

export default async function ScheduleViewPage() {
  const user = await requireUser();
  if (!user.employeeId)
    return <p className="text-sm text-muted-foreground">No employee record.</p>;

  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch { return fallback; }
  };

  const start = startOfMonth(new Date());
  const end = endOfMonth(addDays(new Date(), 60));

  const schedules = await safe(
    db.schedule.findMany({
      where: { employeeId: user.employeeId, date: { gte: start, lte: end } },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
    }),
    [],
  );

  const events = schedules.map((s) => ({
    id: s.id,
    title: s.jobCode,
    start: `${s.date.toISOString().split("T")[0]} ${s.startTime}`,
    end: `${s.date.toISOString().split("T")[0]} ${s.endTime}`,
    description: s.notes ?? "",
  }));

  return (
    <>
      <PageHeader
        title="My schedule"
        description={`${schedules.length} shift${schedules.length === 1 ? "" : "s"} ahead.`}
      />
      <Card>
        <CardContent className="p-2 sm:p-4">
          <EmployeeScheduleCalendar events={events} />
        </CardContent>
      </Card>
    </>
  );
}
