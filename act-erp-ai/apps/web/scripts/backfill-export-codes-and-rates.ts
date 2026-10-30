/**
 * Phase 0 cutover: fill Employee.exportCode and stamp TimeEntry.rate.
 *
 * Dry-run default. Pass --apply to write.
 *
 *   pnpm exec tsx scripts/backfill-export-codes-and-rates.ts [--apply]
 */
import { Prisma, PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const apply = process.argv.includes("--apply");

function exportCodeFromEmployeeId(employeeId: string): string {
  const digits = employeeId.replace(/\D/g, "");
  if (digits) return `ACT${digits}`;
  return `ACT-${employeeId.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase()}`;
}

async function main() {
  const employees = await db.employee.findMany({
    where: { employmentStatus: "ACTIVE" },
    select: {
      id: true,
      name: true,
      employeeId: true,
      exportCode: true,
      defaultHourlyRate: true,
    },
    orderBy: { name: "asc" },
  });

  const missingExport = employees.filter((e) => !e.exportCode?.trim());
  const nullRateCount = await db.timeEntry.count({ where: { rate: null } });

  console.log(
    JSON.stringify(
      {
        apply,
        activeEmployees: employees.length,
        missingExportCode: missingExport.length,
        timeEntriesMissingRate: nullRateCount,
        sampleMissingExport: missingExport.slice(0, 5).map((e) => ({
          name: e.name,
          employeeId: e.employeeId,
          proposed: exportCodeFromEmployeeId(e.employeeId),
        })),
      },
      null,
      2,
    ),
  );

  if (!apply) {
    console.log("Dry-run only. Re-run with --apply to write.");
    return;
  }

  let exportWritten = 0;
  for (const e of missingExport) {
    await db.employee.update({
      where: { id: e.id },
      data: { exportCode: exportCodeFromEmployeeId(e.employeeId) },
    });
    exportWritten += 1;
  }

  // Stamp null rates from employee defaultHourlyRate (batch via raw SQL for speed).
  const rateResult = await db.$executeRaw`
    UPDATE "TimeEntry" te
    SET rate = e."defaultHourlyRate"
    FROM "Employee" e
    WHERE te."employeeId" = e.id
      AND te.rate IS NULL
  `;

  console.log(
    JSON.stringify(
      { exportWritten, ratesStamped: Number(rateResult), done: true },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
