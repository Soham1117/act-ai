/**
 * Count-only inventory: employees missing SSN last-4 vs paystub pages that
 * could fill them. No writes. Prints last-4 only.
 *
 * node --conditions=react-server --import tsx scripts/ssn-backfill-scan.ts \
 *   --paystubs /data/paystubs.pdf
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { analyzePaystubPdf } from "../src/lib/paystub-parser";
import { matchEmployee } from "../src/lib/paystub-match";
import { employeePrivateSelect, readEmployeePrivateDetails } from "../src/server/employee-private-data";

function arg(name: string) {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`Missing ${name}`);
  return process.argv[i + 1]!;
}

async function main() {
  const paystubsPath = arg("--paystubs");
  const db = new PrismaClient({ log: [] });
  try {
    const stored = await db.employee.findMany({
      where: { employmentStatus: { not: "PENDING_REVIEW" } },
      select: { ...employeePrivateSelect, name: true, employeeId: true, employmentStatus: true },
      orderBy: { id: "asc" },
    });

    const roster: Array<{ id: string; name: string; ssnLast4: string | null; employmentStatus: string }> = [];
    const missing: Array<{ id: string; employeeId: string; name: string }> = [];
    for (const row of stored) {
      const priv = await readEmployeePrivateDetails(row);
      roster.push({
        id: row.id, name: row.name, ssnLast4: priv.ssnLast4, employmentStatus: row.employmentStatus,
      });
      if (!priv.ssnLast4) missing.push({ id: row.id, employeeId: row.employeeId, name: row.name });
    }

    const bytes = readFileSync(paystubsPath);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const analyzed = await analyzePaystubPdf(ab);

    const fills: Array<{
      id: string; employeeId: string; name: string; ssnLast4: string; page: number; confidence: string;
    }> = [];
    const conflicts: Array<{ name: string; page: number; reason: string }> = [];
    const filledIds = new Set<string>();

    for (const page of analyzed.pages) {
      if (page.status !== "SUPPORTED" || !page.parsed?.ssnLast4) continue;
      const match = matchEmployee(page.parsed, roster);
      if (!match.employeeId) {
        conflicts.push({
          name: page.parsed.employeeName ?? "?",
          page: page.pageNumber,
          reason: match.reason ?? "no match",
        });
        continue;
      }
      const emp = roster.find((row) => row.id === match.employeeId)!;
      const biz = stored.find((row) => row.id === emp.id)!;
      if (emp.ssnLast4) {
        if (emp.ssnLast4 !== page.parsed.ssnLast4) {
          conflicts.push({
            name: emp.name,
            page: page.pageNumber,
            reason: `stub ${page.parsed.ssnLast4} != stored ${emp.ssnLast4}`,
          });
        }
        continue;
      }
      if (filledIds.has(emp.id)) continue;
      filledIds.add(emp.id);
      fills.push({
        id: emp.id,
        employeeId: biz.employeeId,
        name: emp.name,
        ssnLast4: page.parsed.ssnLast4,
        page: page.pageNumber,
        confidence: match.confidence,
      });
    }

    const stillMissing = missing.filter((row) => !filledIds.has(row.id));

    console.log(JSON.stringify({
      roster: stored.length,
      missingSsn: missing.length,
      fillableFromPaystubs: fills.length,
      fills,
      stillMissingAfterFill: stillMissing.length,
      stillMissingSample: stillMissing.slice(0, 40),
      stubConflictCount: conflicts.length,
      stubConflictSample: conflicts.slice(0, 20),
      sourceSha256: createHash("sha256").update(bytes).digest("hex"),
    }, null, 2));
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("SSN backfill scan failed.", error instanceof Error ? error.message : "unknown");
  process.exitCode = 1;
});
