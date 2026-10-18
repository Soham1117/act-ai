import { test, expect } from "@playwright/test";
import { db } from "./support/db";
import { delayServerActions, expectNoCrash, failServerActions, toast } from "./support/helpers";
import { ADMIN_STATE, INACTIVE_EMPLOYEE, INACTIVE_JOB_CODE, JOB_CODE } from "./support/test-data";
import {
  JOB_CODE_2,
  SAM,
  STAN,
  TARA,
  TERRY,
  UMA,
  calEvents,
  cleanupScheduleRows,
  createButton,
  createTempEmployee,
  dateButtons,
  employeeDbId,
  endInput,
  insertShift,
  OLIVE,
  localYmd,
  openShiftDialog,
  pickDate,
  pickEmployee,
  shiftsOf,
  startInput,
  weekdayButtons,
  ymdOf,
} from "./support/schedules";

test.use({ storageState: ADMIN_STATE });

test.beforeEach(cleanupScheduleRows);
test.afterEach(cleanupScheduleRows);

const TODAY = () => localYmd();

function weekdayOf(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).getDay();
}

test.describe("admin creates a single shift", () => {
  test("happy path: row, notification, audit entry and calendar event", async ({ page }) => {
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await startInput(dialog).fill("07:30");
    await endInput(dialog).fill("15:45");
    await dialog.locator("textarea").fill("  Bring PPE  ");
    await createButton(dialog).click();
    await expect(toast(page, /shift created/i)).toBeVisible();
    await expect(dialog).toBeHidden();

    const [shift] = await shiftsOf(SAM.employeeId);
    expect(ymdOf(shift!.date)).toBe(TODAY());
    expect(shift).toMatchObject({ startTime: "07:30", endTime: "15:45", jobCode: JOB_CODE.code, notes: "Bring PPE" });
    expect(shift!.createdById).not.toBeNull();

    // Employee is told; the action is audited.
    const note = await db.notification.findFirstOrThrow({
      where: { type: "SCHEDULE", recipients: { some: { employeeId: await employeeDbId(SAM.employeeId) } } },
    });
    expect(note.title).toBe("New shift scheduled");
    expect(note.message).toContain("7:30 AM - 3:45 PM");
    expect(await db.auditLog.count({ where: { action: "schedule.create", resource: `Schedule:${shift!.id}` } })).toBe(1);

    // The calendar refetches and shows the event with its local time.
    await expect(calEvents(page, SAM.name)).toHaveCount(1);
    await expect(calEvents(page, SAM.name)).toContainText("7:30 AM");
    await expect(calEvents(page, SAM.name)).toContainText(`${SAM.name} · ${JOB_CODE.code}`);
  });

  test("whitespace-only notes are stored as nothing", async ({ page }) => {
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await dialog.locator("textarea").fill("   ");
    await createButton(dialog).click();
    await expect(toast(page, /shift created/i)).toBeVisible();
    expect((await shiftsOf(SAM.employeeId))[0]!.notes).toBeNull();
  });

  test("a second active job code can be picked from the dropdown", async ({ page }) => {
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await dialog.getByRole("combobox").click();
    await page.getByRole("option", { name: new RegExp(JOB_CODE_2.code) }).click();
    await createButton(dialog).click();
    await expect(toast(page, /shift created/i)).toBeVisible();
    expect((await shiftsOf(SAM.employeeId))[0]!.jobCode).toBe(JOB_CODE_2.code);
  });

  test("overnight shift: banner, +1 day label, stored as given", async ({ page }) => {
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await startInput(dialog).fill("22:00");
    await endInput(dialog).fill("06:00");
    await expect(dialog.getByText(/overnight shift: ends at 06:00 the next day/i)).toBeVisible();
    await createButton(dialog).click();
    await expect(toast(page, /shift created/i)).toBeVisible();

    const [shift] = await shiftsOf(SAM.employeeId);
    expect(shift).toMatchObject({ startTime: "22:00", endTime: "06:00" });
    expect(ymdOf(shift!.date)).toBe(TODAY());
    await expect(calEvents(page, SAM.name).first()).toContainText("(+1 day)");
    await expect(calEvents(page, SAM.name).first()).toContainText("10:00 PM");
  });

  test("a normal day shift shows no overnight banner", async ({ page }) => {
    const dialog = await openShiftDialog(page);
    await expect(dialog.getByText(/overnight shift/i)).toHaveCount(0);
    await startInput(dialog).fill("18:00");
    await endInput(dialog).fill("17:59");
    await expect(dialog.getByText(/overnight shift: ends at 17:59/i)).toBeVisible();
  });

  test("end earlier than start means overnight, not an error (end = start is the only error)", async ({ page }) => {
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await startInput(dialog).fill("12:00");
    await endInput(dialog).fill("11:59");
    await createButton(dialog).click();
    await expect(toast(page, /shift created/i)).toBeVisible();
    // 23h59m overnight shift is stored as typed.
    expect((await shiftsOf(SAM.employeeId))[0]).toMatchObject({ startTime: "12:00", endTime: "11:59" });
  });

  test("start equals end: rejected with a clear message and nothing saved", async ({ page }) => {
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await startInput(dialog).fill("09:00");
    await endInput(dialog).fill("09:00");
    await createButton(dialog).click();
    await expect(toast(page, /start and end can.t be the same.*overnight shift/i)).toBeVisible();
    await expect(dialog).toBeVisible();
    expect(await shiftsOf(SAM.employeeId)).toHaveLength(0);
  });

  test("a cleared time field is rejected the same way", async ({ page }) => {
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await endInput(dialog).fill("");
    await createButton(dialog).click();
    await expect(toast(page, /start and end can.t be the same/i)).toBeVisible();
    expect(await shiftsOf(SAM.employeeId)).toHaveLength(0);
  });

  test("a date in the past is allowed", async ({ page }) => {
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    const past = localYmd(-40);
    await pickDate(page, dateButtons(dialog).first(), past);
    await createButton(dialog).click();
    await expect(toast(page, /shift created/i)).toBeVisible();
    const [shift] = await shiftsOf(SAM.employeeId);
    expect(ymdOf(shift!.date)).toBe(past);
  });

  test("clicking a calendar day opens the dialog on that day", async ({ page }) => {
    await page.goto("/admin/schedules");
    await page.locator(".sx__month-grid-day").nth(10).click();
    const dialog = page.getByRole("dialog", { name: /new shift/i });
    await expect(dialog).toBeVisible();
    await expect(dateButtons(dialog)).toHaveCount(1);
  });

  test("create is disabled until an employee is picked, and Cancel closes the dialog", async ({ page }) => {
    const dialog = await openShiftDialog(page);
    await expect(createButton(dialog)).toBeDisabled();
    await pickEmployee(dialog, SAM.name);
    await expect(createButton(dialog)).toBeEnabled();
    await dialog.getByRole("button", { name: /^cancel$/i }).click();
    await expect(dialog).toBeHidden();
    expect(await shiftsOf(SAM.employeeId)).toHaveLength(0);
  });
});

