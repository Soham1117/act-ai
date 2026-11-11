import { test, expect } from "@playwright/test";
import { db } from "./support/db";
import { expectNoCrash, failServerActions, toast } from "./support/helpers";
import { ensurePayrollReady } from "./support/payroll-ready";
import { ADMIN_STATE, EMPLOYEE, PAYROLL_BLOCKED_TITLE, PAYROLL_PERIOD_TITLE } from "./support/test-data";
import { NETWORK_ERROR } from "./support/action-errors";
import { readPeriodWorkbook } from "./support/xlsx";

test.use({ storageState: ADMIN_STATE });

// Other specs add and remove people and hours; start from an export-ready period.
test.beforeEach(ensurePayrollReady);

async function openPeriod(page: import("@playwright/test").Page, title = PAYROLL_PERIOD_TITLE) {
  await page.goto("/admin/payroll");
  await page.getByRole("link", { name: new RegExp(title) }).first().click();
  await expect(page.getByRole("button", { name: /download excel/i })).toBeVisible();
}

test.describe("admin: payroll Excel download", () => {
  test("downloads a Period (Detail) workbook with the employee", async ({ page }) => {
    await openPeriod(page);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /download excel/i }).click();
    const { filename, sheets, rows } = await readPeriodWorkbook(await download);
    expect(filename).toMatch(/^payroll-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(sheets).toHaveLength(1);
    expect(rows[0]).toEqual(["Period (Detail)"]);
    expect(rows.some((r) => r[0] === EMPLOYEE.name)).toBe(true);
    expect(rows.at(-1)![0]).toBe("Control Totals:");
    await expect(toast(page, /excel downloaded/i)).toBeVisible();
  });

  test("period with missing hours needs an override reason before it exports", async ({ page }) => {
    await openPeriod(page, PAYROLL_BLOCKED_TITLE);
    await page.getByRole("button", { name: /download excel/i }).click();
    const dialog = page.getByRole("dialog", { name: /override payroll readiness/i });
    const exportBtn = dialog.getByRole("button", { name: /export with override/i });
    await expect(exportBtn).toBeDisabled();
    await dialog.getByLabel(/override reason/i).fill("too short");
    await expect(exportBtn).toBeDisabled();

    await dialog.getByLabel(/override reason/i).fill("Contractor hours arrive late; approved by finance");
    const download = page.waitForEvent("download");
    await exportBtn.click();
    expect((await download).suggestedFilename()).toMatch(/^payroll-.*\.xlsx$/);
    expect(await db.auditLog.count({ where: { action: "payroll.export_override" } })).toBe(1);
  });

  test("server failure shows an error and downloads nothing", async ({ page }) => {
    await openPeriod(page);
    let downloaded = false;
    page.on("download", () => (downloaded = true));
    await failServerActions(page, "abort");
    await page.getByRole("button", { name: /download excel/i }).click();
    await expect(toast(page, NETWORK_ERROR)).toBeVisible();
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
      await page.getByRole("button", { name: /download excel/i }).click();
      await expect(toast(page, /pay period no longer exists/i)).toBeVisible();
    } finally {
      const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = period;
      await db.payrollCalendar.create({ data: rest });
    }
  });
});
