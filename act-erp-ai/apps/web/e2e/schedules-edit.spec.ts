import { test, expect, type Page } from "@playwright/test";
import { db } from "./support/db";
import { NETWORK_ERROR, SERVER_ERROR, STALE_ERROR } from "./support/action-errors";
import { delayServerActions, expectNoCrash, failServerActions, toast } from "./support/helpers";
import { ADMIN_STATE, INACTIVE_JOB_CODE } from "./support/test-data";
import {
  DELETED_JOB_CODE,
  DEPT_A,
  JOB_CODE_2,
  SAM,
  TARA,
  TERRY,
  WES,
  WES_SHIFTS,
  calEvents,
  cleanupScheduleRows,
  endInput,
  gotoMonth,
  insertShift,
  localYmd,
  shiftsOf,
  startInput,
} from "./support/schedules";

test.use({ storageState: ADMIN_STATE });
test.beforeEach(cleanupScheduleRows);
test.afterEach(cleanupScheduleRows);

async function openEdit(page: Page, name: string) {
  await page.goto("/admin/schedules");
  await calEvents(page, name).first().click();
  const dialog = page.getByRole("dialog", { name: /edit shift/i });
  await expect(dialog).toBeVisible();
  return dialog;
}
const save = (d: ReturnType<Page["locator"]>) => d.getByRole("button", { name: /^save$/i });

