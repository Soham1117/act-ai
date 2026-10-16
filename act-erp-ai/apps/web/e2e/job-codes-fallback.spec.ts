import { test, expect } from "@playwright/test";
import { db } from "./support/db";
import { openKiosk, toast } from "./support/helpers";
import { CUSTOM_PIN, PEOPLE, personRow, restoreJobCodes } from "./support/people";
import { KIOSK_ACTIVE_SLUG } from "./support/test-data";

/** Clock jcB in at the kiosk and return the job code stamped on the new entry. */
async function punchIn(browser: import("@playwright/test").Browser) {
  const emp = await personRow("jcB");
  const page = await openKiosk(browser, KIOSK_ACTIVE_SLUG);
  await page.getByRole("button", { name: new RegExp(PEOPLE.jcB.name) }).first().click();
  await page.getByPlaceholder("••••").fill(CUSTOM_PIN);
  await page.getByRole("button", { name: /^clock in$/i }).click();
  await expect(toast(page, /clocked in/i)).toBeVisible();
  await page.context().close();
  return db.timeEntry.findFirstOrThrow({ where: { employeeId: emp.id, status: "ACTIVE" } });
}

let snapshot: { id: string; isActive: boolean; isDefault: boolean }[] = [];
test.beforeEach(async () => {
  snapshot = await db.jobCode.findMany({ select: { id: true, isActive: true, isDefault: true } });
});

test.afterEach(async () => {
  const emp = await personRow("jcB");
  await db.timeEntry.deleteMany({ where: { employeeId: emp.id, source: "KIOSK" } });
  await db.jobCodeAssignment.deleteMany({ where: { employeeId: emp.id } });
  await restoreJobCodes();
  // These tests deactivate every code, including other areas'; put each back exactly as it was.
  for (const c of snapshot) {
    await db.jobCode.updateMany({ where: { id: c.id }, data: { isActive: c.isActive, isDefault: c.isDefault } });
  }
});

test.describe("job codes: what the kiosk stamps on a punch", () => {
  test("with an active default code, a person with no assignment gets the default", async ({ browser }) => {
    expect((await punchIn(browser)).jobCode).toBe("E2E100");
  });

  test("a deactivated assigned code is skipped; the default is used", async ({ browser }) => {
    const emp = await personRow("jcB");
    const jc = await db.jobCode.findUniqueOrThrow({ where: { code: "PPJC1" } });
    await db.jobCodeAssignment.create({ data: { jobCodeId: jc.id, employeeId: emp.id, isPrimary: true } });
    await db.jobCode.update({ where: { id: jc.id }, data: { isActive: false } });
    expect((await punchIn(browser)).jobCode).toBe("E2E100");
  });

  test("with no usable job code at all, the punch is stamped with the literal ACT001 (documents current behaviour)", async ({
    browser,
  }) => {
    await db.jobCode.updateMany({ data: { isActive: false } });
    const entry = await punchIn(browser);
    expect(entry.jobCode).toBe("ACT001");
    expect(await db.jobCode.count({ where: { code: "ACT001" } })).toBe(0); // it does not exist
  });

  // BUG (app): src/server/time-core.ts resolveJobCode falls back to the literal "ACT001"
  // (and contract-time-core.ts DEFAULT_JOB_CODE, plus the schema defaults on
  // TimeEntry/ContractWorker.jobCode). When no active job code exists, the kiosk records a
  // punch with a code that is not in the Job codes list, so payroll/reports show an unknown code.
  // Proposed fix: when nothing resolves, refuse the punch with "No job code is set up. Ask an
  // admin." (or store null), and drop the "ACT001" literals/defaults.
  test.fixme("with no usable job code the punch is refused or uses a code that exists", async ({
    browser,
  }) => {
    await db.jobCode.updateMany({ data: { isActive: false } });
    const emp = await personRow("jcB");
    const page = await openKiosk(browser, KIOSK_ACTIVE_SLUG);
    await page.getByRole("button", { name: new RegExp(PEOPLE.jcB.name) }).first().click();
    await page.getByPlaceholder("••••").fill(CUSTOM_PIN);
    await page.getByRole("button", { name: /^clock in$/i }).click();
    const entry = await db.timeEntry.findFirst({ where: { employeeId: emp.id, status: "ACTIVE" } });
    if (entry) expect(await db.jobCode.count({ where: { code: entry.jobCode } })).toBe(1);
    await page.context().close();
  });
});