test.describe("employee picker", () => {
  test("lists only active employees", async ({ page }) => {
    const dialog = await openShiftDialog(page);
    await expect(dialog.getByRole("button", { name: new RegExp(`^${SAM.name}`) })).toBeVisible();
    await expect(dialog.getByRole("button", { name: new RegExp(`^${TERRY.name}`) })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: new RegExp(`^${INACTIVE_EMPLOYEE.name}`) })).toHaveCount(0);
  });

  test("search narrows by name and email, shows an empty state", async ({ page }) => {
    const dialog = await openShiftDialog(page);
    const search = dialog.getByPlaceholder(/search employees/i);
    await search.fill("tuesday");
    await expect(dialog.getByRole("button", { name: new RegExp(`^${TARA.name}`) })).toBeVisible();
    await expect(dialog.getByRole("button", { name: new RegExp(`^${SAM.name}`) })).toHaveCount(0);
    await search.fill("unit@e2e");
    await expect(dialog.getByRole("button", { name: new RegExp(`^${UMA.name}`) })).toBeVisible();
    await search.fill("zzz-nobody");
    await expect(dialog.getByText(/no matches/i)).toBeVisible();
  });

  test("select all (filtered), chips, remove and clear", async ({ page }) => {
    const dialog = await openShiftDialog(page);
    await dialog.getByPlaceholder(/search employees/i).fill("e2e.test");
    await dialog.getByRole("button", { name: /select all \(filtered\)/i }).click();
    await expect(dialog.getByText(/employees · \d+ selected/i)).toBeVisible();
    await expect(dialog.getByRole("button", { name: `Remove ${SAM.name}` })).toBeVisible();
    await dialog.getByRole("button", { name: `Remove ${SAM.name}` }).click();
    await expect(dialog.getByRole("button", { name: `Remove ${SAM.name}` })).toHaveCount(0);
    await dialog.getByRole("button", { name: /^clear$/i }).click();
    await expect(createButton(dialog)).toBeDisabled();
  });
});

