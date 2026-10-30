/**
 * Import Timeclock Plus XML report exports into Persona.
 *
 * Dry run is the default; pass --apply to write. Safe to re-run: imported rows
 * carry a stable importKey and existing values are only filled, never replaced.
 *
 *   pnpm exec tsx --env-file=.env.local scripts/import-tcp-xml.ts \
 *     --dir "<exports folder>" [--map tcp-employee-map.json] \
 *     [--create-missing] [--assignments] [--apply]
 *
 * --map              JSON { "<TCP number>": "<Persona employeeId>" | "skip" } for names
 *                    that do not match automatically ("skip" holds a person back).
 * --create-missing   Create TERMINATED, login-less employees for TCP people who
 *                    are not in Persona (so their history is kept).
 * --assignments      Also copy TCP job-code assignments (changes what staff can
 *                    pick at the kiosk, so leave off until cutover).
 *
 * Never touched: SSNs (the exports contain full SSNs; they are ignored),
 * Persona's own exportCode, existing departments/locations, passwords.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  readSheetRows,
  parseWeeklyPunch,
  parseRoster,
  parseJobCodeSummary,
  parseEmployeeJobCodes,
  parseAccrualRules,
  parseAccrualUsage,
  nameKey,
  dateOnly,
} from "../src/lib/tcp-xml";
import { generateEmployeeId } from "../src/lib/employee-create";

const db = new PrismaClient();
const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (n: string) => process.argv.includes(`--${n}`);
const apply = has("apply");
const dir = arg("dir");
if (!dir) throw new Error("--dir is required");

const files = readdirSync(dir).filter((f) => f.endsWith(".xml") && !/\(\d\)\.xml$/.test(f));
const find = (prefix: string) => files.filter((f) => f.startsWith(prefix)).sort();
const load = (f: string) => readSheetRows(join(dir, f));
const BANKS: Record<number, string> = { 1: "PTO" };

const DEPT_MAP: Record<string, string> = {
  ADMIN: "Management",
  "INSIDE SALES": "Sales",
  "OUTSIDE SALES": "Sales",
  ASSEMBLEY: "Assembly",
  ASSEMBLY: "Assembly",
  "WELL SERVICES DIVISION": "Well Services Division",
};

const chunk = <T,>(a: T[], n: number) =>
  Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const money = (n: number) => new Prisma.Decimal(n.toFixed(4));
const EMP_SELECT = {
  id: true,
  employeeId: true,
  name: true,
  tcpNumber: true,
  tcpExportCode: true,
  workLocation: true,
  departmentId: true,
  employmentStatus: true,
} as const;
type Emp = Prisma.EmployeeGetPayload<{ select: typeof EMP_SELECT }>;

async function main() {
  const report: Record<string, unknown> = { apply };

  // ── roster ────────────────────────────────────────────────────────────────
  const roster = new Map<string, ReturnType<typeof parseRoster>[number]>();
  for (const f of find("Complete Payroll")) {
    for (const e of parseRoster(load(f))) {
      const prev = roster.get(e.number);
      roster.set(e.number, {
        ...prev,
        ...Object.fromEntries(Object.entries(e).filter(([, v]) => v)),
      } as typeof e);
    }
  }

  const overrides: Record<string, string> = arg("map")
    ? JSON.parse(readFileSync(arg("map")!, "utf8"))
    : {};
  const employees: Emp[] = await db.employee.findMany({ select: EMP_SELECT });
  const byKey = new Map<string, Emp[]>();
  for (const e of employees) byKey.set(nameKey(e.name), [...(byKey.get(nameKey(e.name)) ?? []), e]);
  const byEmployeeId = new Map(employees.map((e) => [e.employeeId, e]));
  const byTcp = new Map(employees.filter((e) => e.tcpNumber).map((e) => [e.tcpNumber!, e]));

  const personaFor = new Map<string, Emp>();
  const unmatched: string[] = [];
  const ambiguous: string[] = [];
  for (const t of roster.values()) {
    if (overrides[t.number] === "skip") continue;
    const forced = overrides[t.number] ? byEmployeeId.get(overrides[t.number]!) : undefined;
    if (overrides[t.number] && !forced) {
      throw new Error(`Map: ${overrides[t.number]} is not a Persona employeeId`);
    }
    const hit = forced ?? byTcp.get(t.number);
    if (hit) {
      personaFor.set(t.number, hit);
      continue;
    }
    const hits = byKey.get(nameKey(t.name)) ?? [];
    if (hits.length === 1) personaFor.set(t.number, hits[0]!);
    else if (hits.length > 1) ambiguous.push(`${t.number} ${t.name}`);
    else unmatched.push(`${t.number} ${t.name}`);
  }
  const claimed = new Map<string, string>();
  for (const [num, e] of personaFor) {
    if (claimed.has(e.id)) {
      throw new Error(`TCP ${claimed.get(e.id)} and ${num} both map to ${e.employeeId}; fix with --map`);
    }
    claimed.set(e.id, num);
  }
  report.roster = { tcp: roster.size, matched: personaFor.size, unmatched, ambiguous };

  // ── optionally create former employees ───────────────────────────────────
  const created: string[] = [];
  if (has("create-missing") && apply) {
    for (const line of unmatched) {
      const num = line.split(" ")[0]!;
      const t = roster.get(num)!;
      const emp = await db.$transaction(async (tx) => {
        const employeeId = await generateEmployeeId(tx);
        const user = await tx.user.create({ data: { name: t.name, role: "EMPLOYEE" } });
        return tx.employee.create({
          data: {
            employeeId,
            userId: user.id,
            name: t.name,
            gender: "OTHER",
            compensationType: "HOURLY_RATE",
            employmentStatus: "TERMINATED",
            terminationReason: "Imported from Timeclock Plus (former employee)",
          },
          select: EMP_SELECT,
        });
      });
      personaFor.set(num, emp);
      created.push(emp.employeeId);
    }
  }
  report.formerEmployeesCreated = has("create-missing") ? (apply ? created.length : unmatched.length) : 0;

  // ── employee fields (fill only) ──────────────────────────────────────────
  const depts = await db.department.findMany();
  const deptByName = new Map(depts.map((d) => [d.name.toLowerCase(), d.id]));
  let deptFilled = 0;
  let locFilled = 0;
  let tcpSet = 0;
  const missingDepts = new Set<string>();
  for (const [num, e] of personaFor) {
    const t = roster.get(num)!;
    const data: Prisma.EmployeeUpdateInput = {};
    if (e.tcpNumber !== num) {
      data.tcpNumber = num;
      tcpSet += 1;
    }
    if (t.exportCode && !e.tcpExportCode) data.tcpExportCode = t.exportCode;
    if (t.location && !e.workLocation) {
      data.workLocation = t.location;
      locFilled += 1;
    }
    if (t.department && !e.departmentId) {
      const name = DEPT_MAP[t.department.toUpperCase()] ?? t.department;
      const id = deptByName.get(name.toLowerCase());
      if (id) {
        data.department = { connect: { id } };
        deptFilled += 1;
      } else missingDepts.add(t.department);
    }
    if (apply && Object.keys(data).length) await db.employee.update({ where: { id: e.id }, data });
  }
  report.employees = {
    tcpNumberSet: tcpSet,
    locationFilled: locFilled,
    departmentFilled: deptFilled,
    departmentsNotFound: [...missingDepts],
  };

  // ── job codes ────────────────────────────────────────────────────────────
  const jobCodes = parseJobCodeSummary(load(find("Job Code Analysis Summary")[0]!));
  const existingCodes = new Set((await db.jobCode.findMany({ select: { code: true } })).map((j) => j.code));
  const newCodes = jobCodes.filter((j) => !existingCodes.has(j.number));
  if (apply) {
    for (const j of newCodes) {
      await db.jobCode.create({ data: { code: j.number, title: j.description, rate: "NA", isActive: true } });
    }
  }
  report.jobCodes = { inTcp: jobCodes.length, created: newCodes.length };

  if (has("assignments")) {
    const codeIds = new Map((await db.jobCode.findMany({ select: { id: true, code: true } })).map((j) => [j.code, j.id]));
    const asg = parseEmployeeJobCodes(load(find("Employee Job Codes")[0]!));
    const rows: Prisma.JobCodeAssignmentCreateManyInput[] = [];
    for (const a of asg) {
      const e = personaFor.get(a.number);
      const jobCodeId = codeIds.get(a.jobCode);
      if (e && jobCodeId) rows.push({ jobCodeId, employeeId: e.id, isPrimary: a.primary });
    }
    if (apply) await db.jobCodeAssignment.createMany({ data: rows, skipDuplicates: true });
    report.assignments = rows.length;
  }

  // ── punches ──────────────────────────────────────────────────────────────
  const { punches } = parseWeeklyPunch(load(find("Weekly Punch").at(-1)!));
  const open = punches.filter((p) => p.open);
  const usable = punches.filter((p) => !p.open && p.clockOut);
  const noEmployee = new Set<string>();
  const existingByEmp = new Map<string, Array<[number, number]>>();
  const existing = await db.timeEntry.findMany({
    where: { source: { not: "TCP" } },
    select: { employeeId: true, clockIn: true, clockOut: true },
  });
  for (const e of existing) {
    const list = existingByEmp.get(e.employeeId) ?? [];
    list.push([e.clockIn.getTime(), (e.clockOut ?? new Date(e.clockIn.getTime() + 12 * 3600_000)).getTime()]);
    existingByEmp.set(e.employeeId, list);
  }
  const rows: Prisma.TimeEntryCreateManyInput[] = [];
  let overlapsPersona = 0;
  for (const p of usable) {
    const e = personaFor.get(p.number);
    if (!e) {
      noEmployee.add(`${p.number} ${p.name}`);
      continue;
    }
    const s = p.clockIn.getTime();
    const en = p.clockOut!.getTime();
    if ((existingByEmp.get(e.id) ?? []).some(([a, b]) => s < b && en > a)) {
      overlapsPersona += 1;
      continue;
    }
    const span = Math.round((en - s) / 60_000);
    const day = dateOnly(p.clockIn.toLocaleDateString("en-US", { timeZone: "America/Chicago" }))!;
    rows.push({
      employeeId: e.id,
      date: day,
      clockIn: p.clockIn,
      clockOut: p.clockOut,
      totalWorkMin: p.minutes,
      totalBreakMin: Math.max(0, span - p.minutes),
      status: p.unapprovedMissedPunch ? "PENDING_APPROVAL" : "APPROVED",
      approvalStatus: p.unapprovedMissedPunch ? "PENDING" : "APPROVED",
      approvalNotes: p.unapprovedMissedPunch
        ? "Imported from Timeclock Plus: unapproved missed punch"
        : "Imported from Timeclock Plus",
      jobCode: p.jobCode,
      source: "TCP",
      importKey: `tcp:${p.number}:${p.clockIn.toISOString()}:${p.jobCode}`,
      actualClockIn: p.actualIn,
      actualClockOut: p.actualOut,
      manualHours: p.manual,
    });
  }
  let written = 0;
  if (apply) {
    for (const part of chunk(rows, 1000)) {
      written += (await db.timeEntry.createMany({ data: part, skipDuplicates: true })).count;
    }
  }
  report.punches = {
    inFile: punches.length,
    toImport: rows.length,
    written: apply ? written : undefined,
    skippedOpenNoClockOut: open.length,
    skippedOverlapsExistingPersonaEntry: overlapsPersona,
    skippedEmployeeNotInPersona: [...noEmployee],
  };
  writeFileSync(
    "tcp-import-open-punches.csv",
    "tcp_number,name,clock_in,job_code\n" +
      open.map((p) => `${p.number},"${p.name}",${p.clockIn.toISOString()},${p.jobCode}`).join("\n"),
  );

  // ── PTO banks ────────────────────────────────────────────────────────────
  const ruleRows = parseAccrualRules(load(find("Employee Accrual Bank")[0]!));
  const rules: Prisma.EmployeeAccrualRuleCreateManyInput[] = [];
  for (const r of ruleRows) {
    const e = personaFor.get(r.number);
    if (e) rules.push({ employeeId: e.id, bank: BANKS[r.bankId] ?? r.bank, ruleId: r.ruleId, ruleDescription: r.rule });
  }
  const usage = parseAccrualUsage(load(find("Accrual Usage")[0]!));
  const ledger: Prisma.AccrualLedgerEntryCreateManyInput[] = [];
  const seen = new Map<string, number>();
  for (const u of usage) {
    const e = personaFor.get(u.number);
    if (!e) continue;
    const base = `tcp:${u.number}:${u.bankId}:${u.date?.toISOString().slice(0, 10) ?? "opening"}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    ledger.push({
      employeeId: e.id,
      bank: BANKS[u.bankId] ?? `Bank ${u.bankId}`,
      date: u.date,
      dateExpired: u.dateExpired,
      accrued: money(u.accrued),
      expired: money(u.expired),
      taken: money(u.taken),
      adjustments: money(u.adjustments),
      remaining: u.remaining === null ? null : money(u.remaining),
      importKey: `${base}:${n}`,
    });
  }
  if (apply) {
    await db.employeeAccrualRule.createMany({ data: rules, skipDuplicates: true });
    for (const part of chunk(ledger, 1000)) {
      await db.accrualLedgerEntry.createMany({ data: part, skipDuplicates: true });
    }
  }
  report.pto = {
    rules: rules.length,
    ledgerRows: ledger.length,
    employees: new Set(ledger.map((l) => l.employeeId)).size,
  };

  console.log(JSON.stringify(report, null, 2));
  if (!apply) console.log("\nDry run: nothing written. Add --apply to write.");
}

main().finally(() => db.$disconnect());
