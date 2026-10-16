import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { db } from "./support/db";
import { expectNoCrash, failServerActions, toast } from "./support/helpers";
import { ADMIN_STATE, EMPLOYEE, PAYROLL_BLOCKED_TITLE, PAYROLL_PERIOD_TITLE } from "./support/test-data";

test.use({ storageState: ADMIN_STATE });

async function openPeriod(page: import("@playwright/test").Page, title = PAYROLL_PERIOD_TITLE) {
  await page.goto("/admin/payroll");
  await page.getByRole("link", { name: new RegExp(title) }).first().click();
  await expect(page.getByRole("button", { name: /download csv/i })).toBeVisible();
}

test.describe("admin: payroll CSV download", () => {
  test("downloads a CSV that contains the period and the employee", async ({ page }) => {
    await openPeriod(page);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /download csv/i }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^payroll-slip-.*\.csv$/);
    const csv = await readFile((await file.path())!, "utf8");
    expect(csv).toContain(PAYROLL_PERIOD_TITLE);
    expect(csv).toContain(EMPLOYEE.name);
    await expect(toast(page, /csv downloaded/i)).toBeVisible();
  });

  test("period with missing hours needs an override reason before it exports", async ({ page }) => {
    await openPeriod(page, PAYROLL_BLOCKED_TITLE);
    await page.getByRole("button", { name: /download csv/i }).click();
    const dialog = page.getByRole("dialog", { name: /override payroll readiness/i });
    const exportBtn = dialog.getByRole("button", { name: /export with override/i });
    await expect(exportBtn).toBeDisabled();
    await dialog.getByLabel(/override reason/i).fill("too short");
    await expect(exportBtn).toBeDisabled();

    await dialog.getByLabel(/override reason/i).fill("Contractor hours arrive late; approved by finance");
    const download = page.waitForEvent("download");
    await exportBtn.click();
    expect((await download).suggestedFilename()).toMatch(/^payroll-slip-.*\.csv$/);
    expect(await db.auditLog.count({ where: { action: "payroll.export_override" } })).toBe(1);
  });

  test("server failure shows an error and downloads nothing", async ({ page }) => {
    await openPeriod(page);
    let downloaded = false;
    page.on("download", () => (downloaded = true));
    await failServerActions(page, "abort");
    await page.getByRole("button", { name: /download csv/i }).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect(downloaded).toBe(false);
  });

  test("a pay period deleted by someone else gives a clear message", async ({ page }) => {
    await openPeriod(page);
    const period = await db.payrollCalendar.findFirstOrThrow({
      where: { title: PAYROLL_PERIOD_TITLE },
    });
    await db.payrollCalendar.delete({ where: { id: period.id } });
    try {
      await page.getByRole("button", { name: /download csv/i }).click();
      await expect(toast(page, /pay period no longer exists/i)).toBeVisible();
    } finally {
      const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = period;
      await db.payrollCalendar.create({ data: rest });
    }
  });
});
