import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmployeeScheduleCalendar } from "./employee-schedule-calendar";
import { addDays, startOfMonth, endOfMonth } from "date-fns";
import { isOvernight, shiftDateTimes } from "@/lib/schedule-rules";

export const metadata = { title: "Schedule" };

export default async function ScheduleViewPage() {
  const user = await requireUser();
  if (!user.employeeId)
    return <p className="text-sm text-muted-foreground">No employee record.</p>;

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
      title: `${s.jobCode}${isOvernight(s.startTime, s.endTime) ? " (+1 day)" : ""}`,
      start: evStart,
      end: evEnd,
      description: s.notes ?? "",
    };
  });

  return (
    <>
      <PageHeader
        title="My schedule"
        description="Your shifts. Use the calendar arrows to view other months. Overnight shifts show +1 day."
      />
      <Card>
        <CardContent className="p-2 sm:p-4">
          <EmployeeScheduleCalendar events={events} />
        </CardContent>
      </Card>
    </>
  );
}
