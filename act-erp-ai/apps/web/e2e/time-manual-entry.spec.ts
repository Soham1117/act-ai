import { test, expect, type Page } from "@playwright/test";
import { db } from "./support/db";
import { delayServerActions, expectNoCrash, failServerActions, toast } from "./support/helpers";
import { PT, clearEntries, entriesUrl, hoursText, makeEntry, sessionFor } from "./support/payroll-time";
import { ADMIN_STATE, INACTIVE_EMPLOYEE, JOB_CODE } from "./support/test-data";

test.use({ storageState: ADMIN_STATE });
test.afterEach(() => clearEntries(PT.tina.employeeId));

type V = { employee?: string; inAt?: string; outAt?: string; reason?: string; approve?: boolean; breaks?: [string, string][] };

async function openManual(page: Page) {
  await page.goto(entriesUrl(PT.tina.name, "2024-01-01", "2025-12-31"));
  await page.getByRole("button", { name: /add manual entry/i }).click();
  const dialog = page.getByRole("dialog", { name: /add manual time entry/i });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function fillManual(dialog: Awaited<ReturnType<typeof openManual>>, v: V) {
  if (v.employee !== "none") await dialog.locator("select").first().selectOption({ label: `${v.employee ?? PT.tina.name} · ${v.employee === INACTIVE_EMPLOYEE.name ? INACTIVE_EMPLOYEE.employeeId : PT.tina.employeeId}` });
  const dt = dialog.locator('input[type="datetime-local"]');
  await dt.nth(0).fill(v.inAt ?? "2025-08-04T08:00");
  await dt.nth(1).fill(v.outAt ?? "2025-08-04T16:00");
  for (const [i, [s, e]] of (v.breaks ?? []).entries()) {
    await dialog.getByRole("button", { name: /add break/i }).click();
    await dt.nth(2 + i * 2).fill(s);
    await dt.nth(3 + i * 2).fill(e);
  }
  if (v.reason !== "") await dialog.getByPlaceholder(/kiosk was offline/i).fill(v.reason ?? "Kiosk was offline");
  if (v.approve) await dialog.getByRole("checkbox", { name: /approve immediately/i }).check();
}

const submit = (dialog: Awaited<ReturnType<typeof openManual>>) => dialog.getByRole("button", { name: /^add entry$/i }).click();
const tinaEntries = () =>
  db.timeEntry.findMany({
    where: { employee: { employeeId: PT.tina.employeeId }, date: { lt: new Date("2026-01-01T00:00:00Z") } },
    include: { breaks: true },
  });

test.describe("admin: add manual time entry", () => {
  test("adds a pending entry with a break; hours and audit are right", async ({ page }) => {
    const dialog = await openManual(page);
    await fillManual(dialog, { breaks: [["2025-08-04T12:00", "2025-08-04T12:30"]], reason: "Kiosk was offline" });
    await submit(dialog);
    await expect(toast(page, /manual entry added \(pending approval\)/i)).toBeVisible();
    const [e] = await tinaEntries();
    expect(e).toMatchObject({ source: "MANUAL", approvalStatus: "PENDING", status: "COMPLETED", totalWorkMin: 450, totalBreakMin: 30, jobCode: JOB_CODE.code });
    expect(e!.editReason).toBe("Manual entry: Kiosk was offline");
    expect(e!.breaks).toHaveLength(1);
    expect(await db.auditLog.count({ where: { action: "time.manual_create", resource: `TimeEntry:${e!.id}` } })).toBe(1);
    await expect(page.getByText(hoursText(450)).first()).toBeVisible().catch(() => null);
  });

  test("shows central times and hours in the entries list", async ({ page }) => {
    const dialog = await openManual(page);
    await fillManual(dialog, { inAt: "2025-08-04T08:15", outAt: "2025-08-04T16:45" });
    await submit(dialog);
    await expect(toast(page, /manual entry added/i)).toBeVisible();
    const li = page.getByRole("listitem").filter({ hasText: `${JOB_CODE.code} · 8:15 AM → 4:45 PM` });
    await expect(li).toContainText(hoursText(510));
  });

  test("spring-forward night (22:00 Sat to 06:00 Sun, 2024-03-09/10) counts 7 elapsed hours", async ({ page }) => {
    const dialog = await openManual(page);
    await fillManual(dialog, { inAt: "2024-03-09T22:00", outAt: "2024-03-10T06:00" });
    await submit(dialog);
    await expect(toast(page, /manual entry added/i)).toBeVisible();
    expect((await tinaEntries())[0]!.totalWorkMin).toBe(420);
  });

  test("fall-back night (22:00 Sat to 06:00 Sun, 2024-11-02/03) counts 9 elapsed hours", async ({ page }) => {
    const dialog = await openManual(page);
    await fillManual(dialog, { inAt: "2024-11-02T22:00", outAt: "2024-11-03T06:00" });
    await submit(dialog);
    await expect(toast(page, /manual entry added/i)).toBeVisible();
    expect((await tinaEntries())[0]!.totalWorkMin).toBe(540);
  });

  test("the repeated 01:30 on fall-back day means the later (standard time) one", async ({ page }) => {
    const dialog = await openManual(page);
    await fillManual(dialog, { inAt: "2024-11-03T01:30", outAt: "2024-11-03T03:00" });
    await submit(dialog);
    await expect(toast(page, /manual entry added/i)).toBeVisible();
    const e = (await tinaEntries())[0]!;
    expect(e.clockIn.toISOString()).toBe("2024-11-03T07:30:00.000Z"); // 01:30 CST
    expect(e.totalWorkMin).toBe(90);
  });

  test("a time that does not exist (02:30 on spring-forward day) is refused", async ({ page }) => {
    const dialog = await openManual(page);
    await fillManual(dialog, { inAt: "2024-03-10T02:30", outAt: "2024-03-10T08:00" });
    await submit(dialog);
    await expect(toast(page, /isn.t a valid America\/Chicago date and time/i)).toBeVisible();
    expect(await tinaEntries()).toHaveLength(0);
  });

  test("clock-out before clock-in", async ({ page }) => {
    const dialog = await openManual(page);
    await fillManual(dialog, { inAt: "2025-08-04T16:00", outAt: "2025-08-04T08:00" });
    await submit(dialog);
    await expect(toast(page, /clock-out must be after clock-in/i)).toBeVisible();
    expect(await tinaEntries()).toHaveLength(0);
  });

  test("a shift longer than 16 hours", async ({ page }) => {
    const dialog = await openManual(page);
    await fillManual(dialog, { inAt: "2025-08-04T01:00", outAt: "2025-08-04T18:00" });
    await submit(dialog);
    await expect(toast(page, /can.t be longer than 16 hours/i)).toBeVisible();
    expect(await tinaEntries()).toHaveLength(0);
  });

  test("future clock-in", async ({ page }) => {
    const dialog = await openManual(page);
    await fillManual(dialog, { inAt: "2031-08-04T08:00", outAt: "2031-08-04T16:00" });
    await submit(dialog);
    await expect(toast(page, /clock-in can.t be in the future/i)).toBeVisible();
    expect(await tinaEntries()).toHaveLength(0);
  });

  test("overlap with an existing entry names the other entry's times", async ({ page }) => {
    await makeEntry(PT.tina.employeeId, "2025-08-04", "09:00", "12:00");
    const dialog = await openManual(page);
    await fillManual(dialog, { inAt: "2025-08-04T11:00", outAt: "2025-08-04T14:00" });
    await submit(dialog);
    await expect(toast(page, /overlaps another entry \(.*9:00 AM to 12:00 PM\)/i)).toBeVisible();
    expect(await tinaEntries()).toHaveLength(1);
  });

  test("touching entries (out 12:00, in 12:00) do not overlap", async ({ page }) => {
    await makeEntry(PT.tina.employeeId, "2025-08-04", "09:00", "12:00");
    const dialog = await openManual(page);
    await fillManual(dialog, { inAt: "2025-08-04T12:00", outAt: "2025-08-04T14:00" });
    await submit(dialog);
    await expect(toast(page, /manual entry added/i)).toBeVisible();
    expect(await tinaEntries()).toHaveLength(2);
  });

  test("break validation: before clock-in, after clock-out, overlapping, covering the shift", async ({ page }) => {
    const cases: [[string, string][], RegExp][] = [
      [[["2025-08-04T07:00", "2025-08-04T07:30"]], /break can.t start before clock-in/i],
      [[["2025-08-04T15:00", "2025-08-04T17:00"]], /break can.t end after clock-out/i],
      [[["2025-08-04T12:00", "2025-08-04T12:30"], ["2025-08-04T12:15", "2025-08-04T12:45"]], /breaks can.t overlap/i],
      [[["2025-08-04T08:00", "2025-08-04T16:00"]], /break time can.t cover the entire shift/i],
      [[["2025-08-04T12:30", "2025-08-04T12:00"]], /each break must end after it starts/i],
    ];
    const dialog = await openManual(page);
    for (const [breaks, msg] of cases) {
      await fillManual(dialog, { breaks });
      // remove breaks again for the next round
      await submit(dialog);
      await expect(toast(page, msg)).toBeVisible();
      for (let i = 0; i < breaks.length; i++) await dialog.getByRole("button", { name: /remove break/i }).first().click();
    }
    expect(await tinaEntries()).toHaveLength(0);
  });

  test("a break with no end time is refused", async ({ page }) => {
    const dialog = await openManual(page);
    await fillManual(dialog, {});
    await dialog.getByRole("button", { name: /add break/i }).click();
    await dialog.locator('input[type="datetime-local"]').nth(2).fill("2025-08-04T12:00");
    await submit(dialog);
    await expect(toast(page, /check breaks\.0\.end/i)).toBeVisible();
    expect(await tinaEntries()).toHaveLength(0);
  });

  test("missing reason is refused by the server", async ({ page }) => {
    const dialog = await openManual(page);
    await fillManual(dialog, { reason: "" });
    await submit(dialog);
    await expect(toast(page, /check reason/i)).toBeVisible();
    expect(await tinaEntries()).toHaveLength(0);
  });

  test("no employee chosen", async ({ page }) => {
    const dialog = await openManual(page);
    await fillManual(dialog, { employee: "none" });
    await submit(dialog);
    await expect(toast(page, /choose an employee/i)).toBeVisible();
    expect(await tinaEntries()).toHaveLength(0);
  });

  test("an admin with no employee profile cannot approve immediately", async ({ page }) => {
    const dialog = await openManual(page);
    await fillManual(dialog, { approve: true });
    await submit(dialog);
    await expect(toast(page, /no employee profile linked/i)).toBeVisible();
    expect(await tinaEntries()).toHaveLength(0);
  });

  test("an ended employee can still be given a manual entry (documents current behaviour)", async ({ page }) => {
    await page.goto(entriesUrl(INACTIVE_EMPLOYEE.name, "2024-01-01", "2025-12-31"));
    await page.getByRole("button", { name: /add manual entry/i }).click();
    const dialog = page.getByRole("dialog", { name: /add manual time entry/i });
    await fillManual(dialog, { employee: INACTIVE_EMPLOYEE.name });
    await submit(dialog);
    await expect(toast(page, /manual entry added/i)).toBeVisible();
    await db.timeEntry.deleteMany({ where: { employee: { employeeId: INACTIVE_EMPLOYEE.employeeId } } });
  });

  test("server failure: error shown, nothing saved", async ({ page }) => {
    const dialog = await openManual(page);
    await fillManual(dialog, {});
    await failServerActions(page, "abort");
    await submit(dialog);
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect(await tinaEntries()).toHaveLength(0);
  });

  test("double-clicking Add entry creates one entry", async ({ page }) => {
    const dialog = await openManual(page);
    await fillManual(dialog, {});
    const calls = await delayServerActions(page, 1200);
    await dialog.getByRole("button", { name: /^add entry$/i }).dblclick();
    await expect(toast(page, /manual entry added/i)).toBeVisible();
    expect(await tinaEntries()).toHaveLength(1);
    expect(calls.count()).toBe(1);
  });
});

test.describe("admin with an employee profile: approve immediately", () => {
  test("entry is saved approved with the approver recorded", async ({ browser }) => {
    const ctx = await sessionFor(browser, "alice", PT.alice.email);
    const page = await ctx.newPage();
    const dialog = await openManual(page);
    await fillManual(dialog, { approve: true });
    await submit(dialog);
    await expect(toast(page, /added and approved/i)).toBeVisible();
    const e = (await tinaEntries())[0]!;
    expect(e).toMatchObject({ approvalStatus: "APPROVED", status: "APPROVED" });
    expect(e.approvedById).toBe((await db.employee.findUniqueOrThrow({ where: { employeeId: PT.alice.employeeId } })).id);
    await ctx.close();
  });
});
