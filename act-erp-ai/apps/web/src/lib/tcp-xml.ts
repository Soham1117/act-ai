/**
 * Readers for Timeclock Plus report exports saved as Excel 2003 XML
 * (SpreadsheetML). Pure functions: no database, no filesystem except
 * `readSheetRows`. Times in these files are America/Chicago wall clock.
 */
import { readFileSync } from "node:fs";
import { instantFromBusinessTime } from "@/lib/business-time";

export type SheetRow = string[];

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function decode(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

/** Parse SpreadsheetML into sparse-aware rows (honours ss:Index gaps). */
export function parseSheetRows(xml: string): SheetRow[] {
  const rows: SheetRow[] = [];
  const rowRe = /<Row\b[^>]*?(?:\/>|>([\s\S]*?)<\/Row>)/g;
  const cellRe = /<Cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Cell>)/g;
  const dataRe = /<Data\b[^>]*>([\s\S]*?)<\/Data>/;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(xml))) {
    const body = rm[1] ?? "";
    const row: string[] = [];
    let pos = 0;
    cellRe.lastIndex = 0;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(body))) {
      const idx = /ss:Index="(\d+)"/.exec(cm[1] ?? "");
      if (idx) pos = Number(idx[1]) - 1;
      const d = dataRe.exec(cm[2] ?? "");
      row[pos] = d ? decode(d[1] ?? "").trim() : "";
      pos += 1;
    }
    for (let i = 0; i < row.length; i += 1) row[i] ??= "";
    rows.push(row);
  }
  return rows;
}

export function readSheetRows(path: string): SheetRow[] {
  return parseSheetRows(readFileSync(path, "utf8"));
}

const cell = (r: SheetRow, i: number) => (r[i] ?? "").trim();

/** "6:40" / "-1446:00" → minutes. */
export function hoursToMinutes(raw: string): number | null {
  const m = /^(-?)(\d+):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const v = Number(m[2]) * 60 + Number(m[3]);
  return m[1] ? -v : v;
}

/** "(1.5400)" → -1.54 ; "" → 0 */
export function parseDecimal(raw: string): number {
  const s = raw.trim();
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s);
  const n = Number(s.replace(/[()$,]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return neg ? -n : n;
}

/** "6/25/2021" or "6/25/21" → [y, m, d] */
export function parseUsDate(raw: string): [number, number, number] | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(raw.trim());
  if (!m) return null;
  let y = Number(m[3]);
  if (y < 100) y += y >= 70 ? 1900 : 2000;
  return [y, Number(m[1]), Number(m[2])];
}

/** "09:00 AM" → [h, m] (24h) */
export function parseUsTime(raw: string): [number, number] | null {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(raw.trim());
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3]!.toUpperCase() === "PM") h += 12;
  return [h, Number(m[2])];
}

export function chicagoInstant(date: string, time: string): Date | null {
  const d = parseUsDate(date);
  const t = parseUsTime(time);
  if (!d || !t) return null;
  return instantFromBusinessTime(d[0], d[1], d[2], t[0], t[1]);
}

/** Calendar day (UTC midnight, matches @db.Date) of a US date string. */
export function dateOnly(date: string): Date | null {
  const d = parseUsDate(date);
  return d ? new Date(Date.UTC(d[0], d[1] - 1, d[2])) : null;
}

/** Stable comparison key for names: "Lowell (Tristan) Williams" → "lowell williams". */
export function nameKey(name: string): string {
  const tokens = name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z\s'-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return "";
  if (tokens.length === 1) return tokens[0]!;
  return `${tokens[0]} ${tokens[tokens.length - 1]}`;
}

// ── Weekly Punch ────────────────────────────────────────────────────────────

export type TcpPunch = {
  number: string;
  name: string;
  /** Rounded (paid) in/out — what TCP payroll used. */
  clockIn: Date;
  clockOut: Date | null;
  actualIn: Date | null;
  actualOut: Date | null;
  jobCode: string;
  minutes: number;
  /** Hours typed on the timesheet with no punch ("TS" in the Out column). */
  manual: boolean;
  /** "*" unapproved missed punch in TCP. */
  unapprovedMissedPunch: boolean;
  /** No out time and not a timesheet entry: still clocked in when exported. */
  open: boolean;
};

export type PunchParseResult = {
  punches: TcpPunch[];
  skipped: Array<{ row: number; reason: string }>;
};

