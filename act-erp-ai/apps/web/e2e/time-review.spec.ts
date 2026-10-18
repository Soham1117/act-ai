import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { db } from "./support/db";
import { delayServerActions, expectNoCrash, failServerActions, toast } from "./support/helpers";
import { PT, clearEntries, makeEntry, sessionFor } from "./support/payroll-time";
import { ADMIN_STATE } from "./support/test-data";
import { NETWORK_ERROR } from "./support/action-errors";

const pendingUrl = (name: string) => `/admin/time-tracking?tab=pending&q=${encodeURIComponent(name)}`;
/** Rex also has a seeded pending entry (March); always act on the Jul 7 row this test created. */
const jul7 = (page: Page) => page.getByRole("listitem").filter({ hasText: "Jul 7, 2025" });
const statusOf = (id: string) => db.timeEntry.findUniqueOrThrow({ where: { id } });

test.afterEach(async () => {
  await clearEntries(PT.bruno.employeeId);
  await clearEntries(PT.rex.employeeId, { date: { gte: new Date("2025-07-01T00:00:00Z"), lt: new Date("2026-01-01T00:00:00Z") } });
});

test.describe("time review: admin without an employee profile", () => {
  test.use({ storageState: ADMIN_STATE });

  test("approving is refused with a clear message and the entry stays pending", async ({ page }) => {
    const e = await makeEntry(PT.rex.employeeId, "2025-07-07", "08:00", "16:00", { approval: "PENDING" });
    await page.goto(pendingUrl(PT.rex.name));
    await jul7(page).getByRole("button", { name: /^approve$/i }).click();
    await expect(toast(page, /no employee profile linked/i)).toBeVisible();
    expect((await statusOf(e.id)).approvalStatus).toBe("PENDING");
  });

  test("bulk approve is refused the same way", async ({ page }) => {
    const e = await makeEntry(PT.rex.employeeId, "2025-07-07", "08:00", "16:00", { approval: "PENDING" });
    await page.goto(pendingUrl(PT.rex.name));
    await jul7(page).getByRole("checkbox", { name: /select entry/i }).check();
    await page.getByRole("button", { name: /approve selected/i }).click();
    await expect(toast(page, /no employee profile linked/i)).toBeVisible();
    expect((await statusOf(e.id)).approvalStatus).toBe("PENDING");
  });
});

