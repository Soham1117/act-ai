import { test, expect, type Page } from "@playwright/test";
import { businessYmd, db } from "./support/db";
import { delayServerActions, expectNoCrash, failServerActions, toast } from "./support/helpers";
import { PT, clearEntries, entriesUrl, makeEntry } from "./support/payroll-time";
import { ADMIN_STATE } from "./support/test-data";

test.use({ storageState: ADMIN_STATE });

/** Entries created "now-ish" are not cleaned by clearEntries (it only touches pre-2026 rows). */
const created: string[] = [];
test.afterEach(async () => {
  await clearEntries(PT.tina.employeeId);
  await db.timeEntry.deleteMany({ where: { id: { in: created.splice(0) } } });
});

const ago = (h: number) => new Date(Date.now() - h * 3_600_000);
async function recent(emp: string, inH: number, outH: number | null, extra: Parameters<typeof makeEntry>[4] = {}) {
  const clockIn = ago(inH);
  const e = await makeEntry(emp, businessYmd(0), "00:00", null, {
    clockInAt: clockIn,
    clockOutAt: outH === null ? null : ago(outH),
    open: outH === null,
    ...extra,
  });
  const date = new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(clockIn)}T00:00:00Z`);
  await db.timeEntry.update({ where: { id: e.id }, data: { date } });
  created.push(e.id);
  return e;
}
const fresh = (id: string) => db.timeEntry.findUniqueOrThrow({ where: { id }, include: { breaks: true } });

async function openEdit(page: Page, name: string, from: string, to: string) {
  await page.goto(entriesUrl(name, from, to));
  await page.getByRole("button", { name: /edit time entry for/i }).first().click();
  const dialog = page.getByRole("dialog", { name: /edit time entry/i });
  await expect(dialog).toBeVisible();
  return dialog;
}
const reason = (d: ReturnType<Page["getByRole"]>, v: string) => d.getByPlaceholder(/forgot to clock out/i).fill(v);

test.describe("admin: edit, delete and reopen entries", () => {
  test("editing an approved entry's times sends it back to pending approval", async ({ page }) => {
    const e = await makeEntry(PT.tina.employeeId, "2025-08-04", "08:00", "16:00");
    const dialog = await openEdit(page, PT.tina.name, "2025-08-04", "2025-08-04");
    await dialog.locator('input[type="datetime-local"]').nth(1).fill("2025-08-04T17:00");
    await reason(dialog, "Stayed late");
    await dialog.getByRole("button", { name: /save changes/i }).click();
    await expect(toast(page, /pending reapproval/i)).toBeVisible();
    expect(await fresh(e.id)).toMatchObject({ approvalStatus: "PENDING", status: "COMPLETED", totalWorkMin: 540, editReason: "Stayed late" });
    expect(await db.auditLog.count({ where: { action: "time.edit", resource: `TimeEntry:${e.id}` } })).toBe(1);
  });

  test("editing only the notes keeps an approved entry approved", async ({ page }) => {
    const e = await makeEntry(PT.tina.employeeId, "2025-08-04", "08:00", "16:00");
    const dialog = await openEdit(page, PT.tina.name, "2025-08-04", "2025-08-04");
    await dialog.locator("textarea").fill("Checked with supervisor");
    await reason(dialog, "Adding a note");
    await dialog.getByRole("button", { name: /save changes/i }).click();
    await expect(toast(page, /time entry updated\./i)).toBeVisible();
    const after = await fresh(e.id);
    expect(after.approvalStatus).toBe("APPROVED");
    expect(after.timesheetNotes).toBe("Checked with supervisor");
  });

  test("a break can be added in the edit dialog and reduces the hours", async ({ page }) => {
    const e = await makeEntry(PT.tina.employeeId, "2025-08-04", "08:00", "16:00");
    const dialog = await openEdit(page, PT.tina.name, "2025-08-04", "2025-08-04");
    await dialog.getByRole("button", { name: /add break/i }).click();
    const dt = dialog.locator('input[type="datetime-local"]');
    await dt.nth(2).fill("2025-08-04T12:00");
    await dt.nth(3).fill("2025-08-04T12:45");
    await reason(dialog, "Lunch was missing");
    await dialog.getByRole("button", { name: /save changes/i }).click();
    await expect(toast(page, /time entry updated/i)).toBeVisible();
    expect(await fresh(e.id)).toMatchObject({ totalBreakMin: 45, totalWorkMin: 435 });
  });

  test("editing into another entry's time is refused", async ({ page }) => {
    await makeEntry(PT.tina.employeeId, "2025-08-04", "13:00", "17:00");
    const e = await makeEntry(PT.tina.employeeId, "2025-08-04", "08:00", "12:00");
    const dialog = await openEdit(page, PT.tina.name, "2025-08-04", "2025-08-04");
    // The list is newest first, so the first Edit button belongs to the 13:00 entry; edit the morning one instead.
    await dialog.getByRole("button", { name: /cancel/i }).click();
    await page.getByRole("button", { name: /edit time entry for/i }).nth(1).click();
    const d2 = page.getByRole("dialog", { name: /edit time entry/i });
    await d2.locator('input[type="datetime-local"]').nth(1).fill("2025-08-04T14:00");
    await reason(d2, "Extend");
    await d2.getByRole("button", { name: /save changes/i }).click();
    await expect(toast(page, /overlaps another entry/i)).toBeVisible();
    expect((await fresh(e.id)).totalWorkMin).toBe(240);
  });

  test("a clock-in in the future is refused", async ({ page }) => {
    const e = await makeEntry(PT.tina.employeeId, "2025-08-04", "08:00", "16:00");
    const dialog = await openEdit(page, PT.tina.name, "2025-08-04", "2025-08-04");
    await dialog.locator('input[type="datetime-local"]').nth(0).fill("2031-08-04T08:00");
    await dialog.locator('input[type="datetime-local"]').nth(1).fill("2031-08-04T16:00");
    await reason(dialog, "Typo");
    await dialog.getByRole("button", { name: /save changes/i }).click();
    await expect(toast(page, /can.t be in the future/i)).toBeVisible();
    expect((await fresh(e.id)).totalWorkMin).toBe(480);
  });

  test("an entry deleted by someone else gives a clear message", async ({ page }) => {
    const e = await makeEntry(PT.tina.employeeId, "2025-08-04", "08:00", "16:00");
    const dialog = await openEdit(page, PT.tina.name, "2025-08-04", "2025-08-04");
    await db.timeEntry.delete({ where: { id: e.id } });
    await reason(dialog, "Whatever");
    await dialog.getByRole("button", { name: /save changes/i }).click();
    await expect(toast(page, /no longer exists/i)).toBeVisible();
  });

  test("delete needs a reason, asks to confirm, then removes entry and breaks and audits it", async ({ page }) => {
    const e = await makeEntry(PT.tina.employeeId, "2025-08-04", "08:00", "16:00", { breakMin: 30 });
    const dialog = await openEdit(page, PT.tina.name, "2025-08-04", "2025-08-04");
    await dialog.getByRole("button", { name: /^delete$/i }).click();
    await expect(toast(page, /enter a reason/i)).toBeVisible();
    await reason(dialog, "Duplicate");
    await dialog.getByRole("button", { name: /^delete$/i }).click();
    const confirm = page.getByRole("alertdialog", { name: /delete this time entry/i });
    await confirm.getByRole("button", { name: /cancel/i }).click();
    expect(await db.timeEntry.count({ where: { id: e.id } })).toBe(1);
    await dialog.getByRole("button", { name: /^delete$/i }).click();
    await confirm.getByRole("button", { name: /delete entry/i }).click();
    await expect(toast(page, /entry deleted/i)).toBeVisible();
    expect(await db.timeEntry.count({ where: { id: e.id } })).toBe(0);
    expect(await db.timeBreak.count({ where: { timeEntryId: e.id } })).toBe(0);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "time.delete", resource: `TimeEntry:${e.id}` } });
    expect((log.diff as { reason: string }).reason).toBe("Duplicate");
  });

  test("delete failure keeps the entry", async ({ page }) => {
    const e = await makeEntry(PT.tina.employeeId, "2025-08-04", "08:00", "16:00");
    const dialog = await openEdit(page, PT.tina.name, "2025-08-04", "2025-08-04");
    await reason(dialog, "Duplicate");
    await failServerActions(page, "abort");
    await dialog.getByRole("button", { name: /^delete$/i }).click();
    await page.getByRole("button", { name: /delete entry/i }).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    expect(await db.timeEntry.count({ where: { id: e.id } })).toBe(1);
  });

  test("double-clicking Delete entry deletes once", async ({ page }) => {
    const e = await makeEntry(PT.tina.employeeId, "2025-08-04", "08:00", "16:00");
    const dialog = await openEdit(page, PT.tina.name, "2025-08-04", "2025-08-04");
    await reason(dialog, "Duplicate");
    await dialog.getByRole("button", { name: /^delete$/i }).click();
    const calls = await delayServerActions(page, 1200);
    await page.getByRole("button", { name: /delete entry/i }).dblclick();
    await expect(toast(page, /entry deleted/i)).toBeVisible();
    expect(calls.count()).toBe(1);
    expect(await db.timeEntry.count({ where: { id: e.id } })).toBe(0);
  });

  test("reopen turns a closed entry back into an open shift (hours reset, approval cleared)", async ({ page }) => {
    const e = await recent(PT.tina.employeeId, 5, 3);
    const day = businessYmd(0);
    const dialog = await openEdit(page, PT.tina.name, businessYmd(2), day);
    await dialog.getByRole("button", { name: /reopen/i }).click();
    await expect(toast(page, /enter a reason/i)).toBeVisible();
    await reason(dialog, "Clocked out by mistake");
    await dialog.getByRole("button", { name: /reopen/i }).click();
    await expect(toast(page, /entry reopened/i)).toBeVisible();
    expect(await fresh(e.id)).toMatchObject({ status: "ACTIVE", clockOut: null, totalWorkMin: 0, approvalStatus: "PENDING" });
    expect(await db.auditLog.count({ where: { action: "time.reopen", resource: `TimeEntry:${e.id}` } })).toBe(1);
  });

  test("an entry older than 16 hours cannot be reopened", async ({ page }) => {
    const e = await recent(PT.tina.employeeId, 22, 20);
    const dialog = await openEdit(page, PT.tina.name, businessYmd(3), businessYmd(0));
    await reason(dialog, "Try");
    await dialog.getByRole("button", { name: /reopen/i }).click();
    await expect(toast(page, /more than 16 hours ago, so it can.t be reopened/i)).toBeVisible();
    expect((await fresh(e.id)).clockOut).not.toBeNull();
  });

  test("cannot reopen while the employee has another open shift", async ({ page }) => {
    const closed = await recent(PT.tina.employeeId, 10, 8);
    await recent(PT.tina.employeeId, 2, null);
    await page.goto(entriesUrl(PT.tina.name, businessYmd(3), businessYmd(0)));
    await page.getByRole("button", { name: /edit time entry for/i }).nth(1).click();
    const dialog = page.getByRole("dialog", { name: /edit time entry/i });
    await reason(dialog, "Try");
    await dialog.getByRole("button", { name: /reopen/i }).click();
    await expect(toast(page, /currently clocked in on another entry/i)).toBeVisible();
    expect((await fresh(closed.id)).clockOut).not.toBeNull();
  });

  test("reopen failure leaves the entry closed", async ({ page }) => {
    const e = await recent(PT.tina.employeeId, 5, 3);
    const dialog = await openEdit(page, PT.tina.name, businessYmd(2), businessYmd(0));
    await reason(dialog, "Mistake");
    await failServerActions(page, "abort");
    await dialog.getByRole("button", { name: /reopen/i }).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    expect((await fresh(e.id)).clockOut).not.toBeNull();
  });
});

test.describe("admin: needs attention, force clock-out, 16 hour cap", () => {
  const attention = "/admin/time-tracking?tab=attention";

  test("a shift open over 16 hours is listed and Needs attention counts it", async ({ page }) => {
    await recent(PT.fiona.employeeId, 20, null);
    await page.goto(attention);
    await expect(page.getByText(/shifts open over 16 hours \(1\)/i)).toBeVisible();
    const item = page.getByRole("listitem").filter({ hasText: PT.fiona.name });
    await expect(item).toContainText(/never clocked out \(20h ago\)/);
    await expect(page.getByRole("tab", { name: /needs attention \(1\)/i })).toBeVisible();
  });

  test("force clock-out closes at the 16 hour cap, closes open breaks, and queues the entry", async ({ page }) => {
    const e = await recent(PT.fiona.employeeId, 20, null);
    await db.timeBreak.create({ data: { timeEntryId: e.id, startTime: ago(19), endTime: null, type: "BREAK" } });
    await db.timeEntry.update({ where: { id: e.id }, data: { status: "ON_BREAK" } });
    await page.goto(attention);
    await page.getByRole("button", { name: /force clock-out/i }).click();
    const dialog = page.getByRole("dialog", { name: /force clock-out/i });
    await expect(dialog).toContainText(/no more than 16 hours/i);
    await dialog.getByRole("button", { name: /^clock out$/i }).click();
    await expect(toast(page, /clocked out\. the entry is now pending approval/i)).toBeVisible();
    const after = await fresh(e.id);
    expect(after).toMatchObject({ status: "COMPLETED", approvalStatus: "PENDING", autoClosed: false });
    expect(after.editReason).toBe("Forced clock-out: Forgot to clock out");
    const span = after.clockOut!.getTime() - after.clockIn.getTime();
    expect(span).toBeLessThanOrEqual(16 * 3_600_000); // never past the cap (dialog is minute precision)
    expect(span).toBeGreaterThan(16 * 3_600_000 - 60_000);
    expect(after.totalBreakMin).toBeGreaterThan(0);
    expect(after.breaks[0]!.endTime).not.toBeNull();
    expect(await db.auditLog.count({ where: { action: "time.force_clock_out", resource: `TimeEntry:${e.id}` } })).toBe(1);
  });

  test("force clock-out: empty reason, time past the cap, and a stale click are all handled", async ({ page }) => {
    const e = await recent(PT.fiona.employeeId, 20, null);
    await page.goto(attention);
    await page.getByRole("button", { name: /force clock-out/i }).click();
    const dialog = page.getByRole("dialog", { name: /force clock-out/i });
    const clockOut = dialog.locator('input[type="datetime-local"]');
    await dialog.getByRole("textbox").last().fill("");
    await dialog.getByRole("button", { name: /^clock out$/i }).click();
    await expect(toast(page, /check reason/i)).toBeVisible();

    await dialog.getByRole("textbox").last().fill("Forgot to clock out");
    const cap = await clockOut.inputValue();
    // One day after the cap: more than 16 h and also the future-or-not check; the length rule must win.
    await clockOut.fill(cap.replace(/^(\d{4}-\d{2}-)(\d{2})/, (_m, a, d) => `${a}${String(Number(d) + 1).padStart(2, "0")}`));
    await dialog.getByRole("button", { name: /^clock out$/i }).click();
    await expect(toast(page, /can.t be longer than 16 hours|can.t be in the future/i)).toBeVisible();
    expect((await fresh(e.id)).clockOut).toBeNull();

    await clockOut.fill(cap);
    await db.timeEntry.update({ where: { id: e.id }, data: { clockOut: new Date(), status: "COMPLETED" } });
    await dialog.getByRole("button", { name: /^clock out$/i }).click();
    await expect(toast(page, /already closed/i)).toBeVisible();
  });

  test("force clock-out failure keeps the shift open", async ({ page }) => {
    const e = await recent(PT.fiona.employeeId, 20, null);
    await page.goto(attention);
    await page.getByRole("button", { name: /force clock-out/i }).click();
    await failServerActions(page, "abort");
    await page.getByRole("dialog", { name: /force clock-out/i }).getByRole("button", { name: /^clock out$/i }).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect((await fresh(e.id)).clockOut).toBeNull();
  });

  test("double-clicking Clock out closes once", async ({ page }) => {
    const e = await recent(PT.fiona.employeeId, 20, null);
    await page.goto(attention);
    await page.getByRole("button", { name: /force clock-out/i }).click();
    const calls = await delayServerActions(page, 1200);
    await page.getByRole("dialog", { name: /force clock-out/i }).getByRole("button", { name: /^clock out$/i }).dblclick();
    await expect(toast(page, /clocked out/i)).toBeVisible();
    expect(calls.count()).toBe(1);
    expect((await fresh(e.id)).status).toBe("COMPLETED");
  });

  test("an auto-closed shift is flagged in Needs attention, the pending queue and the entries list", async ({ page }) => {
    await recent(PT.alma.employeeId, 30, 14, { approval: "PENDING", autoClosed: true, editReason: "Auto-closed: shift ran longer than 16 hours (counted time capped). Needs admin review." });
    await page.goto(attention);
    await expect(page.getByText(/auto-closed at the cap, awaiting review \(1\)/i)).toBeVisible();
    await expect(page.getByText(/auto-closed at the 16 hour cap\. verify the hours/i)).toBeVisible();
    await page.goto(entriesUrl(PT.alma.name, businessYmd(3), businessYmd(0)));
    await expect(page.getByText("Auto-closed", { exact: true })).toBeVisible();
  });

  test("editing an auto-closed entry clears the auto-closed flag", async ({ page }) => {
    const e = await recent(PT.alma.employeeId, 30, 14, { approval: "PENDING", autoClosed: true });
    await page.goto(attention);
    await page.getByRole("button", { name: /edit time entry for/i }).first().click();
    const dialog = page.getByRole("dialog", { name: /edit time entry/i });
    await reason(dialog, "Verified with supervisor");
    await dialog.getByRole("button", { name: /save changes/i }).click();
    await expect(toast(page, /time entry updated/i)).toBeVisible();
    expect((await fresh(e.id)).autoClosed).toBe(false);
  });

  test("Clocked in tab lists an open shift under 16 hours as Working or On break", async ({ page }) => {
    await recent(PT.fiona.employeeId, 2, null);
    await page.goto("/admin/time-tracking?tab=now");
    await expect(page.getByRole("listitem").filter({ hasText: PT.fiona.name })).toContainText("Working");
    await expect(page.getByText(/shifts open over 16 hours/i)).toHaveCount(0);
  });
});