test.describe("multiple employees and date ranges", () => {
  test("two employees on one date create two shifts", async ({ page }) => {
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await pickEmployee(dialog, TARA.name);
    await createButton(dialog).click();
    await expect(toast(page, /created 2 shifts/i)).toBeVisible();
    expect(await shiftsOf(SAM.employeeId)).toHaveLength(1);
    expect(await shiftsOf(TARA.employeeId)).toHaveLength(1);
    // One in-app notice per employee.
    expect(await db.notification.count({ where: { type: "SCHEDULE", title: "New shift scheduled" } })).toBe(2);
    expect(await db.auditLog.count({ where: { action: "schedule.bulk_create" } })).toBe(1);
  });

  test("date range with a weekday picker: only the chosen weekdays get shifts", async ({ page }) => {
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await pickEmployee(dialog, TARA.name);
    await dialog.getByRole("button", { name: /^date range$/i }).click();
    const from = TODAY();
    const to = localYmd(13);
    await pickDate(page, dateButtons(dialog).nth(1), to);

    // Default is Mon-Fri; leave only Monday and Wednesday.
    const days = weekdayButtons(dialog);
    await expect(days).toHaveCount(7);
    for (const i of [1, 3, 4]) await days.nth(i).click();
    await expect(days.nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(days.nth(1)).toHaveAttribute("aria-pressed", "false");

    const expected: string[] = [];
    for (let i = 0; i <= 13; i++) {
      const ymd = localYmd(i);
      if ([1, 3].includes(weekdayOf(ymd))) expected.push(ymd);
    }
    expect(expected.length).toBeGreaterThanOrEqual(4);
    await expect(dialog.getByText(new RegExp(`${expected.length * 2} shifts will be created`))).toBeVisible();
    await expect(dialog.getByText(new RegExp(`2 employees × ${expected.length} days`))).toBeVisible();

    await createButton(dialog).click();
    await expect(toast(page, new RegExp(`created ${expected.length * 2} shifts`, "i"))).toBeVisible();
    for (const who of [SAM, TARA]) {
      const rows = await shiftsOf(who.employeeId);
      expect(rows.map((r) => ymdOf(r.date))).toEqual(expected);
      expect(rows.every((r) => r.startTime === "08:00" && r.endTime === "17:00")).toBe(true);
    }
    expect(from).toBe(TODAY());
  });

  test("range with no matching weekdays cannot be submitted", async ({ page }) => {
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await dialog.getByRole("button", { name: /^date range$/i }).click();
    const days = weekdayButtons(dialog);
    for (let i = 0; i < 5; i++) await days.nth(i).click(); // clear Mon-Fri
    await expect(dialog.getByText(/0 shifts will be created/i)).toBeVisible();
    await expect(createButton(dialog)).toBeDisabled();
    // Turn one day back on and it works again.
    await days.nth(0).click();
    await expect(days.nth(0)).toHaveAttribute("aria-pressed", "true");
  });

  test("range whose end is before its start cannot be submitted", async ({ page }) => {
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await dialog.getByRole("button", { name: /^date range$/i }).click();
    await pickDate(page, dateButtons(dialog).nth(1), localYmd(-3));
    await expect(dialog.getByText(/0 shifts will be created/i)).toBeVisible();
    await expect(createButton(dialog)).toBeDisabled();
  });

  test("overnight shifts work across a date range (each ends the next day)", async ({ page }) => {
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await dialog.getByRole("button", { name: /^date range$/i }).click();
    await pickDate(page, dateButtons(dialog).nth(1), localYmd(6));
    for (let i = 0; i < 7; i++) {
      if ((await weekdayButtons(dialog).nth(i).getAttribute("aria-pressed")) !== "true") await weekdayButtons(dialog).nth(i).click();
    }
    await startInput(dialog).fill("22:00");
    await endInput(dialog).fill("06:00");
    await createButton(dialog).click();
    await expect(toast(page, /created 7 shifts/i)).toBeVisible();
    // Back-to-back overnight shifts (22:00-06:00 each day) do not overlap.
    expect(await shiftsOf(SAM.employeeId)).toHaveLength(7);
  });
});

test.describe("overlap rules", () => {
  test("overlapping shift for the same employee is rejected, nothing saved", async ({ page }) => {
    await insertShift({ employeeId: SAM.employeeId, date: TODAY(), start: "08:00", end: "12:00" });
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await startInput(dialog).fill("11:00");
    await endInput(dialog).fill("13:00");
    await createButton(dialog).click();
    await expect(toast(page, /this shift overlaps an existing shift/i)).toBeVisible();
    await expect(dialog).toBeVisible();
    expect(await shiftsOf(SAM.employeeId)).toHaveLength(1);
  });

  test("a shift inside another one is rejected too", async ({ page }) => {
    await insertShift({ employeeId: SAM.employeeId, date: TODAY(), start: "08:00", end: "17:00" });
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await startInput(dialog).fill("10:00");
    await endInput(dialog).fill("11:00");
    await createButton(dialog).click();
    await expect(toast(page, /overlaps an existing shift/i)).toBeVisible();
    expect(await shiftsOf(SAM.employeeId)).toHaveLength(1);
  });

  test("adjacent shifts (end = next start) are allowed", async ({ page }) => {
    await insertShift({ employeeId: SAM.employeeId, date: TODAY(), start: "08:00", end: "12:00" });
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await startInput(dialog).fill("12:00");
    await endInput(dialog).fill("16:00");
    await createButton(dialog).click();
    await expect(toast(page, /shift created/i)).toBeVisible();
    expect(await shiftsOf(SAM.employeeId)).toHaveLength(2);
  });

  test("an overnight shift from yesterday blocks the early hours of today", async ({ page }) => {
    await insertShift({ employeeId: SAM.employeeId, date: localYmd(-1), start: "22:00", end: "06:00" });
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await startInput(dialog).fill("05:00");
    await endInput(dialog).fill("09:00");
    await createButton(dialog).click();
    await expect(toast(page, /overlaps an existing shift/i)).toBeVisible();
    expect(await shiftsOf(SAM.employeeId)).toHaveLength(1);

    // Starting exactly when the overnight shift ends is fine.
    await startInput(dialog).fill("06:00");
    await createButton(dialog).click();
    await expect(toast(page, /shift created/i)).toBeVisible();
    expect(await shiftsOf(SAM.employeeId)).toHaveLength(2);
  });

  test("a new overnight shift is blocked by tomorrow's early shift", async ({ page }) => {
    await insertShift({ employeeId: SAM.employeeId, date: localYmd(1), start: "00:00", end: "04:00" });
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await startInput(dialog).fill("22:00");
    await endInput(dialog).fill("02:00");
    await createButton(dialog).click();
    await expect(toast(page, /overlaps an existing shift/i)).toBeVisible();
    expect(await shiftsOf(SAM.employeeId)).toHaveLength(1);
  });

  test("the same time for a different employee is fine", async ({ page }) => {
    await insertShift({ employeeId: SAM.employeeId, date: TODAY(), start: "08:00", end: "17:00" });
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, TARA.name);
    await createButton(dialog).click();
    await expect(toast(page, /shift created/i)).toBeVisible();
    expect(await shiftsOf(TARA.employeeId)).toHaveLength(1);
  });

  test("bulk create skips conflicting slots and says how many", async ({ page }) => {
    await insertShift({ employeeId: SAM.employeeId, date: TODAY(), start: "09:00", end: "13:00" });
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await pickEmployee(dialog, TARA.name);
    await createButton(dialog).click();
    await expect(toast(page, /created 1 shift · 1 skipped \(conflicts\)/i)).toBeVisible();
    expect(await shiftsOf(SAM.employeeId)).toHaveLength(1); // only the original
    expect(await shiftsOf(TARA.employeeId)).toHaveLength(1);
    await expect(dialog).toBeHidden();
  });

  test("bulk create where everything conflicts creates nothing", async ({ page }) => {
    for (const who of [SAM, TARA]) {
      await insertShift({ employeeId: who.employeeId, date: TODAY(), start: "08:00", end: "17:00" });
    }
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await pickEmployee(dialog, TARA.name);
    await createButton(dialog).click();
    await expect(toast(page, /created 0 shifts · 2 skipped \(conflicts\)/i)).toBeVisible();
    expect(await db.schedule.count({ where: { employee: { employeeId: { in: [SAM.employeeId, TARA.employeeId] } } } })).toBe(2);
    expect(await db.notification.count({ where: { type: "SCHEDULE" } })).toBe(0);
  });

  test("range bulk: days that overlap are skipped, the rest are created", async ({ page }) => {
    // Sam already works an overnight shift starting the day before our range ends its first day.
    await insertShift({ employeeId: SAM.employeeId, date: localYmd(2), start: "10:00", end: "12:00" });
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await dialog.getByRole("button", { name: /^date range$/i }).click();
    await pickDate(page, dateButtons(dialog).nth(1), localYmd(4));
    for (let i = 0; i < 7; i++) {
      if ((await weekdayButtons(dialog).nth(i).getAttribute("aria-pressed")) !== "true") await weekdayButtons(dialog).nth(i).click();
    }
    await createButton(dialog).click();
    // 5 days (today..today+4); day +2 conflicts (08:00-17:00 vs 10:00-12:00).
    await expect(toast(page, /created 4 shifts · 1 skipped \(conflicts\)/i)).toBeVisible();
    expect(await shiftsOf(SAM.employeeId)).toHaveLength(5);
  });
});

