/** node --conditions=react-server --import tsx scripts/encrypt-employee-private-data.ts [--apply|--verify] */
import { Prisma, PrismaClient, type Employee } from "@prisma/client";
import { employeePrivateSelect, EMPLOYEE_PRIVATE_FIELDS } from "../src/server/employee-private-data";
import { migrateEmployeePrivateRow, type EmployeePrivateMigrationOutcome } from "../src/server/employee-private-migration";

async function main() {
  const flags = process.argv.slice(2);
  if (flags.length > 1 || flags.some(flag => flag !== "--apply" && flag !== "--verify")) throw new Error("Invalid flags");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const mode = flags[0] === "--apply" ? "apply" : flags[0] === "--verify" ? "verify" : "dry-run";
  const db = new PrismaClient({ log: [] });
  const counts: Record<EmployeePrivateMigrationOutcome, number> = { empty: 0, legacy: 0, verified: 0, updated: 0, conflict: 0, failed: 0 };
  let cursor: string | undefined;
  try {
    for (;;) {
      const rows: Pick<Employee, "id" | "privateDetails" | "updatedAt" | (typeof EMPLOYEE_PRIVATE_FIELDS)[number]>[] = await db.employee.findMany({
        select: { ...employeePrivateSelect, updatedAt: true },
        where: cursor ? { id: { gt: cursor } } : {}, orderBy: { id: "asc" }, take: 100,
      });
      if (!rows.length) break;
      for (const row of rows) {
        const outcome = await migrateEmployeePrivateRow({
          row, mode,
          compareAndSwap: async write => {
            const legacyExpected = Object.fromEntries(EMPLOYEE_PRIVATE_FIELDS.map(field => [field, row[field]]));
            const where: Prisma.EmployeeWhereInput = {
              id: row.id, updatedAt: row.updatedAt, ...legacyExpected,
              privateDetails: { equals: row.privateDetails === null ? Prisma.DbNull : row.privateDetails as Prisma.InputJsonValue },
            };
            const changed = await db.employee.updateMany({ where, data: write });
            return changed.count === 1;
          },
          readBack: () => db.employee.findUnique({ where: { id: row.id }, select: employeePrivateSelect }),
        });
        counts[outcome]++;
      }
      cursor = rows.at(-1)!.id;
    }
    console.log(JSON.stringify({ mode, counts, note: mode === "dry-run" ? "Format inventory only; --verify authenticates ciphertext." : undefined }));
    if (counts.failed || counts.conflict) process.exitCode = 1;
  } finally { await db.$disconnect(); }
}
main().catch(() => {
  console.error("Employee encryption migration failed. No employee values were logged.");
  process.exitCode = 1;
});
