import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { db } from "./support/db";
import { delayServerActions, expectNoCrash, failServerActions, toast } from "./support/helpers";
import { PERIOD_A, PERIOD_B, PERIOD_C, PT, clearEntries, makeEntry } from "./support/payroll-time";
import { ADMIN_STATE, EMPLOYEE, PIN_EMPLOYEE } from "./support/test-data";

test.use({ storageState: ADMIN_STATE });

async function openPeriod(page: Page, title: string) {
  const p = await db.payrollCalendar.findFirstOrThrow({ where: { title } });
  await page.goto(`/admin/payroll/${p.id}`);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  return p;
}

/** The slip table (second table on the page; the first is the readiness list). */
const slipRow = (page: Page, name: string) =>
  page.locator("table").nth(1).getByRole("row").filter({ hasText: name });
const readinessRow = (page: Page, name: string) =>
  page.locator("table").first().getByRole("row").filter({ hasText: name });

async function expectSlip(
  page: Page,
  name: string,
  v: { days: string; regular: string; overtime: string; total: string },
) {
  const cells = slipRow(page, name).getByRole("cell");
  await expect(cells.nth(3)).toHaveText(v.days);
  await expect(cells.nth(4)).toHaveText(v.regular);
  await expect(cells.nth(5)).toHaveText(v.overtime);
  await expect(cells.nth(6)).toHaveText(v.total);
}

test.describe("admin payroll slip: hours and overtime", () => {
  test("period header shows title, dates, pay date and status", async ({ page }) => {
    await openPeriod(page, PERIOD_A.title);
    await expect(page.getByText(/Mar 1, 2025.*Mar 14, 2025.*pay date Mar 19, 2025/)).toBeVisible();
    await expect(page.getByText("COMPLETED", { exact: true })).toBeVisible();
  });

  test("a 45 hour Mon-Fri week gives 40 regular + 5 overtime; the Saturday before is its own week", async ({ page }) => {
    await openPeriod(page, PERIOD_A.title);
    // Sat 03-01: 4h (30 min break removed). Mon-Fri 03-03..07: 9h x 5 = 45h.
    await expectSlip(page, EMPLOYEE.name, { days: "6", regular: "44.00", overtime: "5.00", total: "49.00" });
  });

  test("a week that straddles two periods: overtime lands where the 40th hour is crossed", async ({ page }) => {
    await openPeriod(page, PERIOD_A.title);
    // Mon-Thu 10h + Fri 8h = 48h inside A.
    await expectSlip(page, PIN_EMPLOYEE.name, { days: "5", regular: "40.00", overtime: "8.00", total: "48.00" });
    await openPeriod(page, PERIOD_B.title);
    // Sat 03-15 (5h) is the same Mon-Sun week, already past 40h: all overtime, nothing double counted.
    await expectSlip(page, PIN_EMPLOYEE.name, { days: "1", regular: "0.00", overtime: "5.00", total: "5.00" });
    await expect(slipRow(page, EMPLOYEE.name)).toHaveCount(0);
  });

  test("pending and rejected entries are left out of the slip", async ({ page }) => {
    await openPeriod(page, PERIOD_A.title);
    await expect(slipRow(page, PT.rex.name)).toHaveCount(0);
    await expect(slipRow(page, PT.pat.name)).toHaveCount(0);
  });

  test("summary cards add up the slip", async ({ page }) => {
    await openPeriod(page, PERIOD_A.title);
    await expect(page.getByText("97.0", { exact: true })).toBeVisible(); // 49 + 48
    await expect(page.getByText("13.0", { exact: true })).toBeVisible(); // 5 + 8 overtime
    const totals = page.locator("table").nth(1).getByRole("row").filter({ hasText: "Totals" });
    await expect(totals.getByRole("cell").nth(1)).toHaveText("11"); // days 6 + 5
    await expect(totals.getByRole("cell").nth(2)).toHaveText("84.00"); // regular 44 + 40
    await expect(totals.getByRole("cell").nth(3)).toHaveText("13.00");
    await expect(totals.getByRole("cell").nth(4)).toHaveText("97.00");
  });

  test.describe("Sunday belongs to the Monday-start week it ends", () => {
    test.afterEach(() => clearEntries(PT.tina.employeeId));

    test("Mon-Fri 8h + Sun 3h = 3h overtime; next Monday starts a fresh week", async ({ page }) => {
      for (const d of ["17", "18", "19", "20", "21"]) await makeEntry(PT.tina.employeeId, `2025-03-${d}`, "08:00", "16:00");
      await makeEntry(PT.tina.employeeId, "2025-03-23", "09:00", "12:00"); // Sunday, same week
      await makeEntry(PT.tina.employeeId, "2025-03-24", "09:00", "11:00"); // Monday, new week
      await openPeriod(page, PERIOD_B.title);
      await expectSlip(page, PT.tina.name, { days: "7", regular: "42.00", overtime: "3.00", total: "45.00" });
    });
  });

  test("an empty period says so", async ({ page }) => {
    const admin = await db.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    const p = await db.payrollCalendar.create({
      data: {
        title: "PT Temp Empty",
        payPeriodStart: new Date("2031-02-03T00:00:00Z"),
        payPeriodEnd: new Date("2031-02-16T00:00:00Z"),
        payDate: new Date("2031-02-20T00:00:00Z"),
        status: "UPCOMING",
        createdById: admin.id,
      },
    });
    try {
      await page.goto(`/admin/payroll/${p.id}`);
      await expect(page.getByText(/no approved time entries in this period/i)).toBeVisible();
      await expect(page.getByText("UPCOMING", { exact: true })).toBeVisible();
    } finally {
      await db.payrollCalendar.delete({ where: { id: p.id } });
    }
  });

  test("an unknown period id shows not-found, not a crash", async ({ page }) => {
    await page.goto("/admin/payroll/no-such-period");
    await expect(page.getByText(/not found|404/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /download csv/i })).toHaveCount(0);
    await expectNoCrash(page);
  });
});