test.describe("leave overlap warning", () => {
  async function approvedLeave(status: "APPROVED" | "PENDING" | "REJECTED", from: string, to: string) {
    await db.leaveRequest.create({
      data: {
        employeeId: await employeeDbId(SAM.employeeId),
        leaveType: "VACATION",
        startDate: new Date(`${from}T00:00:00.000Z`),
        endDate: new Date(`${to}T00:00:00.000Z`),
        totalDays: 3,
        status,
      },
    });
  }

  test("approved leave on the shift date: shift is created and a warning toast appears", async ({ page }) => {
    await approvedLeave("APPROVED", localYmd(-1), localYmd(1));
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await createButton(dialog).click();
    await expect(toast(page, /shift created/i)).toBeVisible();
    await expect(toast(page, /sam shifts has approved vacation leave .* overlapping/i)).toBeVisible();
    expect(await shiftsOf(SAM.employeeId)).toHaveLength(1);
  });

  test("pending or rejected leave gives no warning", async ({ page }) => {
    await approvedLeave("PENDING", localYmd(-1), localYmd(1));
    await approvedLeave("REJECTED", localYmd(-1), localYmd(1));
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await createButton(dialog).click();
    await expect(toast(page, /shift created/i)).toBeVisible();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: /approved .* leave/i })).toHaveCount(0);
  });

  test("approved leave on another day gives no warning", async ({ page }) => {
    await approvedLeave("APPROVED", localYmd(10), localYmd(12));
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await createButton(dialog).click();
    await expect(toast(page, /shift created/i)).toBeVisible();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: /approved .* leave/i })).toHaveCount(0);
  });

  test("bulk create also warns about leave overlap", async ({ page }) => {
    await approvedLeave("APPROVED", localYmd(0), localYmd(0));
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await pickEmployee(dialog, TARA.name);
    await createButton(dialog).click();
    await expect(toast(page, /created 2 shifts/i)).toBeVisible();
    await expect(toast(page, /sam shifts has approved vacation leave/i)).toBeVisible();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: /tara tuesday has approved/i })).toHaveCount(0);
  });

  test("an overnight shift that runs into the first day of leave warns", async ({ page }) => {
    await approvedLeave("APPROVED", localYmd(1), localYmd(2));
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await startInput(dialog).fill("22:00");
    await endInput(dialog).fill("06:00");
    await createButton(dialog).click();
    await expect(toast(page, /shift created/i)).toBeVisible();
    await expect(toast(page, /has approved vacation leave/i)).toBeVisible();
  });
});

