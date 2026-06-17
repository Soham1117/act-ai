import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ScheduleCalendar } from "./schedule-calendar";
import { addDays, startOfMonth, endOfMonth } from "date-fns";

export const metadata = { title: "Schedules" };

export default async function SchedulesPage() {
  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch { return fallback; }
  };

  const start = startOfMonth(new Date());
  const end = endOfMonth(addDays(new Date(), 60));

  const [schedules, employees, departments] = await Promise.all([
    safe(
      db.schedule.findMany({
        where: { date: { gte: start, lte: end } },
        include: {
          employee: {
            select: {
              id: true,
              name: true,
              email: true,
              departmentId: true,
              department: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
      }),
      [],
    ),
    safe(
      db.employee.findMany({
        where: { employmentStatus: "ACTIVE" },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          email: true,
          departmentId: true,
          department: { select: { id: true, name: true } },
        },
      }),
      [],
    ),
    safe(
      db.department.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      [],
    ),
  ]);

  const events = schedules.map((s) => {
    const dateStr = s.date.toISOString().split("T")[0];
    return {
      id: s.id,
      title: `${s.employee.name} · ${s.jobCode}`,
      start: `${dateStr} ${s.startTime}`,
      end: `${dateStr} ${s.endTime}`,
      description: s.notes ?? "",
      employeeId: s.employeeId,
      employeeName: s.employee.name,
      departmentId: s.employee.departmentId ?? null,
      departmentName: s.employee.department?.name ?? null,
      jobCode: s.jobCode,
      notes: s.notes,
    };
  });

  const employeesForPicker = employees.map((e) => ({
    id: e.id,
    name: e.name,
    email: e.email,
    departmentId: e.departmentId,
    departmentName: e.department?.name ?? null,
  }));

  return (
    <>
      <PageHeader
        title="Schedules"
        description={`${schedules.length} shifts in the next 60 days · ${employees.length} active employees`}
      />
      <Card>
        <CardContent className="p-2 sm:p-4">
          <ScheduleCalendar
            events={events}
            employees={employeesForPicker}
            departments={departments}
          />
        </CardContent>
      </Card>
    </>
  );
}