export function parseWeeklyPunch(rows: SheetRow[]): PunchParseResult {
  const punches: TcpPunch[] = [];
  const skipped: PunchParseResult["skipped"] = [];
  let number = "";
  let name = "";
  rows.forEach((r, i) => {
    if (/^\d+$/.test(cell(r, 0)) && cell(r, 1)) {
      number = cell(r, 0);
      name = cell(r, 1);
    } else if (!parseUsDate(cell(r, 3))) {
      return; // titles, headers, blank rows
    }
    if (!number) return;
    const inDate = cell(r, 3);
    const inTime = cell(r, 4);
    const clockIn = chicagoInstant(inDate, inTime);
    if (!clockIn) {
      skipped.push({ row: i, reason: `unreadable in time "${inDate} ${inTime}"` });
      return;
    }
    const outDate = cell(r, 7);
    const outTime = cell(r, 8);
    const minutes = hoursToMinutes(cell(r, 12));
    const manual = outDate.toUpperCase() === "TS" || outTime.toUpperCase() === "TS";
    let clockOut = chicagoInstant(outDate, outTime);
    if (manual && minutes !== null) clockOut = new Date(clockIn.getTime() + minutes * 60_000);
    const open = !clockOut;
    const flagged = r.slice(0, 11).some((c) => c.includes("*"));
    punches.push({
      number,
      name,
      clockIn,
      clockOut,
      actualIn: chicagoInstant(cell(r, 5), cell(r, 6)),
      actualOut: chicagoInstant(cell(r, 9), cell(r, 10)),
      jobCode: cell(r, 11),
      minutes: minutes ?? (clockOut ? Math.round((clockOut.getTime() - clockIn.getTime()) / 60_000) : 0),
      manual,
      unapprovedMissedPunch: flagged,
      open,
    });
  });
  return { punches, skipped };
}

// ── Employee roster (Complete Payroll "Name: … Number: …" header rows) ─────

export type TcpEmployee = {
  number: string;
  name: string;
  exportCode: string | null;
  department: string | null;
  location: string | null;
};

const ROSTER_RE =
  /^Name:\s*(.*?)\s+Number:\s*(\d+)(?:\s+Export Code:\s*(.*?))?(?:\s+SSN:\s*\S*)?(?:\s+Department:\s*(.*?))?(?:\s+Location:\s*(.*?))?\s*$/;

/** SSNs are matched past, never captured. */
export function parseRoster(rows: SheetRow[]): TcpEmployee[] {
  const out = new Map<string, TcpEmployee>();
  for (const r of rows) {
    const first = cell(r, 0);
    if (!first.startsWith("Name:")) continue;
    const m = ROSTER_RE.exec(first.replace(/\s+/g, " "));
    if (!m) continue;
    out.set(m[2]!, {
      number: m[2]!,
      name: m[1]!.trim(),
      exportCode: m[3]?.trim() || null,
      department: m[4]?.trim() || null,
      location: m[5]?.trim() || null,
    });
  }
  return [...out.values()];
}

// ── Job codes ───────────────────────────────────────────────────────────────

export type TcpJobCode = { number: string; description: string };

/** Job Code Analysis Summary: "2-ENGINEERING | total | …" */
export function parseJobCodeSummary(rows: SheetRow[]): TcpJobCode[] {
  const out: TcpJobCode[] = [];
  for (const r of rows) {
    const m = /^(\d+)-(.+)$/.exec(cell(r, 0));
    if (m) out.push({ number: m[1]!, description: m[2]!.trim() });
  }
  return out;
}

export type TcpJobAssignment = { number: string; jobCode: string; primary: boolean };

/** Employee Job Codes: Number | Name | Job Code | Description (number blank on repeats). */
export function parseEmployeeJobCodes(rows: SheetRow[]): TcpJobAssignment[] {
  const out: TcpJobAssignment[] = [];
  let number = "";
  for (const r of rows) {
    if (/^\d+$/.test(cell(r, 0)) && cell(r, 1)) number = cell(r, 0);
    const m = /^(\d+)(\*?)$/.exec(cell(r, 2));
    if (number && m) out.push({ number, jobCode: m[1]!, primary: m[2] === "*" });
  }
  return out;
}

// ── PTO / accrual banks ─────────────────────────────────────────────────────

export type TcpAccrualRule = {
  number: string;
  bankId: number;
  bank: string;
  ruleId: number;
  rule: string;
};

export function parseAccrualRules(rows: SheetRow[]): TcpAccrualRule[] {
  const out: TcpAccrualRule[] = [];
  let number = "";
  let bankId = 0;
  let bank = "";
  for (const r of rows) {
    if (/^\d+$/.test(cell(r, 0)) && cell(r, 1)) {
      number = cell(r, 0);
      bankId = Number(cell(r, 3));
      bank = cell(r, 4);
    }
    if (number && /^\d+$/.test(cell(r, 5)) && cell(r, 6)) {
      out.push({ number, bankId, bank, ruleId: Number(cell(r, 5)), rule: cell(r, 6) });
    }
  }
  return out;
}

export type TcpAccrualRow = {
  number: string;
  name: string;
  bankId: number;
  /** null for the "Before 1/1/2006" opening row */
  date: Date | null;
  dateExpired: Date | null;
  accrued: number;
  expired: number;
  taken: number;
  adjustments: number;
  remaining: number | null;
};

