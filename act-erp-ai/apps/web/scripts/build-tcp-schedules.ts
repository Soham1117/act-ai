/**
 * Build each active employee's usual weekly schedule from the last weeks of
 * Timeclock Plus "Schedule Variance" and load it as Persona Schedule rows for
 * the coming weeks.
 *
 * Dry run is the default; pass --apply to write. Employees who already have a
 * schedule on or after the start date are left alone, so it is safe to re-run.
 *
 *   pnpm exec tsx scripts/build-tcp-schedules.ts --dir "<exports folder>" \
 *     [--from 2026-09-03 --to 2026-10-28] [--start 2026-11-02] [--weeks 12] [--apply]
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { parseScheduledShifts, parseWeeklyPunch, readSheetRows, usualWeek } from "../src/lib/tcp-xml";

const db = new PrismaClient();
const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1]! : d;
};
const apply = process.argv.includes("--apply");
const dir = arg("dir");
if (!dir) throw new Error("--dir is required");
const from = arg("from", "2026-09-03")!;
const to = arg("to", "2026-10-28")!;
const start = arg("start", "2026-11-02")!;
const weeks = Number(arg("weeks", "12"));

const files = readdirSync(dir).filter((f) => f.endsWith(".xml") && !/\(\d\)\.xml$/.test(f));
const find = (prefix: string) => files.filter((f) => f.startsWith(prefix)).sort().at(-1)!;
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const addDays = (iso: string, n: number) => new Date(day(iso).getTime() + n * 86_400_000).toISOString().slice(0, 10);
/** Leave-type codes (PTO, holiday, bereavement …) are not a worked job. */
const isWorkCode = (code: string) => Number(code) < 100;

function thanksgiving(year: number): string {
  const first = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  return `${year}-11-${String(1 + ((4 - first + 7) % 7) + 21).padStart(2, "0")}`;
}

async function main() {
  const shifts = parseScheduledShifts(readSheetRows(join(dir!, find("Schedule Variance"))));
  const punches = parseWeeklyPunch(readSheetRows(join(dir!, find("Weekly Punch")))).punches;

  // Company holidays: days many people were paid code 102 over the last holiday season.
  const perDay = new Map<string, Set<string>>();
  for (const p of punches) {
    if (p.jobCode !== "102") continue;
    const d = p.clockIn.toISOString().slice(0, 10);
    perDay.set(d, (perDay.get(d) ?? new Set()).add(p.number));
  }
  const lastHolidays = [...perDay.entries()]
    .filter(([d, s]) => s.size >= 15 && d >= "2025-11-01" && d <= "2026-01-31")
    .map(([d]) => d)
    .sort();
  const horizonYear = Number(start.slice(0, 4));
  const tg25 = thanksgiving(2025);
  const tg26 = thanksgiving(horizonYear);
  const skipDates = new Set<string>();
  for (const d of lastHolidays) {
    if (d.startsWith("2025-11")) {
      skipDates.add(addDays(tg26, Math.round((day(d).getTime() - day(tg25).getTime()) / 86_400_000)));
    } else {
      const year = d.startsWith("2025-12") ? horizonYear : horizonYear + 1;
      skipDates.add(`${year}${d.slice(4)}`);
    }
  }

  const employees = await db.employee.findMany({
    where: { employmentStatus: "ACTIVE", tcpNumber: { not: null } },
    select: { id: true, employeeId: true, name: true, tcpNumber: true },
  });
  const codes = new Set((await db.jobCode.findMany({ select: { code: true } })).map((j) => j.code));
  const personaCodes = new Map<string, string>();
  for (const t of await db.timeEntry.findMany({
    where: { source: { not: "TCP" } },
    orderBy: { clockIn: "desc" },
    select: { employeeId: true, jobCode: true },
  })) if (!personaCodes.has(t.employeeId)) personaCodes.set(t.employeeId, t.jobCode);
  const alreadyScheduled = new Set(
    (await db.schedule.findMany({ where: { date: { gte: day(start) } }, select: { employeeId: true }, distinct: ["employeeId"] })).map((s) => s.employeeId),
  );

  const rows: Prisma.ScheduleCreateManyInput[] = [];
  const report = { patterns: 0, noPattern: [] as string[], alreadyHadSchedule: [] as string[], noJobCode: [] as string[] };
  for (const e of employees) {
    if (alreadyScheduled.has(e.id)) { report.alreadyHadSchedule.push(e.name); continue; }
    const mine = shifts.filter((s) => s.number === e.tcpNumber);
    const week = usualWeek(mine, from, to);
    if (Object.keys(week.days).length === 0) { report.noPattern.push(e.name); continue; }
    const tally = new Map<string, number>();
    for (const p of punches) {
      if (p.number !== e.tcpNumber || !isWorkCode(p.jobCode)) continue;
      const d = p.clockIn.toISOString().slice(0, 10);
      if (d >= from && d <= to) tally.set(p.jobCode, (tally.get(p.jobCode) ?? 0) + 1);
    }
    const top = (m: Map<string, number>) => [...m.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
    // Fallbacks when they did not punch in the window: all TCP history, then Persona's own entries.
    const ever = new Map<string, number>();
    for (const p of punches) {
      if (p.number === e.tcpNumber && isWorkCode(p.jobCode)) ever.set(p.jobCode, (ever.get(p.jobCode) ?? 0) + 1);
    }
    const personaCode = personaCodes.get(e.id);
    const jobCode = [top(tally), top(ever), personaCode].find((c) => c && codes.has(c));
    if (!jobCode) { report.noJobCode.push(e.name); continue; }
    report.patterns += 1;
    for (let i = 0; i < weeks * 7; i += 1) {
      const date = addDays(start, i);
      if (skipDates.has(date)) continue;
      const slot = week.days[day(date).getUTCDay()];
      if (!slot) continue;
      rows.push({
        employeeId: e.id,
        date: day(date),
        jobCode,
        startTime: slot.start,
        endTime: slot.end,
        notes: "From TCP schedule pattern (last 8 weeks)",
      });
    }
  }

  let written = 0;
  if (apply) for (let i = 0; i < rows.length; i += 1000) written += (await db.schedule.createMany({ data: rows.slice(i, i + 1000) })).count;
  console.log(JSON.stringify({
    apply,
    window: { from, to },
    horizon: { start, weeks, holidaysSkipped: [...skipDates].sort() },
    holidaysSeenLastYear: lastHolidays,
    employeesActiveWithTcp: employees.length,
    ...report,
    rows: rows.length,
    written: apply ? written : undefined,
  }, null, 2));
  if (!apply) console.log("\nDry run: nothing written. Add --apply to write.");
}

main().finally(() => db.$disconnect());