test.describe("time review: admin with an employee profile", () => {
  let ctx: BrowserContext;
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    ctx = await sessionFor(browser, "alice", PT.alice.email);
    page = await ctx.newPage();
  });
  test.afterAll(() => ctx?.close());

  const alice = () => db.employee.findUniqueOrThrow({ where: { employeeId: PT.alice.employeeId } });

  test("approve: status, approver, audit record and employee notification", async () => {
    const e = await makeEntry(PT.rex.employeeId, "2025-07-07", "08:00", "16:00", { approval: "PENDING" });
    await page.goto(pendingUrl(PT.rex.name));
    await jul7(page).getByRole("button", { name: /^approve$/i }).click();
    await expect(toast(page, /^approved$/i)).toBeVisible();
    const after = await statusOf(e.id);
    expect(after).toMatchObject({ approvalStatus: "APPROVED", status: "APPROVED", approvedById: (await alice()).id });
    expect(after.approvalDate).not.toBeNull();
    expect(await db.auditLog.count({ where: { action: "time.approve", resource: `TimeEntry:${e.id}` } })).toBe(1);
    expect(
      await db.notificationRecipient.count({
        where: { employee: { employeeId: PT.rex.employeeId }, notification: { title: "Timesheet approved" } },
      }),
    ).toBeGreaterThanOrEqual(1);
  });

  test("reject needs a reason of at least 3 characters and the employee sees it", async () => {
    const e = await makeEntry(PT.rex.employeeId, "2025-07-07", "08:00", "16:00", { approval: "PENDING" });
    await page.goto(pendingUrl(PT.rex.name));
    await jul7(page).getByRole("button", { name: "Reject", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: /reject time entry/i });
    const reject = dialog.getByRole("button", { name: /^reject$/i });
    await expect(reject).toBeDisabled();
    await dialog.getByRole("textbox").fill("ab");
    await expect(reject).toBeDisabled();
    await dialog.getByRole("textbox").fill("Wrong job code");
    await reject.click();
    await expect(toast(page, /^rejected$/i)).toBeVisible();
    expect(await statusOf(e.id)).toMatchObject({ approvalStatus: "REJECTED", status: "REJECTED", approvalNotes: "Wrong job code" });
    const note = await db.notificationRecipient.findFirst({
      where: { employee: { employeeId: PT.rex.employeeId }, notification: { title: "Timesheet rejected" } },
      include: { notification: true },
    });
    expect(note?.notification.message).toContain("Reason: Wrong job code");
  });

  test("bulk approve with select-all", async () => {
    const a = await makeEntry(PT.bruno.employeeId, "2025-07-07", "08:00", "16:00", { approval: "PENDING" });
    const b = await makeEntry(PT.bruno.employeeId, "2025-07-08", "08:00", "16:00", { approval: "PENDING" });
    await page.goto(pendingUrl(PT.bruno.name));
    await page.getByRole("checkbox", { name: /select all on this page/i }).check();
    await expect(page.getByText("2 selected")).toBeVisible();
    await page.getByRole("button", { name: /approve selected/i }).click();
    await expect(toast(page, /2 approved/i)).toBeVisible();
    for (const id of [a.id, b.id]) expect((await statusOf(id)).approvalStatus).toBe("APPROVED");
    expect(await db.auditLog.count({ where: { action: "time.bulk_approve" } })).toBeGreaterThanOrEqual(1);
  });

  test("bulk reject needs a shared reason", async () => {
    const a = await makeEntry(PT.bruno.employeeId, "2025-07-07", "08:00", "16:00", { approval: "PENDING" });
    const b = await makeEntry(PT.bruno.employeeId, "2025-07-08", "08:00", "16:00", { approval: "PENDING" });
    await page.goto(pendingUrl(PT.bruno.name));
    await expect(page.getByRole("button", { name: /reject selected/i })).toBeDisabled(); // nothing selected
    await page.getByRole("checkbox", { name: /select all on this page/i }).check();
    await page.getByRole("button", { name: /reject selected/i }).click();
    const dialog = page.getByRole("dialog", { name: /reject 2 entries/i });
    await expect(dialog.getByRole("button", { name: /^reject$/i })).toBeDisabled();
    await dialog.getByRole("textbox").fill("Not approved by supervisor");
    await dialog.getByRole("button", { name: /^reject$/i }).click();
    await expect(toast(page, /2 rejected/i)).toBeVisible();
    for (const id of [a.id, b.id]) expect(await statusOf(id)).toMatchObject({ approvalStatus: "REJECTED", approvalNotes: "Not approved by supervisor" });
  });

  test("an entry decided by someone else meanwhile is skipped and reported", async () => {
    const a = await makeEntry(PT.bruno.employeeId, "2025-07-07", "08:00", "16:00", { approval: "PENDING" });
    const b = await makeEntry(PT.bruno.employeeId, "2025-07-08", "08:00", "16:00", { approval: "PENDING" });
    await page.goto(pendingUrl(PT.bruno.name));
    await page.getByRole("checkbox", { name: /select all on this page/i }).check();
    await db.timeEntry.update({ where: { id: b.id }, data: { approvalStatus: "REJECTED", status: "REJECTED", approvalNotes: "x" } });
    await page.getByRole("button", { name: /approve selected/i }).click();
    await expect(toast(page, /1 approved \(1 skipped: no longer pending\)/i)).toBeVisible();
    expect((await statusOf(a.id)).approvalStatus).toBe("APPROVED");
    expect((await statusOf(b.id)).approvalStatus).toBe("REJECTED");
  });

  test("when every selected entry was already decided, nothing is changed and the user is told", async () => {
    const a = await makeEntry(PT.bruno.employeeId, "2025-07-07", "08:00", "16:00", { approval: "PENDING" });
    await page.goto(pendingUrl(PT.bruno.name));
    await page.getByRole("checkbox", { name: /select all on this page/i }).check();
    await db.timeEntry.update({ where: { id: a.id }, data: { approvalStatus: "APPROVED", status: "APPROVED" } });
    await page.getByRole("button", { name: /approve selected/i }).click();
    await expect(toast(page, /none of the selected entries are pending review any more/i)).toBeVisible();
  });

  test("single approve of an entry someone else deleted", async () => {
    const e = await makeEntry(PT.rex.employeeId, "2025-07-07", "08:00", "16:00", { approval: "PENDING" });
    await page.goto(pendingUrl(PT.rex.name));
    await db.timeEntry.delete({ where: { id: e.id } });
    await jul7(page).getByRole("button", { name: /^approve$/i }).click();
    await expect(toast(page, /no longer exists/i)).toBeVisible();
  });

  test("single approve of an entry someone else already decided", async () => {
    const e = await makeEntry(PT.rex.employeeId, "2025-07-07", "08:00", "16:00", { approval: "PENDING" });
    await page.goto(pendingUrl(PT.rex.name));
    await db.timeEntry.update({ where: { id: e.id }, data: { approvalStatus: "APPROVED", status: "APPROVED" } });
    await jul7(page).getByRole("button", { name: /^approve$/i }).click();
    await expect(toast(page, /was already approved/i)).toBeVisible();
  });

  test("server failure on approve: error shown, entry stays pending", async () => {
    const e = await makeEntry(PT.rex.employeeId, "2025-07-07", "08:00", "16:00", { approval: "PENDING" });
    await page.goto(pendingUrl(PT.rex.name));
    await failServerActions(page, "abort");
    await jul7(page).getByRole("button", { name: /^approve$/i }).click();
    await expect(toast(page, NETWORK_ERROR)).toBeVisible();
    await expectNoCrash(page);
    expect((await statusOf(e.id)).approvalStatus).toBe("PENDING");
    await page.unroute("**/*");
  });

  test("double-clicking Approve makes one decision", async () => {
    const e = await makeEntry(PT.rex.employeeId, "2025-07-07", "08:00", "16:00", { approval: "PENDING" });
    await page.goto(pendingUrl(PT.rex.name));
    const calls = await delayServerActions(page, 1200);
    await jul7(page).getByRole("button", { name: /^approve$/i }).dblclick();
    await expect(toast(page, /^approved$/i)).toBeVisible();
    expect(calls.count()).toBe(1);
    expect(await db.auditLog.count({ where: { action: "time.approve", resource: `TimeEntry:${e.id}` } })).toBe(1);
    await page.unroute("**/*");
  });

  test("approving an entry moves its hours onto the payroll slip", async () => {
    // Rex has a pending entry in period A (seeded). Approve a fresh one on 2025-03-12 and look at the slip.
    const e = await makeEntry(PT.bruno.employeeId, "2025-03-12", "08:00", "12:00", { approval: "PENDING" });
    const period = await db.payrollCalendar.findFirstOrThrow({ where: { title: "PT Period A" } });
    await page.goto(`/admin/payroll/${period.id}`);
    await expect(page.locator("table").nth(1).getByRole("row").filter({ hasText: PT.bruno.name })).toHaveCount(0);
    await page.goto(pendingUrl(PT.bruno.name));
    await page.getByRole("button", { name: /^approve$/i }).click();
    await expect(toast(page, /^approved$/i)).toBeVisible();
    await page.goto(`/admin/payroll/${period.id}`);
    const row = page.locator("table").nth(1).getByRole("row").filter({ hasText: PT.bruno.name });
    await expect(row.getByRole("cell").nth(6)).toHaveText("4.00");
    expect((await statusOf(e.id)).approvalStatus).toBe("APPROVED");
  });
});
