/**
 * Offline dry run for the TCP XML import: parses the report exports, matches
 * employees to a Persona roster JSON and prints what an import would do.
 * Touches no database.
 *
 *   pnpm exec tsx scripts/tcp-xml-report.ts --dir "<TCP exports>" \
 *     --roster persona-roster.json --entries persona-entries.json
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  readSheetRows,
  parseWeeklyPunch,
  parseRoster,
  parseJobCodeSummary,
  parseEmployeeJobCodes,
  parseAccrualRules,
  parseAccrualUsage,
  nameKey,
} from "../src/lib/tcp-xml";

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const dir = arg("dir")!;
const files = readdirSync(dir).filter((f) => f.endsWith(".xml") && !/\(\d\)\.xml$/.test(f));
const find = (prefix: string) => files.filter((f) => f.startsWith(prefix)).sort();
const load = (f: string) => readSheetRows(join(dir, f));

type Persona = { id: string; employeeId: string; name: string; exportCode: string | null; status: string; dept: string | null };
const persona: Persona[] = JSON.parse(readFileSync(arg("roster")!, "utf8"));
const entries: Array<{ employeeId: string; clockIn: string }> = JSON.parse(readFileSync(arg("entries")!, "utf8"));

// roster: every Complete Payroll file, richest (largest) last wins
const roster = new Map<string, ReturnType<typeof parseRoster>[number]>();
for (const f of find("Complete Payroll")) for (const e of parseRoster(load(f))) {
  const prev = roster.get(e.number);
  roster.set(e.number, { ...prev, ...Object.fromEntries(Object.entries(e).filter(([, v]) => v)) } as typeof e);
}
console.log(`TCP employees (from Complete Payroll headers): ${roster.size}`);

const byKey = new Map<string, Persona[]>();
for (const p of persona) byKey.set(nameKey(p.name), [...(byKey.get(nameKey(p.name)) ?? []), p]);
let matched = 0;
const ambiguous: string[] = [];
const unmatched: string[] = [];
const numToPersona = new Map<string, Persona>();
for (const e of roster.values()) {
  const hits = byKey.get(nameKey(e.name)) ?? [];
  if (hits.length === 1) { matched += 1; numToPersona.set(e.number, hits[0]!); }
  else if (hits.length > 1) ambiguous.push(`${e.number} ${e.name}`);
  else unmatched.push(`${e.number} ${e.name}`);
}
console.log(`matched to Persona by name: ${matched}, ambiguous: ${ambiguous.length}, not in Persona: ${unmatched.length}`);
console.log(`Persona employees with no TCP match: ${persona.length - new Set([...numToPersona.values()].map((p) => p.id)).size}`);
const depts = new Map<string, number>(), locs = new Map<string, number>();
for (const e of roster.values()) {
  depts.set(e.department ?? "(none)", (depts.get(e.department ?? "(none)") ?? 0) + 1);
  locs.set(e.location ?? "(none)", (locs.get(e.location ?? "(none)") ?? 0) + 1);
}
console.log("departments:", Object.fromEntries(depts));
console.log("locations:", Object.fromEntries(locs));

const wp = find("Weekly Punch").at(-1)!;
const { punches, skipped } = parseWeeklyPunch(load(wp));
const years = new Map<number, number>();
for (const p of punches) years.set(p.clockIn.getUTCFullYear(), (years.get(p.clockIn.getUTCFullYear()) ?? 0) + 1);
const existing = new Set(entries.map((e) => `${e.employeeId}|${new Date(e.clockIn).toISOString().slice(0, 16)}`));
let dup = 0;
for (const p of punches) {
  const pe = numToPersona.get(p.number);
  if (pe && existing.has(`${pe.employeeId}|${p.clockIn.toISOString().slice(0, 16)}`)) dup += 1;
}
console.log(`\npunches: ${punches.length} (skipped unreadable: ${skipped.length}), by year:`, Object.fromEntries(years));
console.log(`  open (no out): ${punches.filter((p) => p.open).length}, timesheet-entered (TS): ${punches.filter((p) => p.manual).length}, unapproved missed punch: ${punches.filter((p) => p.unapprovedMissedPunch).length}`);
console.log(`  distinct employees: ${new Set(punches.map((p) => p.number)).size}, already in Persona (same employee + minute): ${dup}`);
const jobs = new Map<string, number>();
for (const p of punches) jobs.set(p.jobCode, (jobs.get(p.jobCode) ?? 0) + 1);
console.log("  job codes used:", [...jobs.keys()].sort((a, b) => Number(a) - Number(b)).join(","));
const long = punches.filter((p) => p.clockOut && p.clockOut.getTime() - p.clockIn.getTime() > 20 * 3600_000);
console.log(`  shifts over 20h: ${long.length}; negative: ${punches.filter((p) => p.clockOut && p.clockOut < p.clockIn).length}`);
if (skipped.length) console.log("  skipped sample:", skipped.slice(0, 3));

const jc = parseJobCodeSummary(load(find("Job Code Analysis Summary")[0]!));
const asg = parseEmployeeJobCodes(load(find("Employee Job Codes")[0]!));
console.log(`\njob codes (summary): ${jc.length}; assignments: ${asg.length} for ${new Set(asg.map((a) => a.number)).size} employees`);
const unknown = [...jobs.keys()].filter((k) => !jc.some((j) => j.number === k));
console.log("  codes used in punches but not in summary:", unknown.join(",") || "none");

const rules = parseAccrualRules(load(find("Employee Accrual Bank")[0]!));
const usage = parseAccrualUsage(load(find("Accrual Usage")[0]!));
console.log(`\naccrual rules: ${rules.length} rows / ${new Set(rules.map((r) => r.number)).size} employees; usage rows: ${usage.length} / ${new Set(usage.map((u) => u.number)).size} employees`);
console.log("  banks:", [...new Set(rules.map((r) => `${r.bankId}:${r.bank}`))].join(", "), "| usage with remaining filled:", usage.filter((u) => u.remaining !== null).length);
console.log("  sample not-in-Persona:", unmatched.slice(0, 5).join("; "));
console.log("  ambiguous:", ambiguous.slice(0, 5).join("; "));
if (process.argv.includes("--list")) {
  console.log("\nNOT IN PERSONA:\n" + unmatched.join("\n"));
  console.log("\nAMBIGUOUS:\n" + ambiguous.join("\n"));
  const used = new Set([...numToPersona.values()].map((p) => p.id));
  console.log("\nPERSONA WITHOUT TCP MATCH:\n" + persona.filter((p) => !used.has(p.id)).map((p) => `${p.employeeId} ${p.name} [${p.status}]`).join("\n"));
}