test.describe("admin edits a shift", () => {
  test("change times: saved, calendar updated, employee notified", async ({ page }) => {
    await insertShift({ employeeId: SAM.employeeId, date: localYmd(), start: "08:00", end: "12:00" });
    const dialog = await openEdit(page, SAM.name);
    await expect(startInput(dialog)).toHaveValue("08:00");
    await startInput(dialog).fill("09:30");
    await endInput(dialog).fill("13:00");
    await save(dialog).click();
    await expect(toast(page, /shift updated/i)).toBeVisible();
    expect((await shiftsOf(SAM.employeeId))[0]).toMatchObject({ startTime: "09:30", endTime: "13:00" });
    await expect(calEvents(page, SAM.name).first()).toContainText("9:30 AM");
    expect(await db.notification.count({ where: { type: "SCHEDULE", title: "Your shift was changed" } })).toBe(1);
  });

  test("change job code and notes", async ({ page }) => {
    await insertShift({ employeeId: SAM.employeeId, date: localYmd(), start: "08:00", end: "12:00", notes: "old" });
    const dialog = await openEdit(page, SAM.name);
    await dialog.getByRole("combobox").click();
    await page.getByRole("option", { name: new RegExp(JOB_CODE_2.code) }).click();
    await dialog.locator("textarea").fill("");
    await save(dialog).click();
    await expect(toast(page, /shift updated/i)).toBeVisible();
    expect((await shiftsOf(SAM.employeeId))[0]).toMatchObject({ jobCode: JOB_CODE_2.code, notes: null });
  });

  test("saving without changes sends no notification", async ({ page }) => {
    await insertShift({ employeeId: SAM.employeeId, date: localYmd(), start: "08:00", end: "12:00" });
    const dialog = await openEdit(page, SAM.name);
    await save(dialog).click();
    await expect(toast(page, /shift updated/i)).toBeVisible();
    expect(await db.notification.count({ where: { type: "SCHEDULE" } })).toBe(0);
  });

  test("edit to overnight", async ({ page }) => {
    await insertShift({ employeeId: SAM.employeeId, date: localYmd(), start: "08:00", end: "12:00" });
    const dialog = await openEdit(page, SAM.name);
    await startInput(dialog).fill("22:00");
    await endInput(dialog).fill("06:00");
    await save(dialog).click();
    await expect(toast(page, /shift updated/i)).toBeVisible();
    await expect(calEvents(page, SAM.name).first()).toContainText("(+1 day)");
  });

  test("same start and end is rejected", async ({ page }) => {
    await insertShift({ employeeId: SAM.employeeId, date: localYmd(), start: "08:00", end: "12:00" });
    const dialog = await openEdit(page, SAM.name);
    await endInput(dialog).fill("08:00");
    await save(dialog).click();
    await expect(toast(page, /start and end can.t be the same/i)).toBeVisible();
    expect((await shiftsOf(SAM.employeeId))[0]!.endTime).toBe("12:00");
  });

  test("moving onto another shift is rejected, nothing saved", async ({ page }) => {
    await insertShift({ employeeId: SAM.employeeId, date: localYmd(), start: "08:00", end: "10:00" });
    await insertShift({ employeeId: SAM.employeeId, date: localYmd(), start: "12:00", end: "14:00" });
    const dialog = await openEdit(page, SAM.name);
    await startInput(dialog).fill("09:00");
    await endInput(dialog).fill("13:00");
    await save(dialog).click();
    await expect(toast(page, /overlaps an existing shift/i)).toBeVisible();
    expect((await shiftsOf(SAM.employeeId)).map((s) => s.startTime)).toEqual(["08:00", "12:00"]);
  });

  test("a shift can be stretched over its own old time", async ({ page }) => {
    await insertShift({ employeeId: SAM.employeeId, date: localYmd(), start: "08:00", end: "12:00" });
    const dialog = await openEdit(page, SAM.name);
    await endInput(dialog).fill("15:00");
    await save(dialog).click();
    await expect(toast(page, /shift updated/i)).toBeVisible();
  });

  for (const code of [INACTIVE_JOB_CODE.code, DELETED_JOB_CODE]) {
    test(`a shift carrying inactive/deleted code ${code} can still be edited`, async ({ page }) => {
      await insertShift({ employeeId: SAM.employeeId, date: localYmd(), start: "08:00", end: "12:00", code });
      const dialog = await openEdit(page, SAM.name);
      await expect(dialog.getByRole("combobox")).toContainText(code);
      await endInput(dialog).fill("13:00");
      await save(dialog).click();
      await expect(toast(page, /shift updated/i)).toBeVisible();
      expect((await shiftsOf(SAM.employeeId))[0]).toMatchObject({ jobCode: code, endTime: "13:00" });
    });
  }

  test("terminated employee's shift cannot be edited but can be deleted", async ({ page }) => {
    await insertShift({ employeeId: TERRY.employeeId, date: localYmd(), start: "08:00", end: "12:00" });
    const dialog = await openEdit(page, TERRY.name);
    await endInput(dialog).fill("13:00");
    await save(dialog).click();
    await expect(toast(page, /terry terminated isn.t an active employee.*delete the shift instead/i)).toBeVisible();
    expect((await shiftsOf(TERRY.employeeId))[0]!.endTime).toBe("12:00");
    await dialog.getByRole("button", { name: /^delete$/i }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: /^delete$/i }).click();
    await expect(toast(page, /shift deleted/i)).toBeVisible();
    expect(await shiftsOf(TERRY.employeeId)).toHaveLength(0);
  });

  test("shift deleted elsewhere: save and delete explain it", async ({ page }) => {
    const row = await insertShift({ employeeId: SAM.employeeId, date: localYmd(), start: "08:00", end: "12:00" });
    const dialog = await openEdit(page, SAM.name);
    await db.schedule.delete({ where: { id: row.id } });
    await save(dialog).click();
    await expect(toast(page, /that shift no longer exists/i)).toBeVisible();
    await dialog.getByRole("button", { name: /^delete$/i }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: /^delete$/i }).click();
    await expect(toast(page, /that shift was already deleted/i)).toBeVisible();
  });

  test("code deactivated meanwhile: save is refused", async ({ page }) => {
    await insertShift({ employeeId: SAM.employeeId, date: localYmd(), start: "08:00", end: "12:00" });
    const dialog = await openEdit(page, SAM.name);
    await dialog.getByRole("combobox").click();
    await page.getByRole("option", { name: new RegExp(JOB_CODE_2.code) }).click();
    await db.jobCode.update({ where: { code: JOB_CODE_2.code }, data: { isActive: false } });
    await save(dialog).click();
    await expect(toast(page, /is inactive\. pick an active job code/i)).toBeVisible();
    expect((await shiftsOf(SAM.employeeId))[0]!.jobCode).toBe("E2E100");
  });

  test("leave overlap on edit shows a warning", async ({ page }) => {
    await insertShift({ employeeId: SAM.employeeId, date: localYmd(), start: "08:00", end: "12:00" });
    await db.leaveRequest.create({
      data: {
        employeeId: (await db.employee.findUniqueOrThrow({ where: { employeeId: SAM.employeeId } })).id,
        leaveType: "SICK",
        startDate: new Date(`${localYmd()}T00:00:00.000Z`),
        endDate: new Date(`${localYmd()}T00:00:00.000Z`),
        totalDays: 1,
        status: "APPROVED",
      },
    });
    const dialog = await openEdit(page, SAM.name);
    await endInput(dialog).fill("13:00");
    await save(dialog).click();
    await expect(toast(page, /has approved sick leave/i)).toBeVisible();
  });
});

