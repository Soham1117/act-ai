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

  // Regression: time-core.ts used to fall back to the made-up code "ACT001" when no
  // active job code resolved. The punch must now be refused and nothing recorded.
  test("with no usable job code the punch is refused and nothing is recorded", async ({
    browser,
  }) => {
    await db.jobCode.updateMany({ data: { isActive: false } });
    const emp = await personRow("jcB");
    const page = await openKiosk(browser, KIOSK_ACTIVE_SLUG);
    await page.getByRole("button", { name: new RegExp(PEOPLE.jcB.name) }).first().click();
    await page.getByPlaceholder("••••").fill(CUSTOM_PIN);
    await page.getByRole("button", { name: /^clock in$/i }).click();
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: /no active job code is set up/i }),
    ).toBeVisible();
    expect(await db.timeEntry.count({ where: { employeeId: emp.id, status: "ACTIVE" } })).toBe(0);
    expect(await db.timeEntry.count({ where: { jobCode: "ACT001" } })).toBe(0);
    await page.context().close();
  });
});