test.describe("admin payroll slip: readiness blockers", () => {
  test.beforeAll(async () => {
    // An open shift inside period C. Inserted here (not seeded) because an open stale
    // shift changes which tab the time-tracking page opens on.
    await makeEntry(PT.opal.employeeId, "2025-04-04", "08:00", null, { open: true });
  });
  test.afterAll(() => clearEntries(PT.opal.employeeId, { date: new Date("2025-04-04T00:00:00Z") }));

  test("each exception shows its own badge for the right employee", async ({ page }) => {
    await openPeriod(page, PERIOD_C.title);
    await expect(page.getByText(/payroll readiness · \d+ active employees/i)).toBeVisible();
    await expect(readinessRow(page, PT.pat.name)).toContainText("Pending review");
    await expect(readinessRow(page, PT.pat.name)).toContainText("Zero approved hours"); // its only entry is pending
    await expect(readinessRow(page, PT.rita.name)).toContainText("Rejected time");
    await expect(readinessRow(page, PT.opal.name)).toContainText("Open shift");
    await expect(readinessRow(page, PT.alma.name)).toContainText("Auto-closed");
    await expect(readinessRow(page, PT.alma.name)).not.toContainText("Zero approved hours");
    await expect(readinessRow(page, PT.zed.name)).toContainText("Zero approved hours");
    // Erin has 8 approved hours and nothing wrong in C.
    await expect(readinessRow(page, EMPLOYEE.name)).toContainText("Ready");
    await expect(readinessRow(page, EMPLOYEE.name).getByRole("cell").nth(2)).toHaveText("8.00");
  });

  test("approved hours in the readiness list ignore pending entries", async ({ page }) => {
    await openPeriod(page, PERIOD_C.title);
    await expect(readinessRow(page, PT.pat.name).getByRole("cell").nth(2)).toHaveText("0.00");
    await expect(readinessRow(page, PT.alma.name).getByRole("cell").nth(2)).toHaveText("8.00");
  });

  test("a blocked period needs an override; the audit record keeps reason and counts", async ({ page }) => {
    const p = await openPeriod(page, PERIOD_C.title);
    const before = await db.auditLog.count({ where: { action: "payroll.export_override", resource: `PayrollCalendar:${p.id}` } });
    await page.getByRole("button", { name: /download csv/i }).click();
    const dialog = page.getByRole("dialog", { name: /override payroll readiness/i });
    const exportBtn = dialog.getByRole("button", { name: /export with override/i });
    await dialog.getByLabel(/override reason/i).fill("123456789"); // 9 characters
    await expect(exportBtn).toBeDisabled();
    await dialog.getByLabel(/override reason/i).fill("1234567890"); // exactly 10
    const download = page.waitForEvent("download");
    await exportBtn.click();
    await download;
    await expect(toast(page, /audited override/i)).toBeVisible();
    const logs = await db.auditLog.findMany({
      where: { action: "payroll.export_override", resource: `PayrollCalendar:${p.id}` },
      orderBy: { createdAt: "desc" },
    });
    expect(logs.length).toBe(before + 1);
    const diff = logs[0]!.diff as { reason: string; exceptionSummary: Record<string, number>; affectedEmployees: number };
    expect(diff.reason).toBe("1234567890");
    expect(diff.exceptionSummary.PENDING).toBeGreaterThanOrEqual(1);
    expect(diff.exceptionSummary.REJECTED).toBeGreaterThanOrEqual(1);
    expect(diff.exceptionSummary.OPEN).toBeGreaterThanOrEqual(1);
    expect(diff.exceptionSummary.AUTO_CLOSED).toBeGreaterThanOrEqual(1);
    expect(diff.affectedEmployees).toBeGreaterThanOrEqual(5);
  });

  test("cancelling the override dialog downloads nothing and writes no audit record", async ({ page }) => {
    const p = await openPeriod(page, PERIOD_C.title);
    const before = await db.auditLog.count({ where: { action: "payroll.export_override", resource: `PayrollCalendar:${p.id}` } });
    let downloaded = false;
    page.on("download", () => (downloaded = true));
    await page.getByRole("button", { name: /download csv/i }).click();
    const dialog = page.getByRole("dialog", { name: /override payroll readiness/i });
    await dialog.getByLabel(/override reason/i).fill("Some long reason here");
    await dialog.getByRole("button", { name: /cancel/i }).click();
    await expect(dialog).toBeHidden();
    expect(downloaded).toBe(false);
    expect(await db.auditLog.count({ where: { action: "payroll.export_override", resource: `PayrollCalendar:${p.id}` } })).toBe(before);
  });

  test("override export failure: error shown, no file, no audit record", async ({ page }) => {
    const p = await openPeriod(page, PERIOD_C.title);
    const before = await db.auditLog.count({ where: { action: "payroll.export_override", resource: `PayrollCalendar:${p.id}` } });
    let downloaded = false;
    page.on("download", () => (downloaded = true));
    await page.getByRole("button", { name: /download csv/i }).click();
    const dialog = page.getByRole("dialog", { name: /override payroll readiness/i });
    await dialog.getByLabel(/override reason/i).fill("Finance approved late hours");
    await failServerActions(page, "abort");
    await dialog.getByRole("button", { name: /export with override/i }).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect(downloaded).toBe(false);
    expect(await db.auditLog.count({ where: { action: "payroll.export_override", resource: `PayrollCalendar:${p.id}` } })).toBe(before);
  });

  test("double-clicking 'Export with override' exports and audits once", async ({ page }) => {
    const p = await openPeriod(page, PERIOD_C.title);
    const before = await db.auditLog.count({ where: { action: "payroll.export_override", resource: `PayrollCalendar:${p.id}` } });
    await page.getByRole("button", { name: /download csv/i }).click();
    const dialog = page.getByRole("dialog", { name: /override payroll readiness/i });
    await dialog.getByLabel(/override reason/i).fill("Finance approved late hours");
    const calls = await delayServerActions(page, 1200);
    const downloads: string[] = [];
    page.on("download", (d) => downloads.push(d.suggestedFilename()));
    await dialog.getByRole("button", { name: /export with override/i }).dblclick();
    await expect(toast(page, /audited override/i)).toBeVisible();
    expect(calls.count()).toBe(1);
    expect(downloads).toHaveLength(1);
    expect(await db.auditLog.count({ where: { action: "payroll.export_override", resource: `PayrollCalendar:${p.id}` } })).toBe(before + 1);
  });
});

