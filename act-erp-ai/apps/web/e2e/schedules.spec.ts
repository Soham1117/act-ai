import { test, expect, type Page } from "@playwright/test";
import { db } from "./support/db";
import { expectNoCrash, failServerActions, toast } from "./support/helpers";
import { ADMIN_STATE, EMPLOYEE, INACTIVE_JOB_CODE, JOB_CODE } from "./support/test-data";

test.use({ storageState: ADMIN_STATE });

async function openNewShiftDialog(page: Page) {
  await page.goto("/admin/schedules");
  await page.getByRole("button", { name: /new shift/i }).click();
  const dialog = page.getByRole("dialog", { name: /new shift/i });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("admin schedules: new shift", () => {
  test("job code dropdown lists only real active codes (regression: hard-coded ACT001)", async ({
    page,
  }) => {
    const dialog = await openNewShiftDialog(page);

    // The default code is preselected and it is a real one.
    const trigger = dialog.getByRole("combobox");
    await expect(trigger).toContainText(JOB_CODE.code);
    await expect(dialog).not.toContainText("ACT001");

    await trigger.click();
    const options = page.getByRole("option");
    await expect(options.filter({ hasText: JOB_CODE.code })).toHaveCount(1);
    await expect(options.filter({ hasText: INACTIVE_JOB_CODE.code })).toHaveCount(0);
    await expect(options.filter({ hasText: "ACT001" })).toHaveCount(0);
  });

  test("admin creates a shift with an existing job code", async ({ page }) => {
    const dialog = await openNewShiftDialog(page);
    await dialog.getByRole("button", { name: EMPLOYEE.name }).click();
    await dialog.getByRole("button", { name: /^create$/i }).click();
    await expect(toast(page, /shift created/i)).toBeVisible();

    const shift = await db.schedule.findFirstOrThrow({
      where: { employee: { employeeId: EMPLOYEE.employeeId } },
      orderBy: { createdAt: "desc" },
    });
    expect(shift.jobCode).toBe(JOB_CODE.code);
  });

  test("cannot create a shift without picking an employee", async ({ page }) => {
    const dialog = await openNewShiftDialog(page);
    await expect(dialog.getByRole("button", { name: /^create$/i })).toBeDisabled();
  });

  test("start and end at the same time is rejected with a clear message", async ({ page }) => {
    const dialog = await openNewShiftDialog(page);
    await dialog.getByRole("button", { name: EMPLOYEE.name }).click();
    await dialog.locator('input[type="time"]').nth(1).fill("08:00"); // end = start
    await dialog.getByRole("button", { name: /^create$/i }).click();
    await expect(toast(page, /start and end can.t be the same/i)).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test("server failure while saving shows an error and does not crash", async ({ page }) => {
    const dialog = await openNewShiftDialog(page);
    await dialog.getByRole("button", { name: EMPLOYEE.name }).click();
    await failServerActions(page, "abort");
    await dialog.getByRole("button", { name: /^create$/i }).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    await expectNoCrash(page);
  });
});
