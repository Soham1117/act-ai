import { test, expect, type Page } from "@playwright/test";
import { db } from "./support/db";
import { delayServerActions, expectNoCrash, failServerActions, toast } from "./support/helpers";
import { FUTURE, PERIOD_A, PERIOD_B, dateOnly } from "./support/payroll-time";
import { ADMIN_STATE } from "./support/test-data";

test.use({ storageState: ADMIN_STATE });

const TEMP = "PT Temp Period";
const count = (title: string) => db.payrollCalendar.count({ where: { title } });

test.afterEach(async () => {
  await db.payrollCalendar.deleteMany({ where: { title: { startsWith: "PT Temp" } } });
});

async function openCreate(page: Page) {
  await page.goto("/admin/payroll");
  await page.getByRole("button", { name: /new pay period/i }).click();
  const dialog = page.getByRole("dialog", { name: /new pay period/i });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function fillPeriod(
  dialog: ReturnType<Page["getByRole"]>,
  v: { title: string; start: string; end: string; pay: string },
) {
  await dialog.getByPlaceholder(/bi-weekly/i).fill(v.title);
  const dates = dialog.locator('input[type="date"]');
  await dates.nth(0).fill(v.start);
  await dates.nth(1).fill(v.end);
  await dates.nth(2).fill(v.pay);
}

const row = (page: Page, title: string) => page.getByRole("listitem").filter({ hasText: title });

test.describe("admin payroll: create pay period", () => {
  test("creates a period and shows it with a status that follows the dates", async ({ page }) => {
    const dialog = await openCreate(page);
    await fillPeriod(dialog, { title: TEMP, ...FUTURE });
    await dialog.getByRole("button", { name: /^create$/i }).click();
    await expect(toast(page, /pay period created/i)).toBeVisible();

    const saved = await db.payrollCalendar.findFirstOrThrow({ where: { title: TEMP } });
    expect(saved.payPeriodStart.toISOString().slice(0, 10)).toBe(FUTURE.start);
    expect(saved.payPeriodEnd.toISOString().slice(0, 10)).toBe(FUTURE.end);
    expect(saved.payDate.toISOString().slice(0, 10)).toBe(FUTURE.pay);
    expect(await db.auditLog.count({ where: { action: "payroll.period.create", resource: `PayrollCalendar:${saved.id}` } })).toBe(1);

    await expect(row(page, TEMP)).toContainText("UPCOMING");
    await expect(row(page, TEMP)).toContainText("Jan 5, 2031");
  });

  test("'Mark completed' closes a future period early", async ({ page }) => {
    const dialog = await openCreate(page);
    await fillPeriod(dialog, { title: TEMP, ...FUTURE });
    await dialog.getByRole("combobox").click();
    await page.getByRole("option", { name: /mark completed/i }).click();
    await dialog.getByRole("button", { name: /^create$/i }).click();
    await expect(toast(page, /pay period created/i)).toBeVisible();
    expect((await db.payrollCalendar.findFirstOrThrow({ where: { title: TEMP } })).status).toBe("COMPLETED");
    await expect(row(page, TEMP)).toContainText("COMPLETED");
  });

  test("a period inside an existing one is rejected and nothing is saved", async ({ page }) => {
    const dialog = await openCreate(page);
    await fillPeriod(dialog, { title: TEMP, start: "2025-03-05", end: "2025-03-06", pay: "2025-03-07" });
    await dialog.getByRole("button", { name: /^create$/i }).click();
    await expect(toast(page, new RegExp(`overlaps "${PERIOD_A.title}" \\(2025-03-01 to 2025-03-14\\)`))).toBeVisible();
    expect(await count(TEMP)).toBe(0);
    await expect(dialog).toBeVisible(); // stays open so the admin can fix the dates
  });

  test("touching an existing period's last day counts as an overlap (inclusive dates)", async ({ page }) => {
    const dialog = await openCreate(page);
    await fillPeriod(dialog, { title: TEMP, start: PERIOD_B.end, end: "2025-03-31", pay: "2025-04-01" });
    await dialog.getByRole("button", { name: /^create$/i }).click();
    await expect(toast(page, new RegExp(`overlaps "${PERIOD_B.title}"`))).toBeVisible();
    expect(await count(TEMP)).toBe(0);
  });

  test("the day after an existing period is allowed", async ({ page }) => {
    // 2025-03-29 .. 2025-03-31 sits between B (ends 03-28) and C (starts 04-01).
    const dialog = await openCreate(page);
    await fillPeriod(dialog, { title: TEMP, start: "2025-03-29", end: "2025-03-31", pay: "2025-04-01" });
    await dialog.getByRole("button", { name: /^create$/i }).click();
    await expect(toast(page, /pay period created/i)).toBeVisible();
    expect(await count(TEMP)).toBe(1);
  });

  test("invalid dates keep Create disabled (end before start, pay date before end)", async ({ page }) => {
    const dialog = await openCreate(page);
    const create = dialog.getByRole("button", { name: /^create$/i });
    await expect(create).toBeDisabled(); // empty form
    await fillPeriod(dialog, { title: TEMP, start: FUTURE.end, end: FUTURE.start, pay: FUTURE.pay });
    await expect(create).toBeDisabled(); // end before start
    await fillPeriod(dialog, { title: TEMP, start: FUTURE.start, end: FUTURE.end, pay: FUTURE.start });
    await expect(create).toBeDisabled(); // pay date before end
    await fillPeriod(dialog, { title: TEMP, ...FUTURE });
    await expect(create).toBeEnabled();
    expect(await count(TEMP)).toBe(0);
  });

  test("a one-letter title is refused by the server with a clear message", async ({ page }) => {
    const dialog = await openCreate(page);
    await fillPeriod(dialog, { title: "X", ...FUTURE });
    await dialog.getByRole("button", { name: /^create$/i }).click();
    await expect(toast(page, /check title/i)).toBeVisible();
    expect(await db.payrollCalendar.count({ where: { title: "X" } })).toBe(0);
  });

  test("server failure shows an error and saves nothing", async ({ page }) => {
    const dialog = await openCreate(page);
    await fillPeriod(dialog, { title: TEMP, ...FUTURE });
    await failServerActions(page, "abort");
    await dialog.getByRole("button", { name: /^create$/i }).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect(await count(TEMP)).toBe(0);
  });

  test("server 500 shows an error and saves nothing", async ({ page }) => {
    const dialog = await openCreate(page);
    await fillPeriod(dialog, { title: TEMP, ...FUTURE });
    await failServerActions(page, "500");
    await dialog.getByRole("button", { name: /^create$/i }).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect(await count(TEMP)).toBe(0);
  });

  test("double-clicking Create makes exactly one period", async ({ page }) => {
    const dialog = await openCreate(page);
    await fillPeriod(dialog, { title: TEMP, ...FUTURE });
    const calls = await delayServerActions(page, 1500);
    await dialog.getByRole("button", { name: /^create$/i }).dblclick();
    await expect(toast(page, /pay period created/i)).toBeVisible();
    expect(await count(TEMP)).toBe(1);
    expect(calls.count()).toBe(1);
  });

  test("a stale page (old deployment) does not crash and saves nothing", async ({ page }) => {
    const dialog = await openCreate(page);
    await fillPeriod(dialog, { title: TEMP, ...FUTURE });
    await failServerActions(page, "stale");
    await dialog.getByRole("button", { name: /^create$/i }).click();
    // The app has no special stale-deployment handling: Next's own error path runs.
    // Whatever the user sees must be a visible error (toast or error screen), never a silent success.
    await expect(page.getByText(/something went wrong|failed|try again|refresh|reload/i).first()).toBeVisible();
    await expect(toast(page, /pay period created/i)).toHaveCount(0);
    expect(await count(TEMP)).toBe(0);
  });
});

test.describe("admin payroll: edit and delete pay period", () => {
  async function seedTemp(overrides: Partial<{ start: string; end: string; pay: string }> = {}) {
    const admin = await db.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    return db.payrollCalendar.create({
      data: {
        title: TEMP,
        payPeriodStart: dateOnly(overrides.start ?? FUTURE.start),
        payPeriodEnd: dateOnly(overrides.end ?? FUTURE.end),
        payDate: dateOnly(overrides.pay ?? FUTURE.pay),
        status: "UPCOMING",
        createdById: admin.id,
      },
    });
  }

  async function openEdit(page: Page) {
    await page.goto("/admin/payroll");
    await row(page, TEMP).getByRole("button", { name: /edit pay period/i }).click();
    const dialog = page.getByRole("dialog", { name: /edit pay period/i });
    await expect(dialog).toBeVisible();
    return dialog;
  }

  test("renames a period and changes its dates", async ({ page }) => {
    const p = await seedTemp();
    const dialog = await openEdit(page);
    await dialog.getByRole("textbox").first().fill("PT Temp Renamed");
    await dialog.locator('input[type="date"]').nth(2).fill("2031-01-30");
    await dialog.getByRole("button", { name: /^save$/i }).click();
    await expect(toast(page, /pay period updated/i)).toBeVisible();
    const after = await db.payrollCalendar.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.title).toBe("PT Temp Renamed");
    expect(after.payDate.toISOString().slice(0, 10)).toBe("2031-01-30");
  });

  test("editing into another period is rejected and keeps the old dates", async ({ page }) => {
    const p = await seedTemp();
    const dialog = await openEdit(page);
    const dates = dialog.locator('input[type="date"]');
    await dates.nth(0).fill("2025-03-10");
    await dates.nth(1).fill("2025-03-12");
    await dates.nth(2).fill("2025-03-13");
    await dialog.getByRole("button", { name: /^save$/i }).click();
    await expect(toast(page, new RegExp(`overlaps "${PERIOD_A.title}"`))).toBeVisible();
    const after = await db.payrollCalendar.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.payPeriodStart.toISOString().slice(0, 10)).toBe(FUTURE.start);
  });

  test("invalid edited dates show a message and disable Save", async ({ page }) => {
    await seedTemp();
    const dialog = await openEdit(page);
    await dialog.locator('input[type="date"]').nth(1).fill("2031-01-01"); // end before start
    await expect(dialog.getByText(/end can.t be before the start/i)).toBeVisible();
    await expect(dialog.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  test("marking a period completed overrides its dates", async ({ page }) => {
    const p = await seedTemp();
    const dialog = await openEdit(page);
    await dialog.getByRole("combobox").click();
    await page.getByRole("option", { name: /mark completed/i }).click();
    await dialog.getByRole("button", { name: /^save$/i }).click();
    await expect(toast(page, /pay period updated/i)).toBeVisible();
    expect((await db.payrollCalendar.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("COMPLETED");
    await expect(row(page, TEMP)).toContainText("COMPLETED");
  });

  test("editing a period someone else deleted gives a clear message", async ({ page }) => {
    const p = await seedTemp();
    const dialog = await openEdit(page);
    await db.payrollCalendar.delete({ where: { id: p.id } });
    await dialog.getByRole("button", { name: /^save$/i }).click();
    await expect(toast(page, /no longer exists/i)).toBeVisible();
  });

  test("edit failure keeps the old values", async ({ page }) => {
    const p = await seedTemp();
    const dialog = await openEdit(page);
    await dialog.getByRole("textbox").first().fill("PT Temp Never Saved");
    await failServerActions(page, "abort");
    await dialog.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    expect((await db.payrollCalendar.findUniqueOrThrow({ where: { id: p.id } })).title).toBe(TEMP);
  });

  test("delete asks first; cancelling keeps the period", async ({ page }) => {
    await seedTemp();
    await page.goto("/admin/payroll");
    page.once("dialog", (d) => {
      expect(d.message()).toContain(TEMP);
      void d.dismiss();
    });
    await row(page, TEMP).getByRole("button", { name: /delete pay period/i }).click();
    await expect(row(page, TEMP)).toBeVisible();
    expect(await count(TEMP)).toBe(1);
  });

  test("delete removes the period and writes an audit record", async ({ page }) => {
    const p = await seedTemp();
    await page.goto("/admin/payroll");
    page.once("dialog", (d) => void d.accept());
    await row(page, TEMP).getByRole("button", { name: /delete pay period/i }).click();
    await expect(toast(page, /pay period deleted/i)).toBeVisible();
    await expect(row(page, TEMP)).toHaveCount(0);
    expect(await count(TEMP)).toBe(0);
    expect(await db.auditLog.count({ where: { action: "payroll.period.delete", resource: `PayrollCalendar:${p.id}` } })).toBe(1);
  });

  test("delete of a period someone else already deleted gives a clear message", async ({ page }) => {
    const p = await seedTemp();
    await page.goto("/admin/payroll");
    await db.payrollCalendar.delete({ where: { id: p.id } });
    page.once("dialog", (d) => void d.accept());
    await row(page, TEMP).getByRole("button", { name: /delete pay period/i }).click();
    await expect(toast(page, /already deleted/i)).toBeVisible();
  });

  test("delete failure keeps the period", async ({ page }) => {
    await seedTemp();
    await page.goto("/admin/payroll");
    await failServerActions(page, "abort");
    page.once("dialog", (d) => void d.accept());
    await row(page, TEMP).getByRole("button", { name: /delete pay period/i }).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    expect(await count(TEMP)).toBe(1);
  });

  test("deleting a pay period never deletes pay documents", async ({ page }) => {
    await seedTemp();
    const before = await db.payroll.count();
    await page.goto("/admin/payroll");
    page.once("dialog", (d) => void d.accept());
    await row(page, TEMP).getByRole("button", { name: /delete pay period/i }).click();
    await expect(toast(page, /pay period deleted/i)).toBeVisible();
    expect(await db.payroll.count()).toBe(before);
  });
});
