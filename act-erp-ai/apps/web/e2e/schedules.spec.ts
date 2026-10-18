import { test, expect, type Page } from "@playwright/test";
import { db } from "./support/db";
import { calEvents, gotoMonth } from "./support/schedules";
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

test.describe("admin schedules: DST gap", () => {
  test("a shift stored at 02:30 on the spring-forward day still reads 2:30 AM", async ({ page }) => {
    await page.goto("/admin/schedules");
    await gotoMonth(page, "2026-03-08");
    await expect(calEvents(page, /^2:30 AM/).first()).toBeVisible();
    await expect(calEvents(page, /^3:30 AM/)).toHaveCount(0);
  });

  test("the List view shows the stored 2:30 AM - 4:30 AM too", async ({ page }) => {
    await page.goto("/admin/schedules");
    await gotoMonth(page, "2026-03-08");
    await page.getByRole("button", { name: "Select View" }).click();
    await page.getByText("List", { exact: true }).first().click();
    const row = page.locator(".sx__list-day[data-date='2026-03-08'] .sx__list-event").filter({ hasText: "E2E100" });
    await expect(row.first()).toBeVisible();
    await expect(row.filter({ hasText: "2:30 AM" })).toHaveCount(1);
    await expect(row.filter({ hasText: "4:30 AM" })).toHaveCount(1);
    await expect(row.filter({ hasText: "3:30 AM" })).toHaveCount(0);
  });
});

test.describe("admin schedules: month navigation failures", () => {
  for (const mode of ["abort", "500"] as const) {
    test(`a failed month fetch (${mode}) shows a message and keeps the calendar usable`, async ({ page }) => {
      await page.goto("/admin/schedules");
      await expect(page.locator(".sx__range-heading")).toBeVisible();
      const failing = await failServerActions(page, mode, { times: 1 });
      await gotoMonth(page, "2026-03-04");
      await expect(
        toast(page, /could not load shifts for this month\. check the connection and try again/i),
      ).toBeVisible();
      expect(failing.count()).toBe(1);
      await expectNoCrash(page);
      await expect(page.locator(".sx__range-heading")).toHaveText("March 2026");

      // The next month loads normally and the calendar still takes input.
      await gotoMonth(page, "2026-04-01");
      await expect(page.locator(".sx__range-heading")).toHaveText("April 2026");
      await page.getByRole("button", { name: /new shift/i }).click();
      await expect(page.getByRole("dialog", { name: /new shift/i })).toBeVisible();
    });
  }
});

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
