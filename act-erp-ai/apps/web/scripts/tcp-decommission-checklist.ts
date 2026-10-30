/**
 * Phase 6 — TCP decommission gate. Prints the cutover checklist and optionally
 * verifies Persona readiness (export codes, rates, no open dual-entry smells).
 *
 *   pnpm exec tsx --env-file=.env.local scripts/tcp-decommission-checklist.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const STEPS = [
  "Export final TCP Period Export + employee list into cold storage (S3/HR drive).",
  "Confirm Persona kiosks are the only punch source for 2 consecutive pay periods.",
  "Managers approve/edit hours only in /admin/hours (Individual / Group / Mass).",
  "Payroll file for the period comes from /admin/hours/period-export (not TCP).",
  "Dashboard widgets on /admin cover daily triage (approvals, OT, birthdays, PTO).",
  "Optional: import historical TCP CSVs via scripts/import-tcp-period-export.ts --apply.",
  "Disable TCP seats / cancel subscription; update HR SOPs to Persona URLs only.",
  "Stop treating TCP as roster SoR (paystubs remain legal-name source).",
] as const;

async function main() {
  const [active, missingExport, nullRate, pending, templates, schedules] =
    await Promise.all([
      db.employee.count({ where: { employmentStatus: "ACTIVE" } }),
      db.employee.count({
        where: { employmentStatus: "ACTIVE", OR: [{ exportCode: null }, { exportCode: "" }] },
      }),
      db.timeEntry.count({ where: { rate: null } }),
      db.timeEntry.count({
        where: { approvalStatus: "PENDING", clockOut: { not: null } },
      }),
      db.hoursExportTemplate.count().catch(() => -1),
      db.hoursExportSchedule.count({ where: { enabled: true } }).catch(() => -1),
    ]);

  console.log("TCP decommission checklist\n");
  STEPS.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  console.log("\nPersona readiness snapshot:");
  console.log(
    JSON.stringify(
      {
        activeEmployees: active,
        missingExportCode: missingExport,
        timeEntriesMissingRate: nullRate,
        pendingTimeApprovals: pending,
        exportTemplates: templates,
        enabledExportSchedules: schedules,
        readyHint:
          missingExport === 0 && nullRate === 0 && templates !== 0
            ? "Data prep looks ready — still need 2 clean pay periods without TCP."
            : "Fix exportCode / rates / create at least one export template before cutting TCP.",
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
