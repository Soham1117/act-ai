/**
 * One-shot: overwrite stored SSN last-4 with paystub values for known conflicts.
 * Leaves employees not on the stub list unchanged.
 *
 * node --conditions=react-server --import tsx scripts/fix-stub-ssn-conflicts.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import { employeePrivateSelect, prepareEmployeePrivateUpdate } from "../src/server/employee-private-data";

const FIXES: Array<{ name: string; ssnLast4: string }> = [
  { name: "Alexandro Torres", ssnLast4: "4802" },
  { name: "Buddy L Allison", ssnLast4: "4703" },
  { name: "Dee Anna L Tapia", ssnLast4: "6645" },
  { name: "Alejandro A Vazquez", ssnLast4: "8221" },
  { name: "Tapan J Sinha", ssnLast4: "1005" },
];

async function main() {
  const apply = process.argv.includes("--apply");
  const db = new PrismaClient({ log: [] });
  const report: Array<Record<string, unknown>> = [];
  try {
    for (const fix of FIXES) {
      const stored = await db.employee.findFirst({
        where: { name: fix.name },
        select: { ...employeePrivateSelect, name: true, employeeId: true, updatedAt: true },
      });
      if (!stored) {
        report.push({ name: fix.name, status: "missing" });
        continue;
      }
      if (!apply) {
        report.push({
          name: fix.name, employeeId: stored.employeeId, status: "dry-run",
          wouldSet: fix.ssnLast4,
        });
        continue;
      }
      const privateWrite = await prepareEmployeePrivateUpdate(stored, { ssnLast4: fix.ssnLast4 });
      const changed = await db.employee.updateMany({
        where: { id: stored.id, updatedAt: stored.updatedAt },
        data: privateWrite,
      });
      report.push({
        name: fix.name,
        employeeId: stored.employeeId,
        status: changed.count === 1 ? "updated" : "conflict",
        ssnLast4: fix.ssnLast4,
      });
    }
    console.log(JSON.stringify({ apply, report }, null, 2));
    if (report.some((row) => row.status === "conflict" || row.status === "missing")) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

main().catch(() => {
  console.error("SSN conflict fix failed. No values logged beyond the summary.");
  process.exitCode = 1;
});
