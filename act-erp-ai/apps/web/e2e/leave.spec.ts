import { test, expect, type Page } from "@playwright/test";
import { db } from "./support/db";
import {
  delayServerActions,
  expectNoCrash,
  failServerActions,
  toast,
} from "./support/helpers";
import {
  SS,
  addDays,
  answerNextDialog,
  currentYear,
  dateOnly,
  empDbId,
  labelled,
  loginState,
  mondayWindow,
  pick,
  statValue,
  weekdayFromToday,
  ymdFromToday,
} from "./support/self-service";
import { NETWORK_ERROR, SERVER_ERROR, STALE_ERROR } from "./support/action-errors";

// Leave, employee side. Dedicated employee: Leah (never Erin).
test.use({ storageState: "e2e/.auth/leah.json" });

let leahId: string;

test.beforeAll(async ({ browser }) => {
  await loginState(browser, SS.leah, "leah");
  leahId = await empDbId(SS.leah);
});

test.afterAll(async () => {
  // Leave policy is global: never leave a changed policy behind for other specs.
  await db.leavePolicy.deleteMany();
});

test.beforeEach(async () => {
  // Every test starts from a clean slate for Leah (and default policy).
  await db.leaveRequest.deleteMany({ where: { employeeId: leahId } });
  await db.leaveAdjustment.deleteMany({ where: { employeeId: leahId } });
  await db.leavePolicy.deleteMany();
  await db.auditLog.deleteMany({ where: { action: { startsWith: "leave." }, resource: { startsWith: "LeaveRequest" } } });
});

async function createLeave(
  data: {
    type?: "SICK" | "ANNUAL" | "VACATION" | "FAMILY" | "PERSONAL";
    start: string;
    end: string;
    days: number;
    status?: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
    reviewNotes?: string;
  },
) {
  return db.leaveRequest.create({
    data: {
      employeeId: leahId,
      leaveType: data.type ?? "SICK",
      startDate: dateOnly(data.start),
      endDate: dateOnly(data.end),
      totalDays: data.days,
      status: data.status ?? "PENDING",
      reviewNotes: data.reviewNotes,
    },
  });
}