test.describe("server-side checks that the UI cannot prevent", () => {
  test("employee becomes inactive while the dialog is open", async ({ page }) => {
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, STAN.name);
    await db.employee.update({ where: { employeeId: STAN.employeeId }, data: { employmentStatus: "TERMINATED" } });
    await createButton(dialog).click();
    await expect(toast(page, /stan stale isn.t an active employee, so they can.t be scheduled/i)).toBeVisible();
    await expect(dialog).toBeVisible();
    expect(await shiftsOf(STAN.employeeId)).toHaveLength(0);
  });

  test("bulk: an inactive employee in the selection blocks the whole batch", async ({ page }) => {
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, STAN.name);
    await pickEmployee(dialog, TARA.name);
    await db.employee.update({ where: { employeeId: STAN.employeeId }, data: { employmentStatus: "ON_LEAVE" } });
    await createButton(dialog).click();
    await expect(toast(page, /only active employees can be scheduled\. remove: stan stale/i)).toBeVisible();
    expect(await shiftsOf(STAN.employeeId)).toHaveLength(0);
    expect(await shiftsOf(TARA.employeeId)).toHaveLength(0);
  });

  test("employee deleted while the dialog is open", async ({ page }) => {
    const temp = await createTempEmployee("gone1");
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, temp.name);
    await db.employee.delete({ where: { id: temp.id } });
    await createButton(dialog).click();
    await expect(toast(page, /that employee no longer exists/i)).toBeVisible();
    expect(await db.schedule.count({ where: { employeeId: temp.id } })).toBe(0);
  });

  test("bulk: a deleted employee in the selection blocks the batch", async ({ page }) => {
    const temp = await createTempEmployee("gone2");
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, temp.name);
    await pickEmployee(dialog, TARA.name);
    await db.employee.delete({ where: { id: temp.id } });
    await createButton(dialog).click();
    await expect(toast(page, /one of the selected employees no longer exists/i)).toBeVisible();
    expect(await shiftsOf(TARA.employeeId)).toHaveLength(0);
  });

  test("job code deactivated while the dialog is open", async ({ page }) => {
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await dialog.getByRole("combobox").click();
    await page.getByRole("option", { name: new RegExp(JOB_CODE_2.code) }).click();
    await db.jobCode.update({ where: { code: JOB_CODE_2.code }, data: { isActive: false } });
    await createButton(dialog).click();
    await expect(toast(page, new RegExp(`job code ${JOB_CODE_2.code} is inactive\\. pick an active job code`, "i"))).toBeVisible();
    expect(await shiftsOf(SAM.employeeId)).toHaveLength(0);
  });

  test("job code deleted while the dialog is open (bulk too)", async ({ page }) => {
    await db.jobCode.create({ data: { code: "E2ETMP1", title: "Temp", rate: "NA", isActive: true } });
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await dialog.getByRole("combobox").click();
    await page.getByRole("option", { name: /E2ETMP1/ }).click();
    await db.jobCode.delete({ where: { code: "E2ETMP1" } });
    await createButton(dialog).click();
    await expect(toast(page, /job code E2ETMP1 doesn.t exist\. pick an existing job code/i)).toBeVisible();
    await pickEmployee(dialog, TARA.name);
    await createButton(dialog).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: /E2ETMP1 doesn.t exist/i })).not.toHaveCount(0);
    expect(await db.schedule.count({ where: { jobCode: "E2ETMP1" } })).toBe(0);
  });

  test("an inactive code is never offered in the dropdown", async ({ page }) => {
    const dialog = await openShiftDialog(page);
    await dialog.getByRole("combobox").click();
    await expect(page.getByRole("option", { name: new RegExp(INACTIVE_JOB_CODE.code) })).toHaveCount(0);
  });

  test("notes longer than 2000 characters are refused with a field message", async ({ page }) => {
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await dialog.locator("textarea").fill("x".repeat(2001));
    await createButton(dialog).click();
    await expect(toast(page, /check notes/i)).toBeVisible();
    expect(await shiftsOf(SAM.employeeId)).toHaveLength(0);
  });

  test("bulk: more than 1500 shifts at once is refused", async ({ page }) => {
    const dialog = await openShiftDialog(page);
    for (const who of [SAM, TARA, UMA, { name: "Wes Window" }, OLIVE]) await pickEmployee(dialog, who.name);
    await dialog.getByRole("button", { name: /^date range$/i }).click();
    await pickDate(page, dateButtons(dialog).nth(1), localYmd(364));
    for (let i = 0; i < 7; i++) {
      if ((await weekdayButtons(dialog).nth(i).getAttribute("aria-pressed")) !== "true") await weekdayButtons(dialog).nth(i).click();
    }
    await expect(dialog.getByText(/1825 shifts will be created/i)).toBeVisible();
    await createButton(dialog).click();
    await expect(toast(page, /too many shifts at once \(max 1500\)/i)).toBeVisible();
    expect(await db.schedule.count({ where: { employee: { employeeId: { in: [SAM.employeeId, TARA.employeeId, UMA.employeeId] } } } })).toBe(0);
  });

  test("bulk: more than 366 dates in one request is refused with a field message", async ({ page }) => {
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await dialog.getByRole("button", { name: /^date range$/i }).click();
    await pickDate(page, dateButtons(dialog).nth(1), localYmd(400));
    for (let i = 0; i < 7; i++) {
      if ((await weekdayButtons(dialog).nth(i).getAttribute("aria-pressed")) !== "true") await weekdayButtons(dialog).nth(i).click();
    }
    await createButton(dialog).click();
    await expect(toast(page, /check dates/i)).toBeVisible();
    expect(await shiftsOf(SAM.employeeId)).toHaveLength(0);
  });
});

