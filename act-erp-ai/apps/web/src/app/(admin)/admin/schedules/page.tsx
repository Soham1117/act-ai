import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ScheduleCalendar } from "./schedule-calendar";
import { addDays, startOfMonth, endOfMonth } from "date-fns";
import { isOvernight, shiftDateTimes } from "@/lib/schedule-rules";

export const metadata = { title: "Schedules" };

export default async function SchedulesPage() {
  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch { return fallback; }
  };

  // Initial window only. The calendar fetches any other month (past or
  // future) on demand as the admin navigates.
  const start = addDays(startOfMonth(new Date()), -7);
  const end = addDays(endOfMonth(new Date()), 7);

  const [schedules, employees, departments, jobCodes] = await Promise.all([
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
    safe(
      db.jobCode.findMany({
        where: { isActive: true },
        orderBy: { code: "asc" },
        select: { code: true, title: true },
      }),
      [],
    ),
  ]);

  const events = schedules.map((s) => {
    const dateStr = s.date.toISOString().split("T")[0]!;
    const over = isOvernight(s.startTime, s.endTime);
    const { start: evStart, end: evEnd } = shiftDateTimes(dateStr, s.startTime, s.endTime);
    return {
      id: s.id,
      title: `${s.employee.name} · ${s.jobCode}${over ? " (+1 day)" : ""}`,
      start: evStart,
      end: evEnd,
      description: s.notes ?? "",
      employeeId: s.employeeId,
      employeeName: s.employee.name,
      departmentId: s.employee.departmentId ?? null,
      departmentName: s.employee.department?.name ?? null,
      jobCode: s.jobCode,
      notes: s.notes,
      date: dateStr,
      startTime: s.startTime,
      endTime: s.endTime,
      overnight: over,
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
        description={`${employees.length} active employees. Use the calendar arrows or date picker to view and edit any month, past or future. Shifts that end before they start run overnight.`}
      />
      <Card>
        <CardContent className="p-2 sm:p-4">
          <ScheduleCalendar
            events={events}
            employees={employeesForPicker}
            departments={departments}
            jobCodes={jobCodes}
          />
        </CardContent>
      </Card>
    </>
  );
}