async function openDialog(page: Page) {
  await page.goto("/dashboard/leave");
  await page.getByRole("button", { name: "Request leave" }).click();
  const dialog = page.getByRole("dialog", { name: "Request leave" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function fillRange(dialog: ReturnType<Page["locator"]>, start: string, end: string) {
  await labelled(dialog, "Start date").fill(start);
  await labelled(dialog, "End date").fill(end);
}

const submit = (dialog: ReturnType<Page["locator"]>) => dialog.getByRole("button", { name: /^submit$/i });
const sameYear = (ymd: string) => Number(ymd.slice(0, 4)) === currentYear();

test.describe("leave: employee requests", () => {
  test("requests two sick days; the balance and list update, DB and audit log agree", async ({ page }) => {
    const start = mondayWindow(14);
    const end = addDays(start, 1); // Monday + Tuesday
    const dialog = await openDialog(page);
    await pick(page, dialog, "Type", /^SICK/);
    await fillRange(dialog, start, end);
    await labelled(dialog, "Reason").fill("Flu");
    await expect(dialog.getByRole("status")).toContainText("2 days will be charged");
    await submit(dialog).click();
    await expect(toast(page, "Leave request submitted (2 days)")).toBeVisible();
    await expect(dialog).toBeHidden();

    const row = await db.leaveRequest.findFirstOrThrow({ where: { employeeId: leahId } });
    expect(row.status).toBe("PENDING");
    expect(row.leaveType).toBe("SICK");
    expect(Number(row.totalDays)).toBe(2);
    expect(row.description).toBe("Flu");
    expect(row.startDate.toISOString().slice(0, 10)).toBe(start);
    expect(row.endDate.toISOString().slice(0, 10)).toBe(end);
    expect(await db.auditLog.count({ where: { action: "leave.submit", resource: `LeaveRequest:${row.id}` } })).toBe(1);

    const item = page.getByRole("listitem").filter({ hasText: "SICK" }).filter({ hasText: "PENDING" });
    await expect(item).toHaveCount(1);
    await expect(item).toContainText("2 days");
    if (sameYear(start)) {
      await expect(statValue(page, "Pending approval")).toHaveText("2");
      await expect(page.getByText("3 left of 5")).toBeVisible(); // 5 sick days - 2 pending
      await expect(statValue(page, "Days remaining")).toHaveText("28"); // 30 total - 2
    }
  });

  test("the request dialog shows the live balance for the chosen type", async ({ page }) => {
    const dialog = await openDialog(page);
    await expect(dialog).toContainText(/10 days of annual leave available/i);
    await pick(page, dialog, "Type", /^SICK/);
    await expect(dialog).toContainText(/5 days of sick leave available/i);
    await pick(page, dialog, "Type", /^FAMILY/);
    await expect(dialog).toContainText(/family leave is not balance-limited/i);
  });

  test("a half day counts 0.5; start and end half days of a range each take 0.5", async ({ page }) => {
    const monday = mondayWindow(21);
    // Single day, half day only.
    let dialog = await openDialog(page);
    await pick(page, dialog, "Type", /^PERSONAL/);
    await fillRange(dialog, monday, monday);
    await dialog.getByRole("checkbox", { name: /half day only/i }).click();
    await expect(dialog.getByRole("status")).toContainText("0.5 days will be charged");
    await submit(dialog).click();
    await expect(toast(page, "Leave request submitted (0.5 days)")).toBeVisible();
    const single = await db.leaveRequest.findFirstOrThrow({ where: { employeeId: leahId } });
    expect(Number(single.totalDays)).toBe(0.5);
    expect(single.startHalfDay).toBe(true);
    await expect(page.getByRole("listitem").filter({ hasText: "half day" })).toHaveCount(1);

    // Mon-Wed with both ends half: 3 - 0.5 - 0.5 = 2.
    const nextMonday = addDays(monday, 7);
    dialog = await openDialog(page);
    await pick(page, dialog, "Type", /^PERSONAL/);
    await fillRange(dialog, nextMonday, addDays(nextMonday, 2));
    await dialog.getByRole("checkbox", { name: /start date is a half day/i }).click();
    await dialog.getByRole("checkbox", { name: /end date is a half day/i }).click();
    await expect(dialog.getByRole("status")).toContainText("2 days will be charged");
    // 3 personal days a year: 0.5 already requested + 2 = fine.
    await submit(dialog).click();
    await expect(toast(page, "Leave request submitted (2 days)")).toBeVisible();
    const ranged = await db.leaveRequest.findFirstOrThrow({ where: { employeeId: leahId, id: { not: single.id } } });
    expect(Number(ranged.totalDays)).toBe(2);
    expect(ranged.startHalfDay && ranged.endHalfDay).toBe(true);
  });

  test("a weekend-only range has no working days: preview explains and Submit stays disabled", async ({ page }) => {
    const saturday = addDays(mondayWindow(14), 5);
    const dialog = await openDialog(page);
    await fillRange(dialog, saturday, addDays(saturday, 1));
    await expect(dialog.getByRole("status")).toContainText(/no working days/i);
    await expect(submit(dialog)).toBeDisabled();
    expect(await db.leaveRequest.count({ where: { employeeId: leahId } })).toBe(0);
  });

  test("an end date before the start date is explained and cannot be submitted", async ({ page }) => {
    const start = mondayWindow(14);
    const dialog = await openDialog(page);
    await labelled(dialog, "Start date").fill(addDays(start, 3));
    await labelled(dialog, "End date").fill(start);
    await expect(dialog.getByRole("status")).toContainText(/end date must be on or after the start date/i);
    await expect(submit(dialog)).toBeDisabled();
  });

  test("more days than the balance is blocked in the dialog with the exact shortfall", async ({ page }) => {
    const start = mondayWindow(14, 8);
    const dialog = await openDialog(page);
    await pick(page, dialog, "Type", /^SICK/);
    await fillRange(dialog, start, addDays(start, 7)); // Mon .. next Mon = 6 weekdays > 5
    await expect(dialog.getByRole("status")).toContainText(
      new RegExp(`Not enough sick leave for ${start.slice(0, 4)}: 5 days available, 6 days needed`),
    );
    await expect(submit(dialog)).toBeDisabled();
    expect(await db.leaveRequest.count({ where: { employeeId: leahId } })).toBe(0);
  });

  test("server re-checks the balance: a stale dialog cannot overdraw (nothing saved)", async ({ page }) => {
    const start = mondayWindow(14, 20);
    const dialog = await openDialog(page); // dialog loaded with 5 sick days available
    await pick(page, dialog, "Type", /^SICK/);
    // Meanwhile 4 of the 5 days get used elsewhere.
    await createLeave({ start: addDays(start, 14), end: addDays(start, 17), days: 4, status: "APPROVED" });
    await fillRange(dialog, start, addDays(start, 2)); // needs 3, only 1 left
    await expect(dialog.getByRole("status")).toContainText("3 days will be charged");
    await submit(dialog).click();
    await expect(
      toast(page, new RegExp(`Not enough sick leave for ${start.slice(0, 4)}: you have 1 day available .* needs 3 days`)),
    ).toBeVisible();
    expect(await db.leaveRequest.count({ where: { employeeId: leahId } })).toBe(1);
  });

  test("overlapping an existing pending request is rejected with the dates in the message", async ({ page }) => {
    const start = mondayWindow(14);
    await createLeave({ start, end: addDays(start, 1), days: 2 });
    const dialog = await openDialog(page);
    await pick(page, dialog, "Type", /^VACATION/);
    await fillRange(dialog, addDays(start, 1), addDays(start, 2)); // Tue-Wed overlaps Mon-Tue
    await submit(dialog).click();
    await expect(toast(page, /overlaps your pending sick leave/i)).toBeVisible();
    expect(await db.leaveRequest.count({ where: { employeeId: leahId } })).toBe(1);
  });

  test("overlapping approved leave is rejected too", async ({ page }) => {
    const start = mondayWindow(14);
    await createLeave({ start, end: addDays(start, 2), days: 3, status: "APPROVED" });
    const dialog = await openDialog(page);
    await pick(page, dialog, "Type", /^VACATION/);
    await fillRange(dialog, start, start);
    await submit(dialog).click();
    await expect(toast(page, /overlaps your approved sick leave/i)).toBeVisible();
    expect(await db.leaveRequest.count({ where: { employeeId: leahId } })).toBe(1);
  });

  test("a cancelled request does not block the same dates", async ({ page }) => {
    const start = mondayWindow(14);
    await createLeave({ start, end: start, days: 1, status: "CANCELLED" });
    const dialog = await openDialog(page);
    await pick(page, dialog, "Type", /^SICK/);
    await fillRange(dialog, start, start);
    await submit(dialog).click();
    await expect(toast(page, "Leave request submitted (1 day)")).toBeVisible();
    expect(await db.leaveRequest.count({ where: { employeeId: leahId, status: "PENDING" } })).toBe(1);
  });

  test("a start date in the past is refused by the server (browser date limit bypassed)", async ({ page }) => {
    const past = weekdayFromToday(-9);
    const dialog = await openDialog(page);
    await pick(page, dialog, "Type", /^SICK/);
    await fillRange(dialog, past, past);
    // The date input has min=today, which stops the form in the browser; turn that off to reach the server rule.
    await dialog.locator("form").evaluate((f) => ((f as HTMLFormElement).noValidate = true));
    await submit(dialog).click();
    await expect(toast(page, "Start date cannot be in the past. Pick today or a later date.")).toBeVisible();
    expect(await db.leaveRequest.count({ where: { employeeId: leahId } })).toBe(0);
  });

  test("the browser itself blocks a past start date (min attribute)", async ({ page }) => {
    const past = weekdayFromToday(-9);
    const dialog = await openDialog(page);
    await fillRange(dialog, past, past);
    await expect(labelled(dialog, "Start date")).toHaveAttribute("min", ymdFromToday(0));
    await submit(dialog).click();
    await expect(dialog).toBeVisible();
    expect(await db.leaveRequest.count({ where: { employeeId: leahId } })).toBe(0);
  });

  test("a request longer than a year is refused with a clear message", async ({ page }) => {
    const start = weekdayFromToday(10);
    const dialog = await openDialog(page);
    await pick(page, dialog, "Type", /^FAMILY/); // not balance-limited, so only the length rule applies
    await fillRange(dialog, start, addDays(start, 400));
    await submit(dialog).click();
    await expect(
      toast(page, "Leave requests cannot span more than one year. Split it into separate requests."),
    ).toBeVisible();
    expect(await db.leaveRequest.count({ where: { employeeId: leahId } })).toBe(0);
  });

  test("unlimited leave types are not blocked by balance (15 working days of family leave)", async ({ page }) => {
    const start = mondayWindow(14, 28);
    const dialog = await openDialog(page);
    await pick(page, dialog, "Type", /^FAMILY/);
    await fillRange(dialog, start, addDays(start, 18)); // Mon .. Fri of week 3 = 15 weekdays
    await expect(dialog.getByRole("status")).toContainText("15 days will be charged");
    await submit(dialog).click();
    await expect(toast(page, "Leave request submitted (15 days)")).toBeVisible();
    expect(Number((await db.leaveRequest.findFirstOrThrow({ where: { employeeId: leahId } })).totalDays)).toBe(15);
    await expect(page.getByText(/not balance-limited/i).first()).toBeVisible();
  });

  test("reason longer than 500 characters cannot be typed (maxLength) and empty reason is fine", async ({ page }) => {
    const dialog = await openDialog(page);
    await expect(labelled(dialog, "Reason")).toHaveAttribute("maxlength", "500");
    const start = mondayWindow(14);
    await pick(page, dialog, "Type", /^SICK/);
    await fillRange(dialog, start, start);
    await submit(dialog).click();
    await expect(toast(page, "Leave request submitted (1 day)")).toBeVisible();
    expect((await db.leaveRequest.findFirstOrThrow({ where: { employeeId: leahId } })).description).toBeNull();
  });
});

test.describe("leave: balance math", () => {
  test("approved, pending and adjusted days all show up in the balance and the DB agrees", async ({ page }) => {
    test.skip(!sameYear(mondayWindow(14)), "balance cards show the current year only");
    const start = mondayWindow(14, 30);
    await createLeave({ start, end: addDays(start, 1), days: 2, status: "APPROVED" }); // 2 upcoming
    await createLeave({ start: addDays(start, 14), end: addDays(start, 14), days: 1 }); // 1 pending
    await createLeave({ start: addDays(start, 21), end: addDays(start, 21), days: 1, status: "REJECTED" }); // ignored
    await createLeave({ start: addDays(start, 22), end: addDays(start, 22), days: 1, status: "CANCELLED" }); // ignored
    await db.leaveAdjustment.create({
      data: { employeeId: leahId, year: currentYear(), leaveType: "SICK", days: 2, reason: "E2E bonus", createdById: (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id },
    });
    await page.goto("/dashboard/leave");
    // sick: allowed 5 + 2 adjustment = 7, used 3 -> 4 left of 7
    await expect(page.getByText("4 left of 7")).toBeVisible();
    await expect(statValue(page, "Pending approval")).toHaveText("1");
    await expect(statValue(page, "Taken / approved")).toHaveText("2");
    await expect(statValue(page, "Days remaining")).toHaveText("29"); // (10+10+7+3+2) - 3
    for (const status of ["APPROVED", "REJECTED", "CANCELLED"]) {
      await expect(page.getByRole("listitem").filter({ hasText: status })).not.toHaveCount(0);
    }
  });

  test("a reviewer's note on a rejected request is shown to the employee", async ({ page }) => {
    const start = mondayWindow(14);
    await createLeave({ start, end: start, days: 1, status: "REJECTED", reviewNotes: "Peak season, please move it" });
    await page.goto("/dashboard/leave");
    await expect(page.getByText("Peak season, please move it")).toBeVisible();
    await expect(page.getByRole("button", { name: /cancel leave request/i })).toHaveCount(0);
  });
});

test.describe("leave: cancelling", () => {
  test("cancels a pending request: status, balance and audit log", async ({ page }) => {
    const start = mondayWindow(14);
    const lr = await createLeave({ start, end: addDays(start, 1), days: 2 });
    await page.goto("/dashboard/leave");
    answerNextDialog(page);
    await page.getByRole("button", { name: /cancel leave request/i }).click();
    await expect(toast(page, "Cancelled")).toBeVisible();
    expect((await db.leaveRequest.findUniqueOrThrow({ where: { id: lr.id } })).status).toBe("CANCELLED");
    expect(await db.auditLog.count({ where: { action: "leave.cancel", resource: `LeaveRequest:${lr.id}` } })).toBe(1);
    await expect(page.getByRole("listitem").filter({ hasText: "CANCELLED" })).toHaveCount(1);
    if (sameYear(start)) await expect(statValue(page, "Pending approval")).toHaveText("0");
  });

  test("answering No to the confirmation keeps the request", async ({ page }) => {
    const start = mondayWindow(14);
    const lr = await createLeave({ start, end: start, days: 1 });
    await page.goto("/dashboard/leave");
    answerNextDialog(page, false);
    await page.getByRole("button", { name: /cancel leave request/i }).click();
    await expect(page.getByRole("button", { name: /cancel leave request/i })).toBeEnabled();
    expect((await db.leaveRequest.findUniqueOrThrow({ where: { id: lr.id } })).status).toBe("PENDING");
  });

  test("cancels approved leave that has not started and the days come back", async ({ page }) => {
    const start = mondayWindow(14);
    const lr = await createLeave({ start, end: addDays(start, 1), days: 2, status: "APPROVED" });
    await page.goto("/dashboard/leave");
    if (sameYear(start)) await expect(page.getByText("3 left of 5")).toBeVisible();
    answerNextDialog(page);
    await page.getByRole("button", { name: /cancel leave request/i }).click();
    await expect(toast(page, "Cancelled")).toBeVisible();
    expect((await db.leaveRequest.findUniqueOrThrow({ where: { id: lr.id } })).status).toBe("CANCELLED");
    if (sameYear(start)) await expect(page.getByText("5 left of 5")).toBeVisible();
    expect(await db.auditLog.count({ where: { action: "leave.cancel", resource: `LeaveRequest:${lr.id}` } })).toBe(1);
  });

  test("approved leave that already started has no cancel button", async ({ page }) => {
    const today = ymdFromToday(0);
    await createLeave({ start: today, end: today, days: 1, status: "APPROVED" });
    await page.goto("/dashboard/leave");
    await expect(page.getByRole("listitem").filter({ hasText: "APPROVED" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /cancel leave request/i })).toHaveCount(0);
  });

  test("cancelling something an admin already decided says so and changes nothing", async ({ page }) => {
    const start = mondayWindow(14);
    const lr = await createLeave({ start, end: start, days: 1 });
    await page.goto("/dashboard/leave");
    // An admin rejects it while the employee's page is still open.
    await db.leaveRequest.update({ where: { id: lr.id }, data: { status: "REJECTED", reviewNotes: "No" } });
    answerNextDialog(page);
    await page.getByRole("button", { name: /cancel leave request/i }).click();
    await expect(toast(page, "That request is already rejected. Refresh the page.")).toBeVisible();
    expect((await db.leaveRequest.findUniqueOrThrow({ where: { id: lr.id } })).status).toBe("REJECTED");
  });

  test("cancelling a request that was deleted says it no longer exists", async ({ page }) => {
    const start = mondayWindow(14);
    const lr = await createLeave({ start, end: start, days: 1 });
    await page.goto("/dashboard/leave");
    await db.leaveRequest.delete({ where: { id: lr.id } });
    answerNextDialog(page);
    await page.getByRole("button", { name: /cancel leave request/i }).click();
    await expect(toast(page, /no longer exists\. Refresh the page and try again/i)).toBeVisible();
  });
});

test.describe("leave: failures and double submits", () => {
  async function fillValid(page: Page) {
    const dialog = await openDialog(page);
    const start = mondayWindow(14);
    await pick(page, dialog, "Type", /^SICK/);
    await fillRange(dialog, start, start);
    return dialog;
  }

  test("connection dropped while submitting: clear error, no crash, nothing saved, retry works", async ({ page }) => {
    const dialog = await fillValid(page);
    const inject = await failServerActions(page, "abort", { times: 1 });
    await submit(dialog).click();
    await expect(toast(page, NETWORK_ERROR)).toBeVisible();
    await expectNoCrash(page);
    expect(inject.count()).toBe(1);
    expect(await db.leaveRequest.count({ where: { employeeId: leahId } })).toBe(0);
    // The dialog stays open with what was typed, so the same click works once the connection is back.
    await expect(dialog).toBeVisible();
    await expect(labelled(dialog, "Start date")).toHaveValue(mondayWindow(14));
    await submit(dialog).click();
    await expect(toast(page, "Leave request submitted (1 day)")).toBeVisible();
    expect(await db.leaveRequest.count({ where: { employeeId: leahId } })).toBe(1);
  });

  test("server error (500) while submitting: clear error, no crash, nothing saved", async ({ page }) => {
    const dialog = await fillValid(page);
    await failServerActions(page, "500");
    await submit(dialog).click();
    await expect(toast(page, SERVER_ERROR)).toBeVisible();
    await expectNoCrash(page);
    expect(await db.leaveRequest.count({ where: { employeeId: leahId } })).toBe(0);
  });

  test("page from an older deployment (stale server action): no crash, nothing saved", async ({ page }) => {
    const dialog = await fillValid(page);
    await failServerActions(page, "stale");
    await submit(dialog).click();
    await expect(toast(page, STALE_ERROR)).toBeVisible();
    await expectNoCrash(page);
    expect(await db.leaveRequest.count({ where: { employeeId: leahId } })).toBe(0);
  });

  test("double click on Submit sends one request and saves one row", async ({ page }) => {
    const dialog = await fillValid(page);
    const slow = await delayServerActions(page, 1500);
    await submit(dialog).dblclick();
    await expect(toast(page, "Leave request submitted (1 day)")).toBeVisible();
    expect(slow.count()).toBe(1);
    expect(await db.leaveRequest.count({ where: { employeeId: leahId } })).toBe(1);
  });

  test("server failure while cancelling: error shown, request stays pending", async ({ page }) => {
    const start = mondayWindow(14);
    const lr = await createLeave({ start, end: start, days: 1 });
    await page.goto("/dashboard/leave");
    await failServerActions(page, "abort");
    answerNextDialog(page);
    await page.getByRole("button", { name: /cancel leave request/i }).click();
    await expect(toast(page, NETWORK_ERROR)).toBeVisible();
    await expectNoCrash(page);
    expect((await db.leaveRequest.findUniqueOrThrow({ where: { id: lr.id } })).status).toBe("PENDING");
  });
});
