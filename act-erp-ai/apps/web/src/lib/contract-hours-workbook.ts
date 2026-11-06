import { buildWorkbookXlsx, type SheetModel } from "@/lib/payroll-workbook";

export type ContractHoursDay = {
  agency: string; workerId: string; name: string; date: string;
  clockIn: string; clockOut: string; breakMin: number; workMin: number;
  jobCode: string; approval: string;
};

export function buildContractHoursWorkbook(days: ContractHoursDay[], from: string, to: string): Buffer {
  const title = `Contract hours ${from} to ${to}`;
  const workers = new Map<string, { agency: string; workerId: string; name: string; workMin: number }>();
  for (const day of days) {
    const worker = workers.get(day.workerId);
    if (worker) worker.workMin += day.workMin;
    else workers.set(day.workerId, { ...day });
  }
  const hours = (minutes: number) => Number((minutes / 60).toFixed(2));
  const totalWork = days.reduce((sum, day) => sum + day.workMin, 0);
  const totals: SheetModel = {
    name: "Worker totals", widths: [28, 16, 32, 18],
    rows: [
      { cells: [title], style: "title" },
      { cells: [] },
      { cells: ["Agency", "Worker ID", "Name", "Total hours"], style: "header" },
      ...[...workers.values()].map((worker) => ({ cells: [worker.agency, worker.workerId, worker.name, hours(worker.workMin)] })),
      { cells: ["TOTALS", "", "", hours(totalWork)], style: "total" },
    ],
  };
  const daily: SheetModel = {
    name: "Daily hours", widths: [28, 16, 32, 16, 16, 16, 14, 16, 18, 18],
    rows: [
      { cells: [title], style: "title" },
      { cells: [] },
      { cells: ["Agency", "Worker ID", "Name", "Date", "Clock in", "Clock out", "Break min", "Work hours", "Job code", "Approval"], style: "header" },
      ...days.map((day) => ({ cells: [day.agency, day.workerId, day.name, day.date, day.clockIn, day.clockOut, day.breakMin, hours(day.workMin), day.jobCode, day.approval] })),
      { cells: ["TOTALS", "", "", "", "", "", days.reduce((sum, day) => sum + day.breakMin, 0), hours(totalWork), "", ""], style: "total" },
    ],
  };
  return buildWorkbookXlsx([totals, daily]);
}