test.describe("admin payroll slip: CSV content", () => {
  async function downloadCsv(page: Page, title: string) {
    await openPeriod(page, title);
    await page.getByRole("button", { name: /download csv/i }).click();
    const dialog = page.getByRole("dialog", { name: /override payroll readiness/i });
    await dialog.getByLabel(/override reason/i).fill("Checking CSV contents in test");
    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: /export with override/i }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`payroll-slip-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`);
    return (await readFile((await file.path())!, "utf8")).split("\r\n");
  }

  test("period A CSV: title line, header, and the overtime split per employee", async ({ page }) => {
    const lines = await downloadCsv(page, PERIOD_A.title);
    expect(lines[0]).toBe(`"${PERIOD_A.title}"`);
    expect(lines[1]).toBe(
      '"Employee ID","Name","Department","Pay Period Start","Pay Period End","Days Worked","Regular Hours","Overtime Hours","Total Hours"',
    );
    expect(lines).toContain('"EMP-2026-0001","Erin Employee","","2025-03-01","2025-03-14","6","44","5","49"');
    expect(lines).toContain('"EMP-2026-0003","Pia Pinless","","2025-03-01","2025-03-14","5","40","8","48"');
    expect(lines.join("\n")).not.toContain(PT.rex.name); // pending/rejected only
  });

  test("period B CSV: the straddling week's remainder is pure overtime, once", async ({ page }) => {
    const lines = await downloadCsv(page, PERIOD_B.title);
    expect(lines).toContain('"EMP-2026-0003","Pia Pinless","","2025-03-15","2025-03-28","1","0","5","5"');
    expect(lines.filter((l) => l.includes("Pia Pinless"))).toHaveLength(1);
    expect(lines.join("\n")).not.toContain("Erin Employee");
  });
});

test.describe("admin payroll slip: print view", () => {
  test("print layout hides the controls and shows the slip header", async ({ page }) => {
    await openPeriod(page, PERIOD_A.title);
    await page.emulateMedia({ media: "print" });
    await expect(page.getByText("ACT — Payroll Slip")).toBeVisible();
    await expect(page.getByRole("button", { name: /download csv/i })).toBeHidden();
    await expect(page.getByText(/payroll readiness/i)).toBeHidden();
    await expect(slipRow(page, EMPLOYEE.name)).toBeVisible();
    await page.emulateMedia({ media: "screen" });
    await expect(page.getByText("ACT — Payroll Slip")).toBeHidden();
  });

  test("the Print button opens the browser print dialog", async ({ page }) => {
    await openPeriod(page, PERIOD_A.title);
    await page.evaluate(() => {
      (window as unknown as { __printed: number }).__printed = 0;
      window.print = () => void ((window as unknown as { __printed: number }).__printed += 1);
    });
    await page.getByRole("button", { name: /^print$/i }).click();
    expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
  });
});