test.describe("admin deletes a shift", () => {
  test("confirmation: cancel keeps it, confirm removes it and tells the employee", async ({ page }) => {
    await insertShift({ employeeId: SAM.employeeId, date: localYmd(), start: "08:00", end: "12:00" });
    const dialog = await openEdit(page, SAM.name);
    await dialog.getByRole("button", { name: /^delete$/i }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText(/delete this shift/i);
    await confirm.getByRole("button", { name: /^cancel$/i }).click();
    expect(await shiftsOf(SAM.employeeId)).toHaveLength(1);

    await dialog.getByRole("button", { name: /^delete$/i }).click();
    await confirm.getByRole("button", { name: /^delete$/i }).click();
    await expect(toast(page, /shift deleted/i)).toBeVisible();
    expect(await shiftsOf(SAM.employeeId)).toHaveLength(0);
    await expect(calEvents(page, SAM.name)).toHaveCount(0);
    expect(await db.notification.count({ where: { type: "SCHEDULE", title: "A shift was cancelled" } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "schedule.delete" } })).toBe(1);
  });

  test("dropped connection / 500 / stale: error shown, shift kept", async ({ page }) => {
    await insertShift({ employeeId: SAM.employeeId, date: localYmd(), start: "08:00", end: "12:00" });
    const message = { abort: NETWORK_ERROR, "500": SERVER_ERROR, stale: STALE_ERROR };
    for (const mode of ["abort", "500", "stale"] as const) {
      const dialog = await openEdit(page, SAM.name);
      await failServerActions(page, mode, { times: 1 });
      await dialog.getByRole("button", { name: /^delete$/i }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: /^delete$/i }).click();
      await expect(toast(page, message[mode])).toBeVisible();
      await expectNoCrash(page);
      // The delete confirmation stays open (the edit dialog sits behind it).
      await expect(page.getByRole("alertdialog")).toBeVisible();
      expect(await shiftsOf(SAM.employeeId)).toHaveLength(1);
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
  });

  test("double-clicking the confirm button deletes once, no 'already deleted' error", async ({ page }) => {
    await insertShift({ employeeId: SAM.employeeId, date: localYmd(), start: "08:00", end: "12:00" });
    const dialog = await openEdit(page, SAM.name);
    await dialog.getByRole("button", { name: /^delete$/i }).click();
    await delayServerActions(page, 1500);
    await page.getByRole("alertdialog").getByRole("button", { name: /^delete$/i }).dblclick();
    await expect(toast(page, /shift deleted/i)).toBeVisible();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: /already deleted/i })).toHaveCount(0);
    expect(await db.auditLog.count({ where: { action: "schedule.delete" } })).toBe(1);
  });
});