test.describe("failure injection and double submit", () => {
  test("single create: dropped connection shows an error, nothing saved", async ({ page }) => {
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    const fail = await failServerActions(page, "abort");
    await createButton(dialog).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    expect(fail.count()).toBeGreaterThan(0);
    await expectNoCrash(page);
    expect(await shiftsOf(SAM.employeeId)).toHaveLength(0);
  });

  test("single create: server 500 shows an error, nothing saved", async ({ page }) => {
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await failServerActions(page, "500");
    await createButton(dialog).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect(await shiftsOf(SAM.employeeId)).toHaveLength(0);
  });

  test("bulk create: dropped connection shows an error, nothing saved", async ({ page }) => {
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await pickEmployee(dialog, TARA.name);
    await failServerActions(page, "abort");
    await createButton(dialog).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect(await db.schedule.count({ where: { employee: { employeeId: { in: [SAM.employeeId, TARA.employeeId] } } } })).toBe(0);
  });

  test("stale deployment (old page, action gone): no crash, nothing saved", async ({ page }) => {
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await failServerActions(page, "stale");
    await createButton(dialog).click();
    await expect(page.getByText(/something went wrong|new version|refresh|reload/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect(await shiftsOf(SAM.employeeId)).toHaveLength(0);
  });

  test("double-clicking Create makes exactly one shift", async ({ page }) => {
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await delayServerActions(page, 1500);
    await createButton(dialog).dblclick();
    await expect(toast(page, /shift created/i)).toBeVisible();
    await expect(dialog).toBeHidden();
    expect(await shiftsOf(SAM.employeeId)).toHaveLength(1);
    expect(await db.notification.count({ where: { type: "SCHEDULE" } })).toBe(1);
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: /overlaps/i })).toHaveCount(0);
  });

  test("double-clicking Create on a bulk batch makes each shift once", async ({ page }) => {
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await pickEmployee(dialog, TARA.name);
    await delayServerActions(page, 1500);
    await createButton(dialog).dblclick();
    await expect(toast(page, /created 2 shifts/i)).toBeVisible();
    expect(await shiftsOf(SAM.employeeId)).toHaveLength(1);
    expect(await shiftsOf(TARA.employeeId)).toHaveLength(1);
  });

  test("pressing Enter twice in the form submits once", async ({ page }) => {
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    await delayServerActions(page, 1500);
    await startInput(dialog).focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(toast(page, /shift created/i)).toBeVisible();
    expect(await shiftsOf(SAM.employeeId)).toHaveLength(1);
  });

  test("after a failed save the same form can be submitted again", async ({ page }) => {
    const dialog = await openShiftDialog(page);
    await pickEmployee(dialog, SAM.name);
    // Only the first call fails; the retry goes through.
    const f = await failServerActions(page, "abort", { times: 1 });
    await createButton(dialog).click();
    await expect.poll(() => f.count()).toBe(1);
    await page.reload();
    const dialog2 = page.getByRole("button", { name: /new shift/i });
    await dialog2.click();
    const d = page.getByRole("dialog", { name: /new shift/i });
    await pickEmployee(d, SAM.name);
    await createButton(d).click();
    await expect(toast(page, /shift created/i)).toBeVisible();
    expect(await shiftsOf(SAM.employeeId)).toHaveLength(1);
  });
});
