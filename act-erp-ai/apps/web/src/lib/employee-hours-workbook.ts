import { buildWorkbookXlsx, type SheetModel } from "@/lib/payroll-workbook";
import { formatBusinessTime } from "@/lib/format";
import { dateOnlyToString } from "@/lib/time-rules";

type EmployeeHoursEntry = {
  date: Date;
  clockIn: Date;
  clockOut: Date | null;
  totalWorkMin: number;
  totalBreakMin: number;
  jobCode: string;
  approvalStatus: string;
};

/** One employee, inclusive business-date range. Rejected entries contribute zero hours. */
export function buildEmployeeHoursWorkbook(
  employee: { employeeId: string; name: string },
  entries: EmployeeHoursEntry[],
  from: string,
  to: string,
): Buffer {
  const days = new Map<
    string,
    {
      first: Date;
      last: Date | null;
      work: number;
      breaks: number;
      codes: Set<string>;
      approvals: Set<string>;
    }
  >();
  for (const entry of entries) {
    const date = dateOnlyToString(entry.date);
    if (date < from || date > to) continue;
    let day = days.get(date);
    if (!day) {
      day = {
        first: entry.clockIn,
        last: entry.clockOut,
        work: 0,
        breaks: 0,
        codes: new Set(),
        approvals: new Set(),
      };
      days.set(date, day);
    } else {
      if (entry.clockIn < day.first) day.first = entry.clockIn;
      if (day.last !== null && (entry.clockOut === null || entry.clockOut > day.last))
        day.last = entry.clockOut;
    }
    if (entry.approvalStatus !== "REJECTED") {
      day.work += entry.totalWorkMin;
      day.breaks += entry.totalBreakMin;
    }
    day.codes.add(entry.jobCode);
    day.approvals.add(entry.approvalStatus);
  }
  const sorted = [...days.entries()].sort(([a], [b]) => a.localeCompare(b));
  const totalMin = sorted.reduce((sum, [, day]) => sum + day.work, 0);
  const totalBreak = sorted.reduce((sum, [, day]) => sum + day.breaks, 0);
  const hours = (minutes: number) => Number((minutes / 60).toFixed(2));
  const title = `Employee hours ${from} to ${to}`;
  const summary: SheetModel = {
    name: "Employee totals",
    widths: [22, 36, 18],
    rows: [
      { cells: [title], style: "title" },
      { cells: ["Pending hours included; rejected hours excluded."], style: "note" },
      { cells: ["Employee ID", "Name", "Total hours"], style: "header" },
      { cells: [employee.employeeId, employee.name, hours(totalMin)] },
    ],
  };
  const daily: SheetModel = {
    name: "Daily hours",
    widths: [16, 16, 16, 14, 16, 22, 18],
    rows: [
      { cells: [title], style: "title" },
      { cells: [employee.employeeId, employee.name] },
      {
        cells: [
          "Date",
          "Clock in",
          "Clock out",
          "Break min",
          "Work hours",
          "Job code",
          "Approval",
        ],
        style: "header",
      },
      ...sorted.map(([date, day]) => ({
        cells: [
          date,
          formatBusinessTime(day.first),
          day.last ? formatBusinessTime(day.last) : "",
          day.breaks,
          hours(day.work),
          [...day.codes].join(" / "),
          day.approvals.size === 1 ? [...day.approvals][0]! : "MIXED",
        ],
      })),
      { cells: ["TOTALS", "", "", totalBreak, hours(totalMin), "", ""], style: "total" },
    ],
  };
  return buildWorkbookXlsx([summary, daily]);
}