test.describe("edit failures", () => {
  test("save: dropped connection and 500 keep the old values", async ({ page }) => {
    await insertShift({ employeeId: SAM.employeeId, date: localYmd(), start: "08:00", end: "12:00" });
    const message = { abort: NETWORK_ERROR, "500": SERVER_ERROR };
    for (const mode of ["abort", "500"] as const) {
      const dialog = await openEdit(page, SAM.name);
      await endInput(dialog).fill("15:00");
      await failServerActions(page, mode, { times: 1 });
      await save(dialog).click();
      await expect(toast(page, message[mode])).toBeVisible();
      await expectNoCrash(page);
      // The dialog stays open with the typed value.
      await expect(dialog).toBeVisible();
      await expect(endInput(dialog)).toHaveValue("15:00");
      expect((await shiftsOf(SAM.employeeId))[0]!.endTime).toBe("12:00");
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
  });

  test("double-clicking Save saves once", async ({ page }) => {
    await insertShift({ employeeId: SAM.employeeId, date: localYmd(), start: "08:00", end: "12:00" });
    const dialog = await openEdit(page, SAM.name);
    await endInput(dialog).fill("15:00");
    await delayServerActions(page, 1500);
    await save(dialog).dblclick();
    await expect(toast(page, /shift updated/i)).toBeVisible();
    expect(await db.auditLog.count({ where: { action: "schedule.update" } })).toBe(1);
  });
});

test.describe("admin calendar: filters and local times", () => {
  test("department and employee filters narrow the calendar", async ({ page }) => {
    await insertShift({ employeeId: SAM.employeeId, date: localYmd(), start: "08:00", end: "12:00" }); // Dept A
    await insertShift({ employeeId: "EMP-2026-5003", date: localYmd(), start: "08:00", end: "12:00" }); // Uma, Dept B
    await page.goto("/admin/schedules");
    await expect(calEvents(page, /Sam Shifts|Uma Unit/)).toHaveCount(2);
    await page.getByRole("button", { name: /^departments/i }).click();
    await page.getByRole("button", { name: DEPT_A }).click();
    await page.keyboard.press("Escape");
    await expect(calEvents(page, "Uma Unit")).toHaveCount(0);
    await expect(calEvents(page, "Sam Shifts")).toHaveCount(1);
    await expect(page.getByText(/showing \d+ of \d+ shifts/i)).toBeVisible();
    await page.getByRole("button", { name: /clear filters/i }).click();
    await expect(calEvents(page, "Uma Unit")).toHaveCount(1);

    await page.getByRole("button", { name: /^employees/i }).click();
    await page.getByPlaceholder("Search…").fill("tuesday");
    await page.getByRole("button", { name: new RegExp(TARA.name) }).click();
    await page.keyboard.press("Escape");
    await expect(calEvents(page, /Sam Shifts|Uma Unit/)).toHaveCount(0);
  });

  test("events show Central times in other months (March, DST day, November)", async ({ page }) => {
    await page.goto("/admin/schedules");
    await gotoMonth(page, WES_SHIFTS.early.date);
    await expect(calEvents(page, WES.name).filter({ hasText: /^8:00 AM/ })).toHaveCount(1);
    await expect(calEvents(page, WES.name).filter({ hasText: /^1:00 PM/ })).toHaveCount(0);
    await expect(calEvents(page, WES.name).filter({ hasText: /^8:15 AM/ })).toHaveCount(1);
    await expect(calEvents(page, WES.name).filter({ hasText: /^10:00 PM/ })).toContainText("(+1 day)");
    await gotoMonth(page, WES_SHIFTS.fallDay.date);
    await expect(calEvents(page, WES.name).filter({ hasText: /^1:00 PM/ })).toHaveCount(1);
    await expect(calEvents(page, WES.name).filter({ hasText: /^8:00 AM/ })).toHaveCount(1);
  });
});
