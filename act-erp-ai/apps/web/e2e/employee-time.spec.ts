import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { businessYmd, db } from "./support/db";
import { PT, hoursText, makeEntry, sessionFor } from "./support/payroll-time";

let ctx: BrowserContext;
let page: Page;
const created: string[] = [];

test.beforeAll(async ({ browser }) => {
  ctx = await sessionFor(browser, "ella", PT.ella.email);
  page = await ctx.newPage();
});
test.afterAll(() => ctx?.close());
test.afterEach(async () => {
  await db.timeEntry.deleteMany({ where: { id: { in: created.splice(0) } } });
});

async function nowEntry(inH: number, outH: number | null, extra: Parameters<typeof makeEntry>[4] = {}) {
  const clockIn = new Date(Date.now() - inH * 3_600_000);
  const e = await makeEntry(PT.ella.employeeId, businessYmd(0), "00:00", null, {
    clockInAt: clockIn,
    clockOutAt: outH === null ? null : new Date(Date.now() - outH * 3_600_000),
    open: outH === null,
    ...extra,
  });
  const date = new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(clockIn)}T00:00:00Z`);
  await db.timeEntry.update({ where: { id: e.id }, data: { date } });
  created.push(e.id);
  return e;
}

const status = () => page.getByText("Current status").locator("..");

test.describe("employee timesheet page", () => {
  test("shows the timesheet, points to the kiosk, and has no web clock buttons", async () => {
    await page.goto("/dashboard/time-tracking");
    await expect(page.getByRole("heading", { name: "Timesheet" })).toBeVisible();
    await expect(page.getByText(/clock in\/out at a kiosk/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /clock in|clock out|start break|end break/i })).toHaveCount(0);
  });

  test("lists only the employee's own entries, in Central time, with breaks taken off", async () => {
    await page.goto("/dashboard/time-tracking");
    const row = page.getByRole("listitem").filter({ hasText: "Jun 2, 2025" });
    await expect(row).toHaveCount(1); // Pia also worked Jun 2; hers must not show
    await expect(row).toContainText("8:00 AM → 4:30 PM");
    await expect(row).toContainText("8h 00m"); // 8.5h minus a 30 minute break
    await expect(row).toContainText("APPROVED");
    await expect(page.getByText("PIA-PRIVATE-NOTE")).toHaveCount(0);
    const count = await page.getByRole("listitem").filter({ hasText: /→/ }).count();
    expect(count).toBe(await db.timeEntry.count({ where: { employee: { employeeId: PT.ella.employeeId } } }));
  });

  test("pending, rejected (with the reason) and edited entries explain themselves", async () => {
    // "Edited by an admin" needs lastEditedById; the seed leaves it empty.
    const admin = await db.user.findFirstOrThrow({ where: { role: "ADMIN", employee: null } });
    await db.timeEntry.updateMany({
      where: { employee: { employeeId: PT.ella.employeeId }, date: new Date("2025-06-05T00:00:00Z") },
      data: { lastEditedById: admin.id },
    });
    await page.goto("/dashboard/time-tracking");
    await expect(page.getByRole("listitem").filter({ hasText: "Jun 3, 2025" })).toContainText("PENDING");
    const rejected = page.getByRole("listitem").filter({ hasText: "Jun 4, 2025" });
    await expect(rejected).toContainText(/Rejected: Overlaps training day\.? Talk to an admin if a correction is needed\./);
    await expect(rejected.getByText("4h 00m")).toHaveClass(/line-through/);
    const edited = page.getByRole("listitem").filter({ hasText: "Jun 5, 2025" });
    await expect(edited).toContainText("Admin note: Thanks for the extra hour");
    await expect(edited).toContainText("Edited by an admin. Clock-out corrected");
  });

  // BUG (cosmetic): time-entries-list.tsx builds "Rejected{: note}{ Talk to an admin...}" so the reason runs into the next
  // sentence ("Overlaps training day Talk to an admin"). Proposed fix: add a "." after the note when one is shown.
  test("the rejection reason is separated from the next sentence by a full stop", async () => {
    await page.goto("/dashboard/time-tracking");
    await expect(page.getByRole("listitem").filter({ hasText: "Jun 4, 2025" })).toContainText("Overlaps training day. Talk to an admin");
  });

  test("an auto-closed entry is labelled as waiting for admin review", async () => {
    await nowEntry(30, 14, { approval: "PENDING", autoClosed: true, editReason: "Auto-closed: shift ran longer than 16 hours (counted time capped). Needs admin review." });
    await page.goto("/dashboard/time-tracking");
    await expect(page.getByText(/auto-closed \(pending admin review\)/i)).toBeVisible();
  });

  test("status card: clocked out, clocked in, on break, and the over-16-hours warning", async () => {
    await page.goto("/dashboard/time-tracking");
    await expect(status()).toContainText("Clocked out");

    const open = await nowEntry(2, null);
    await page.reload();
    await expect(status()).toContainText("Clocked in");
    await expect(status()).toContainText(/Since \d{1,2}:\d{2} [AP]M · E2E100/);
    await expect(page.getByText(/open over 16 hours/i)).toHaveCount(0);

    await db.timeEntry.update({ where: { id: open.id }, data: { status: "ON_BREAK" } });
    await page.reload();
    await expect(status()).toContainText("On break");

    await db.timeEntry.update({ where: { id: open.id }, data: { clockIn: new Date(Date.now() - 20 * 3_600_000) } });
    await page.reload();
    await expect(page.getByText(/open over 16 hours\. it will be closed and sent to an admin for review at your next punch/i)).toBeVisible();
  });

  test("hours this week and this month follow the entries and skip rejected ones", async () => {
    await nowEntry(3, 1); // 2h, pending
    await nowEntry(6, 4, { approval: "REJECTED", approvalNotes: "no" }); // must not count
    const today = new Date(`${businessYmd(0)}T00:00:00Z`);
    const monday = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * 86_400_000);
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const sum = async (from: Date) =>
      (
        await db.timeEntry.aggregate({
          _sum: { totalWorkMin: true },
          where: { employee: { employeeId: PT.ella.employeeId }, date: { gte: from }, approvalStatus: { not: "REJECTED" } },
        })
      )._sum.totalWorkMin ?? 0;
    await page.goto("/dashboard/time-tracking");
    await expect(page.getByText("Hours this week").locator("xpath=../..")).toContainText(hoursText(await sum(monday)));
    await expect(page.getByText("Hours this month").locator("xpath=../..")).toContainText(hoursText(await sum(monthStart)));
    expect(await sum(monday)).toBeGreaterThanOrEqual(120);
  });

  test("an admin account with no employee profile sees the 'No employee record' message", async ({ browser }) => {
    const admin = await browser.newContext({ storageState: "e2e/.auth/admin.json" });
    const p = await admin.newPage();
    await p.goto("/dashboard/time-tracking");
    await expect(p.getByText("No employee record")).toBeVisible();
    await admin.close();
  });

  test("a signed-out visitor is sent to the login page", async ({ browser }) => {
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const p = await anon.newPage();
    await p.goto("/dashboard/time-tracking");
    await expect(p).toHaveURL(/\/login/);
    await anon.close();
  });
});
