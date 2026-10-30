/**
 * Optional one-shot TCP Period Export CSV → Persona TimeEntry (historical backfill).
 * Creates MANUAL/IMPORTED closed APPROVED entries. Never overwrites existing kiosk rows
 * that overlap the same employee + clock-in minute.
 *
 * Expected columns (header names, case-insensitive):
 *   exportCode|Employee ID|Name, Date (YYYY-MM-DD or M/D/YYYY),
 *   In / Clock In, Out / Clock Out (optional), Hours (decimal, if no out),
 *   Job Code (optional), Rate (optional)
 *
 * Dry-run default. Pass --apply to write.
 *
 *   pnpm exec tsx --env-file=.env.local scripts/import-tcp-period-export.ts \
 *     --file "/path/tcp-period.csv" [--apply]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient, Prisma } from "@prisma/client";

const db = new PrismaClient();
const apply = process.argv.includes("--apply");
const fileIdx = process.argv.indexOf("--file");
const filePath = fileIdx >= 0 ? process.argv[fileIdx + 1] : undefined;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    if (row.some((c) => c.trim())) rows.push(row);
  }
  return rows;
}

function normHeader(h: string) {
  return h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function pick(map: Map<string, number>, ...aliases: string[]) {
  for (const a of aliases) {
    const i = map.get(normHeader(a));
    if (i !== undefined) return i;
  }
  return -1;
}

function parseDate(raw: string): Date | null {
  const s = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return new Date(Date.UTC(+iso[1]!, +iso[2]! - 1, +iso[3]!));
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (us) return new Date(Date.UTC(+us[3]!, +us[1]! - 1, +us[2]!));
  return null;
}

function parseLocalOnDate(date: Date, timeRaw: string): Date | null {
  const t = timeRaw.trim();
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(t);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = m[3]?.toUpperCase();
  if (ap === "PM" && h < 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  // Store as UTC wall equivalent of Central wall (import is historical; exact TZ fold rare).
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), h, min, 0),
  );
}

async function main() {
  if (!filePath) {
    console.error("Pass --file <path-to-tcp-period.csv>");
    process.exitCode = 1;
    return;
  }
  const text = readFileSync(resolve(filePath), "utf8");
  const rows = parseCsv(text);
  if (rows.length < 2) {
    console.error("CSV has no data rows.");
    process.exitCode = 1;
    return;
  }
  const header = rows[0]!;
  const idx = new Map(header.map((h, i) => [normHeader(h), i]));
  const iCode = pick(idx, "exportCode", "export code", "employee id", "empid", "id");
  const iName = pick(idx, "name", "employee", "employee name");
  const iDate = pick(idx, "date", "work date", "day");
  const iIn = pick(idx, "in", "clock in", "time in", "start");
  const iOut = pick(idx, "out", "clock out", "time out", "end");
  const iHours = pick(idx, "hours", "total hours", "worked");
  const iJob = pick(idx, "job code", "jobcode", "job");
  const iRate = pick(idx, "rate", "pay rate", "hourly rate");

  if (iDate < 0 || (iIn < 0 && iHours < 0)) {
    console.error("Need Date plus In or Hours columns.");
    process.exitCode = 1;
    return;
  }

  const employees = await db.employee.findMany({
    select: {
      id: true,
      name: true,
      employeeId: true,
      exportCode: true,
      defaultHourlyRate: true,
    },
  });
  const byCode = new Map(
    employees
      .filter((e) => e.exportCode)
      .map((e) => [e.exportCode!.trim().toUpperCase(), e]),
  );
  const byEmpId = new Map(employees.map((e) => [e.employeeId.trim().toUpperCase(), e]));
  const byName = new Map(employees.map((e) => [e.name.trim().toLowerCase(), e]));

  let created = 0;
  let skipped = 0;
  let unmatched = 0;
  const sample: string[] = [];

  for (const raw of rows.slice(1)) {
    const code = iCode >= 0 ? (raw[iCode] ?? "").trim() : "";
    const name = iName >= 0 ? (raw[iName] ?? "").trim() : "";
    const emp =
      (code && (byCode.get(code.toUpperCase()) || byEmpId.get(code.toUpperCase()))) ||
      (name ? byName.get(name.toLowerCase()) : undefined);
    if (!emp) {
      unmatched += 1;
      if (sample.length < 8) sample.push(`unmatched:${code || name}`);
      continue;
    }
    const date = parseDate(raw[iDate] ?? "");
    if (!date) {
      skipped += 1;
      continue;
    }
    let clockIn: Date | null = null;
    let clockOut: Date | null = null;
    let totalWorkMin = 0;
    if (iIn >= 0 && (raw[iIn] ?? "").trim()) {
      clockIn = parseLocalOnDate(date, raw[iIn]!);
      if (iOut >= 0 && (raw[iOut] ?? "").trim()) {
        clockOut = parseLocalOnDate(date, raw[iOut]!);
      }
      if (clockIn && clockOut) {
        totalWorkMin = Math.max(0, Math.round((clockOut.getTime() - clockIn.getTime()) / 60_000));
      }
    }
    if (totalWorkMin <= 0 && iHours >= 0) {
      const hrs = Number(String(raw[iHours]).replace(/,/g, ""));
      if (!Number.isFinite(hrs) || hrs <= 0) {
        skipped += 1;
        continue;
      }
      totalWorkMin = Math.round(hrs * 60);
      clockIn = clockIn ?? new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 8, 0));
      clockOut = new Date(clockIn.getTime() + totalWorkMin * 60_000);
    }
    if (!clockIn || !clockOut || totalWorkMin <= 0) {
      skipped += 1;
      continue;
    }

    const overlap = await db.timeEntry.findFirst({
      where: {
        employeeId: emp.id,
        clockIn: {
          gte: new Date(clockIn.getTime() - 60_000),
          lte: new Date(clockIn.getTime() + 60_000),
        },
      },
      select: { id: true },
    });
    if (overlap) {
      skipped += 1;
      continue;
    }

    const jobCode = iJob >= 0 && (raw[iJob] ?? "").trim() ? raw[iJob]!.trim() : "GENERAL";
    const rateRaw = iRate >= 0 ? Number(String(raw[iRate]).replace(/[^0-9.]/g, "")) : NaN;
    const rate = Number.isFinite(rateRaw)
      ? new Prisma.Decimal(rateRaw)
      : emp.defaultHourlyRate;

    if (apply) {
      await db.timeEntry.create({
        data: {
          employeeId: emp.id,
          date,
          clockIn,
          clockOut,
          totalWorkMin,
          jobCode,
          rate,
          status: "COMPLETED",
          approvalStatus: "APPROVED",
          source: "MANUAL",
          timesheetNotes: "Imported from TCP Period Export",
          editReason: "TCP historical import",
        },
      });
    }
    created += 1;
  }

  console.log(
    JSON.stringify(
      {
        apply,
        file: filePath,
        created,
        skipped,
        unmatched,
        sampleUnmatched: sample,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
