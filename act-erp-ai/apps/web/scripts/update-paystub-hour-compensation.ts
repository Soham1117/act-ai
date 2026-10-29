/**
 * Set Employee hour compensation from paystub Rate / Salary lines.
 *
 * Dry-run by default. Pass --apply to write.
 *
 *   pnpm exec tsx scripts/update-paystub-hour-compensation.ts \
 *     --paystubs "/path/Paystubs 10-29-2026.pdf" \
 *     [--apply]
 *
 * Hourly stubs → compensationType HOURLY_RATE, defaultHourlyRate + compensationValue = rate.
 * Salary stubs → compensationType TOTAL_COMPENSATION, compensationValue = period × 26 (annual).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { matchEmployee, type EmployeeCandidate } from "../src/lib/paystub-match";
import type { ParsedPaystub } from "../src/lib/paystub-parser";

const db = new PrismaClient();

const HOURLY_RE =
  /(\d{5}\s+.*?\bHourly(?:\s+OT)?)\s+(\d{1,3}:\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/i;
const SALARY_RE = /(\d{5}\s+.*?\bSalary)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/i;
const SSN_RE = /\*\*\*-\*\*-(\d{4})/;
const BIWEEKLY_PERIODS_PER_YEAR = 26;

type CompKind = "HOURLY" | "SALARY";
type Extracted = {
  page: number;
  name: string | null;
  ssnLast4: string | null;
  kind: CompKind;
  rateOrPeriod: number;
  annualIfSalary: number | null;
  desc: string;
};

type PlanRow = {
  page: number;
  stubName: string | null;
  employeeId: string | null;
  employeeName: string | null;
  matchConfidence: string;
  matchReason: string;
  kind: CompKind | null;
  desc: string | null;
  from: {
    compensationType: string;
    compensationValue: string | null;
    defaultHourlyRate: string;
  } | null;
  to: {
    compensationType: "HOURLY_RATE" | "TOTAL_COMPENSATION";
    compensationValue: number;
    defaultHourlyRate: number | null;
  } | null;
  action: "update" | "skip_unchanged" | "skip_unmatched" | "skip_no_rate";
};

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

function money(n: Prisma.Decimal | number | null | undefined): string | null {
  if (n == null) return null;
  return Number(n.toString()).toFixed(2);
}

function extractRows(items: TextItem[]): string[] {
  const buckets = new Map<number, { x: number; str: string }[]>();
  for (const item of items) {
    const str = item.str?.trim();
    if (!str) continue;
    const y = Math.round(item.transform[5] / 3) * 3;
    const parts = buckets.get(y) ?? [];
    parts.push({ x: item.transform[4], str });
    buckets.set(y, parts);
  }
  return [...buckets.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, parts]) =>
      parts
        .sort((a, b) => a.x - b.x)
        .map((p) => p.str)
        .join(" "),
    );
}

function isJunkHourlyDesc(desc: string): boolean {
  return /\bOT\b|overtime|vacation|holiday|sick|pto|bereavement|jury/i.test(desc);
}

function scoreHourly(desc: string, current: number): number {
  let score = current;
  if (/mfg direct\s*-\s*hourly$/i.test(desc) || /admin hourly$/i.test(desc)) score += 100_000;
  if (/hour/i.test(desc) && !isJunkHourlyDesc(desc)) score += 10_000;
  return score;
}

function pickCompensation(rows: string[]): {
  kind: CompKind;
  rateOrPeriod: number;
  desc: string;
} | null {
  const hourly: Array<{ desc: string; rate: number; current: number; score: number }> = [];
  for (const row of rows) {
    const m = HOURLY_RE.exec(row);
    if (!m) continue;
    const desc = m[1].trim();
    if (isJunkHourlyDesc(desc)) continue;
    const rate = Number(m[3].replace(/,/g, ""));
    const current = Number(m[4].replace(/,/g, ""));
    if (!(rate > 0) || !(current >= 0)) continue;
    hourly.push({ desc, rate, current, score: scoreHourly(desc, current) });
  }
  hourly.sort((a, b) => b.score - a.score);
  if (hourly[0]) {
    return { kind: "HOURLY", rateOrPeriod: hourly[0].rate, desc: hourly[0].desc };
  }

  for (const row of rows) {
    const m = SALARY_RE.exec(row);
    if (!m) continue;
    const desc = m[1].trim();
    const period = Number(m[2].replace(/,/g, ""));
    if (!(period > 0)) continue;
    return { kind: "SALARY", rateOrPeriod: period, desc };
  }
  return null;
}

function identityFromRows(rows: string[]): { name: string | null; ssnLast4: string | null } {
  const fullText = rows.join("\n");
  const ssn = SSN_RE.exec(fullText);
  const identityRow = ssn ? rows.find((row) => row.includes(ssn[0])) : undefined;
  const name = identityRow?.split(",")[0]?.replace(SSN_RE, "").trim() ?? null;
  const employeeName =
    name &&
    name.length <= 160 &&
    /^[\p{L}\p{M} .,'’-]+$/u.test(name) &&
    name.split(/\s+/).filter((token) => /\p{L}/u.test(token)).length >= 2
      ? name
      : null;
  return { name: employeeName, ssnLast4: ssn?.[1] ?? null };
}

async function extractFromPdf(path: string): Promise<Extracted[]> {
  const bytes = new Uint8Array(readFileSync(path));
  const doc = await getDocument({ data: bytes, useSystemFonts: true }).promise;
  const out: Extracted[] = [];
  for (let page = 1; page <= doc.numPages; page++) {
    const content = await (await doc.getPage(page)).getTextContent();
    const rows = extractRows(content.items.filter((x): x is TextItem => "str" in x));
    const id = identityFromRows(rows);
    const picked = pickCompensation(rows);
    if (!picked) {
      out.push({
        page,
        name: id.name,
        ssnLast4: id.ssnLast4,
        kind: "HOURLY",
        rateOrPeriod: 0,
        annualIfSalary: null,
        desc: "NO_RATE",
      });
      continue;
    }
    out.push({
      page,
      name: id.name,
      ssnLast4: id.ssnLast4,
      kind: picked.kind,
      rateOrPeriod: picked.rateOrPeriod,
      annualIfSalary:
        picked.kind === "SALARY"
          ? Math.round(picked.rateOrPeriod * BIWEEKLY_PERIODS_PER_YEAR)
          : null,
      desc: picked.desc,
    });
  }
  return out;
}

async function main() {
  const paystubsPath = arg("--paystubs");
  if (!paystubsPath) {
    console.error("Required: --paystubs /path/to.pdf");
    process.exit(2);
  }
  const apply = process.argv.includes("--apply");
  const outPath = arg("--out") ?? resolve(`paystub-comp-${apply ? "apply" : "dry-run"}.json`);

  const extracted = await extractFromPdf(paystubsPath);
  const roster = await db.employee.findMany({
    select: {
      id: true,
      name: true,
      ssnLast4: true,
      employmentStatus: true,
      compensationType: true,
      compensationValue: true,
      defaultHourlyRate: true,
    },
  });
  // Prefer ACTIVE for rate sync — inactive duplicates (e.g. Jose Gonzalez) break name match.
  const matchRoster: EmployeeCandidate[] = roster
    .filter((e) => e.employmentStatus === "ACTIVE")
    .map((e) => ({ id: e.id, name: e.name, ssnLast4: e.ssnLast4 }));

  const plan: PlanRow[] = [];
  const usedEmployeeIds = new Set<string>();

  for (const stub of extracted) {
    if (!stub.rateOrPeriod || stub.desc === "NO_RATE") {
      plan.push({
        page: stub.page,
        stubName: stub.name,
        employeeId: null,
        employeeName: null,
        matchConfidence: "none",
        matchReason: "No hourly/salary rate line found on page.",
        kind: null,
        desc: null,
        from: null,
        to: null,
        action: "skip_no_rate",
      });
      continue;
    }

    const parsed: ParsedPaystub = {
      employeeName: stub.name,
      ssnLast4: stub.ssnLast4,
      payPeriodStart: null,
      payPeriodEnd: null,
      payDate: null,
      checkNumber: null,
      netPay: null,
    };
    const match = matchEmployee(parsed, matchRoster);
    const emp = match.employeeId ? roster.find((e) => e.id === match.employeeId) : null;

    if (!emp || match.confidence === "none" || match.confidence === "low") {
      plan.push({
        page: stub.page,
        stubName: stub.name,
        employeeId: emp?.id ?? null,
        employeeName: emp?.name ?? null,
        matchConfidence: match.confidence,
        matchReason: match.reason,
        kind: stub.kind,
        desc: stub.desc,
        from: null,
        to: null,
        action: "skip_unmatched",
      });
      continue;
    }

    if (usedEmployeeIds.has(emp.id)) {
      plan.push({
        page: stub.page,
        stubName: stub.name,
        employeeId: emp.id,
        employeeName: emp.name,
        matchConfidence: match.confidence,
        matchReason: "Duplicate stub page for same employee — skipped.",
        kind: stub.kind,
        desc: stub.desc,
        from: null,
        to: null,
        action: "skip_unchanged",
      });
      continue;
    }
    usedEmployeeIds.add(emp.id);

    const to =
      stub.kind === "HOURLY"
        ? {
            compensationType: "HOURLY_RATE" as const,
            compensationValue: stub.rateOrPeriod,
            defaultHourlyRate: stub.rateOrPeriod,
          }
        : {
            compensationType: "TOTAL_COMPENSATION" as const,
            compensationValue: stub.annualIfSalary!,
            defaultHourlyRate: null,
          };

    const from = {
      compensationType: emp.compensationType,
      compensationValue: money(emp.compensationValue),
      defaultHourlyRate: money(emp.defaultHourlyRate)!,
    };

    const sameType = from.compensationType === to.compensationType;
    const sameValue =
      Number(from.compensationValue ?? "NaN") === to.compensationValue ||
      (from.compensationValue == null && to.compensationValue == null);
    const sameRate =
      to.defaultHourlyRate == null
        ? true
        : Number(from.defaultHourlyRate) === to.defaultHourlyRate;

    const unchanged = sameType && sameValue && sameRate;
    plan.push({
      page: stub.page,
      stubName: stub.name,
      employeeId: emp.id,
      employeeName: emp.name,
      matchConfidence: match.confidence,
      matchReason: match.reason,
      kind: stub.kind,
      desc: stub.desc,
      from,
      to,
      action: unchanged ? "skip_unchanged" : "update",
    });
  }

  const summary = {
    pages: extracted.length,
    update: plan.filter((p) => p.action === "update").length,
    skip_unchanged: plan.filter((p) => p.action === "skip_unchanged").length,
    skip_unmatched: plan.filter((p) => p.action === "skip_unmatched").length,
    skip_no_rate: plan.filter((p) => p.action === "skip_no_rate").length,
    apply,
  };

  writeFileSync(outPath, JSON.stringify({ summary, plan }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`wrote ${outPath}`);

  if (!apply) {
    console.log("Dry-run only. Re-run with --apply to write.");
    return;
  }

  let written = 0;
  for (const row of plan) {
    if (row.action !== "update" || !row.employeeId || !row.to) continue;
    const data: Prisma.EmployeeUpdateInput = {
      compensationType: row.to.compensationType,
      compensationValue: new Prisma.Decimal(row.to.compensationValue.toFixed(2)),
    };
    if (row.to.defaultHourlyRate != null) {
      data.defaultHourlyRate = new Prisma.Decimal(row.to.defaultHourlyRate.toFixed(2));
    }
    await db.employee.update({ where: { id: row.employeeId }, data });
    await db.auditLog.create({
      data: {
        actorEmail: "system@paystub-comp-sync",
        action: "employee.compensation.paystub_sync",
        resource: `Employee:${row.employeeId}`,
        diff: { from: row.from, to: row.to, page: row.page, desc: row.desc },
      },
    });
    written += 1;
  }
  console.log(JSON.stringify({ written }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