export function parseAccrualUsage(rows: SheetRow[]): TcpAccrualRow[] {
  const out: TcpAccrualRow[] = [];
  let number = "";
  let name = "";
  let bankId = 0;
  for (const r of rows) {
    const emp = /^Employee:\s*(.*?)\s+Number:\s*(\d+)/.exec(cell(r, 0).replace(/\s+/g, " "));
    if (emp) {
      name = emp[1]!;
      number = emp[2]!;
      continue;
    }
    const bank = /^Accrual Bank:\s*(\d+)/.exec(cell(r, 0));
    if (bank) {
      bankId = Number(bank[1]);
      continue;
    }
    if (!number) continue;
    const first = cell(r, 0);
    const opening = /^Before /i.test(first);
    const date = opening ? null : dateOnly(first);
    if (!opening && !date) continue;
    const remaining = cell(r, 6);
    out.push({
      number,
      name,
      bankId,
      date,
      dateExpired: dateOnly(cell(r, 1)),
      accrued: parseDecimal(cell(r, 2)),
      expired: parseDecimal(cell(r, 3)),
      taken: parseDecimal(cell(r, 4)),
      adjustments: parseDecimal(cell(r, 5)),
      remaining: remaining ? parseDecimal(remaining) : null,
    });
  }
  return out;
}

// ── Schedule Variance (scheduled shifts) ────────────────────────────────────

export type TcpScheduledShift = {
  number: string;
  /** Calendar day of the scheduled start, "YYYY-MM-DD" (business time). */
  date: string;
  /** "HH:MM" 24h, business time. */
  start: string;
  end: string;
};

function iso(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function hhmm(t: [number, number]) {
  return `${String(t[0]).padStart(2, "0")}:${String(t[1]).padStart(2, "0")}`;
}

/**
 * Schedule Variance rows hold one scheduled In or Out each; pair them into
 * shifts. An Out with no In (or an In with no Out) is dropped.
 */
export function parseScheduledShifts(rows: SheetRow[]): TcpScheduledShift[] {
  const out: TcpScheduledShift[] = [];
  let number = "";
  let open: { date: [number, number, number]; time: [number, number] } | null = null;
  for (const r of rows) {
    if (/^\d+$/.test(cell(r, 0)) && cell(r, 1)) {
      number = cell(r, 0);
      open = null;
    }
    const op = cell(r, 3);
    if (!number || (op !== "In" && op !== "Out")) continue;
    const [d, ...t] = cell(r, 4).split(" ");
    const date = parseUsDate(d ?? "");
    const time = parseUsTime(t.join(" "));
    if (!date || !time) continue;
    if (op === "In") {
      open = { date, time };
    } else if (open) {
      const sameDay = open.date.join("-") === date.join("-");
      const next = new Date(Date.UTC(open.date[0], open.date[1] - 1, open.date[2] + 1));
      const overnight =
        date[0] === next.getUTCFullYear() && date[1] === next.getUTCMonth() + 1 && date[2] === next.getUTCDate();
      if (sameDay || overnight) {
        out.push({
          number,
          date: iso(open.date[0], open.date[1], open.date[2]),
          start: hhmm(open.time),
          end: hhmm(time),
        });
      }
      open = null;
    }
  }
  return out;
}

export type WeeklyPattern = {
  /** 0 = Sunday … 6 = Saturday */
  days: Record<number, { start: string; end: string; weeks: number }>;
};

/**
 * The usual week: for each weekday, the most common (start, end) seen in the
 * window, kept only if it appeared in at least `minWeeks` different weeks.
 */
export function usualWeek(
  shifts: readonly TcpScheduledShift[],
  from: string,
  to: string,
  minWeeks = 3,
): WeeklyPattern {
  const byDay = new Map<number, Map<string, Set<string>>>();
  for (const s of shifts) {
    if (s.date < from || s.date > to) continue;
    const [y, m, d] = s.date.split("-").map(Number) as [number, number, number];
    const dt = new Date(Date.UTC(y, m - 1, d));
    const dow = dt.getUTCDay();
    const monday = new Date(dt.getTime() - ((dow + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
    const key = `${s.start}-${s.end}`;
    const forDay = byDay.get(dow) ?? new Map<string, Set<string>>();
    const weeks = forDay.get(key) ?? new Set<string>();
    weeks.add(monday);
    forDay.set(key, weeks);
    byDay.set(dow, forDay);
  }
  const days: WeeklyPattern["days"] = {};
  for (const [dow, forDay] of byDay) {
    const best = [...forDay.entries()].sort((a, b) => b[1].size - a[1].size || (a[0] < b[0] ? 1 : -1))[0]!;
    if (best[1].size >= minWeeks) {
      const [start, end] = best[0].split("-") as [string, string];
      days[dow] = { start, end, weeks: best[1].size };
    }
  }
  return { days };
}
