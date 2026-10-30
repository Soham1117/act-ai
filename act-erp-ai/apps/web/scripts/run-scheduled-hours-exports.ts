/**
 * Cron entry for HoursExportSchedule automation.
 * Run every 15 minutes (America/Chicago due window is ±15 min of minuteOfDay).
 *
 *   pnpm exec tsx --env-file=.env.local scripts/run-scheduled-hours-exports.ts
 *   pnpm exec tsx --env-file=.env.local scripts/run-scheduled-hours-exports.ts --force <scheduleId>
 */
async function main() {
  const forceId = (() => {
    const i = process.argv.indexOf("--force");
    return i >= 0 ? process.argv[i + 1] : undefined;
  })();

  const { executeHoursExportSchedule, runDueHoursExportSchedules } = await import(
    "../src/server/hours-export-runner"
  );
  const { db } = await import("../src/lib/db");

  try {
    if (forceId) {
      const { key } = await executeHoursExportSchedule(forceId);
      console.log(JSON.stringify({ forced: forceId, key }, null, 2));
      return;
    }

    const results = await runDueHoursExportSchedules();
    console.log(JSON.stringify({ ran: results.length, results }, null, 2));
  } finally {
    await db.$disconnect().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
