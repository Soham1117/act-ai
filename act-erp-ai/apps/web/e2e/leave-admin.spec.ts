import { test, expect, type Page } from "@playwright/test";
import { db } from "./support/db";
import { delayServerActions, expectNoCrash, failServerActions, toast } from "./support/helpers";
import { ADMIN_STATE } from "./support/test-data";
import {
  SS,
  addDays,
  currentYear,
  dateOnly,
  empDbId,
  labelled,
  loginState,
  mondayWindow,
  pick,
} from "./support/self-service";

// Leave, admin side. Dedicated employee: Lou. Admin session from global setup.
test.use({ storageState: ADMIN_STATE });

let louId: string;
let adminUserId: string;

test.beforeAll(async () => {
  louId = await empDbId(SS.lou);
  adminUserId = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
});

test.afterAll(async () => {
  // Leave policy is global: never leave a changed policy behind for other specs.
  await db.leavePolicy.deleteMany();
});

test.beforeEach(async () => {
  await db.leaveRequest.deleteMany({ where: { employeeId: louId } });
  await db.leaveAdjustment.deleteMany({ where: { employeeId: louId } });
  await db.leavePolicy.deleteMany();
  await db.notificationRecipient.deleteMany({ where: { employeeId: louId } });
});

type Status = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
async function louLeave(
  start: string,
  end: string,
  days: number,
  opts: { type?: "SICK" | "VACATION"; status?: Status } = {},
) {
  return db.leaveRequest.create({
    data: {
      employeeId: louId,
      leaveType: opts.type ?? "SICK",
      startDate: dateOnly(start),
      endDate: dateOnly(end),
      totalDays: days,
      status: opts.status ?? "PENDING",
    },
  });
}

const row = (page: Page) => page.getByRole("listitem").filter({ hasText: SS.lou.name });
const dialogOf = (page: Page, name: string | RegExp) => page.getByRole("dialog", { name });

async function openPending(page: Page) {
  await page.goto("/admin/leave");
  await expect(row(page)).toHaveCount(1);
}

test.describe("admin leave: review", () => {
  test("approves with a note: status, notification, audit log and balances", async ({ page }) => {
    const start = mondayWindow(14);
    const lr = await louLeave(start, addDays(start, 1), 2);
    await openPending(page);
    await row(page).getByRole("button", { name: /approve/i }).click();
    const dlg = dialogOf(page, "Approve leave");
    await dlg.locator("textarea").fill("Enjoy the time off");
    await dlg.getByRole("button", { name: /^approve$/i }).click();
    await expect(toast(page, "Approved")).toBeVisible();

    const after = await db.leaveRequest.findUniqueOrThrow({ where: { id: lr.id } });
    expect(after.status).toBe("APPROVED");
    expect(after.reviewNotes).toBe("Enjoy the time off");
    expect(after.reviewedAt).not.toBeNull();
    expect(await db.auditLog.count({ where: { action: "leave.approve", resource: `LeaveRequest:${lr.id}` } })).toBe(1);
    const note = await db.notification.findFirstOrThrow({
      where: { title: "Leave request approved", recipients: { some: { employeeId: louId } } },
    });
    expect(note.message).toContain("Note: Enjoy the time off");

    // Leaves the pending list, shows up under recent decisions.
    await expect(row(page)).toHaveCount(0);
    await page.getByRole("tab", { name: "Recent decisions" }).click();
    await expect(row(page)).toContainText("APPROVED");
  });

  test("rejecting needs a reason; the reason is stored and sent to the employee", async ({ page }) => {
    const start = mondayWindow(14);
    const lr = await louLeave(start, start, 1);
    await openPending(page);
    await row(page).getByRole("button", { name: "Reject" }).click();
    const dlg = dialogOf(page, "Reject leave");
    const confirm = dlg.getByRole("button", { name: /^reject$/i });
    await expect(confirm).toBeDisabled(); // no reason yet
    await dlg.locator("textarea").fill("   ");
    await expect(confirm).toBeDisabled(); // blanks do not count
    await dlg.locator("textarea").fill("Team is short that week");
    await confirm.click();
    await expect(toast(page, "Rejected")).toBeVisible();
    const after = await db.leaveRequest.findUniqueOrThrow({ where: { id: lr.id } });
    expect(after.status).toBe("REJECTED");
    expect(after.reviewNotes).toBe("Team is short that week");
    const note = await db.notification.findFirstOrThrow({
      where: { title: "Leave request rejected", recipients: { some: { employeeId: louId } } },
    });
    expect(note.message).toContain("Team is short that week");
  });

  test("approval that would overlap already-approved leave is refused and stays pending", async ({ page }) => {
    const start = mondayWindow(14);
    await louLeave(start, addDays(start, 1), 2, { status: "APPROVED" });
    const pending = await louLeave(addDays(start, 1), addDays(start, 2), 2, { type: "VACATION" });
    await openPending(page);
    await row(page).getByRole("button", { name: /approve/i }).click();
    await dialogOf(page, "Approve leave").getByRole("button", { name: /^approve$/i }).click();
    await expect(toast(page, /overlaps already-approved sick leave/i)).toBeVisible();
    expect((await db.leaveRequest.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("PENDING");
  });

  test("approval beyond the balance needs the override and a reason", async ({ page }) => {
    const start = mondayWindow(14, 30);
    await louLeave(start, addDays(start, 3), 4, { status: "APPROVED" }); // 4 of 5 sick days used
    const pending = await louLeave(addDays(start, 14), addDays(start, 16), 3); // +3 = 7 > 5
    await openPending(page);
    await row(page).getByRole("button", { name: /approve/i }).click();
    const dlg = dialogOf(page, "Approve leave");
    await dlg.getByRole("button", { name: /^approve$/i }).click();
    await expect(
      toast(page, new RegExp(`below zero for ${start.slice(0, 4)}.*override`, "i")),
    ).toBeVisible();
    expect((await db.leaveRequest.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("PENDING");

    // Tick the override: now a reason is mandatory.
    await dlg.getByRole("checkbox", { name: /approve even if this exceeds/i }).click();
    const confirm = dlg.getByRole("button", { name: /^approve$/i });
    await expect(confirm).toBeDisabled();
    await dlg.locator("textarea").fill("Approved by director, doctor's note");
    await confirm.click();
    await expect(toast(page, "Approved")).toBeVisible();
    expect((await db.leaveRequest.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("APPROVED");
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: "leave.approve", resource: `LeaveRequest:${pending.id}` },
    });
    expect(JSON.stringify(audit.diff)).toContain('"overrideBalance":true');
  });

  test("a request somebody else already decided is reported, not changed twice", async ({ page }) => {
    const start = mondayWindow(14);
    const lr = await louLeave(start, start, 1);
    await openPending(page);
    await db.leaveRequest.update({ where: { id: lr.id }, data: { status: "CANCELLED" } }); // employee withdrew meanwhile
    await row(page).getByRole("button", { name: /approve/i }).click();
    await dialogOf(page, "Approve leave").getByRole("button", { name: /^approve$/i }).click();
    await expect(toast(page, "That request is already cancelled. Refresh the page.")).toBeVisible();
    expect((await db.leaveRequest.findUniqueOrThrow({ where: { id: lr.id } })).status).toBe("CANCELLED");
  });

  test("a request deleted meanwhile says it no longer exists", async ({ page }) => {
    const start = mondayWindow(14);
    const lr = await louLeave(start, start, 1);
    await openPending(page);
    await db.leaveRequest.delete({ where: { id: lr.id } });
    await row(page).getByRole("button", { name: /approve/i }).click();
    await dialogOf(page, "Approve leave").getByRole("button", { name: /^approve$/i }).click();
    await expect(toast(page, "That leave request no longer exists. Refresh the page.")).toBeVisible();
  });

  test("cancels already-approved leave with a mandatory reason", async ({ page }) => {
    const start = mondayWindow(14);
    const lr = await louLeave(start, addDays(start, 1), 2, { status: "APPROVED" });
    await db.leaveRequest.update({ where: { id: lr.id }, data: { reviewedAt: new Date() } });
    await page.goto("/admin/leave");
    await page.getByRole("tab", { name: "Recent decisions" }).click();
    await row(page).getByRole("button", { name: /^cancel$/i }).click();
    const dlg = dialogOf(page, "Cancel approved leave");
    const confirm = dlg.getByRole("button", { name: /^cancel leave$/i });
    await expect(confirm).toBeDisabled();
    await dlg.locator("textarea").fill("Project deadline moved up");
    await confirm.click();
    await expect(toast(page, "Leave cancelled")).toBeVisible();
    const after = await db.leaveRequest.findUniqueOrThrow({ where: { id: lr.id } });
    expect(after.status).toBe("CANCELLED");
    expect(after.reviewNotes).toBe("Project deadline moved up");
    expect(await db.auditLog.count({ where: { action: "leave.admin_cancel", resource: `LeaveRequest:${lr.id}` } })).toBe(1);
    const note = await db.notification.findFirstOrThrow({
      where: { title: "Leave cancelled by an admin", recipients: { some: { employeeId: louId } } },
    });
    expect(note.message).toContain("Project deadline moved up");
  });

  test("an employee cannot open the admin leave page", async ({ browser }) => {
    const state = await loginState(browser, SS.lou, "lou");
    const ctx = await browser.newContext({ storageState: state });
    const page = await ctx.newPage();
    await page.goto("/admin/leave");
    await expect(page.getByRole("heading", { name: "Leave management" })).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/admin\/leave/);
    await ctx.close();
  });
});

test.describe("admin leave: balances and policy", () => {
  const louRow = (page: Page) => page.getByRole("row").filter({ hasText: SS.lou.name });

  async function openAdjust(page: Page) {
    await page.goto("/admin/leave");
    await page.getByRole("tab", { name: "Balances" }).click();
    await louRow(page).getByRole("button", { name: /adjust/i }).click();
    return dialogOf(page, "Adjust leave balance");
  }

  test("adds sick days to a balance: row, notification and audit log", async ({ page }) => {
    const dlg = await openAdjust(page);
    await pick(page, dlg, "Leave type", "SICK");
    await labelled(dlg, "Days").fill("2");
    await labelled(dlg, "Reason").fill("Extra days for surgery recovery");
    await dlg.getByRole("button", { name: /save adjustment/i }).click();
    await expect(toast(page, "Balance adjusted")).toBeVisible();
    const adj = await db.leaveAdjustment.findFirstOrThrow({ where: { employeeId: louId } });
    expect(Number(adj.days)).toBe(2);
    expect(adj.leaveType).toBe("SICK");
    expect(adj.year).toBe(currentYear());
    expect(adj.reason).toBe("Extra days for surgery recovery");
    expect(adj.createdById).toBe(adminUserId);
    expect(await db.auditLog.count({ where: { action: "leave.adjust", resource: `LeaveAdjustment:${adj.id}` } })).toBe(1);
    await db.notification.findFirstOrThrow({
      where: { title: "Leave balance adjusted", recipients: { some: { employeeId: louId } } },
    });
    // Balances tab: allowed 30 + 2 = 32 for a clean employee.
    await expect(louRow(page)).toContainText("32");
  });

  test("a negative adjustment deducts days", async ({ page }) => {
    const dlg = await openAdjust(page);
    await pick(page, dlg, "Leave type", "PERSONAL");
    await labelled(dlg, "Days").fill("-1.5");
    await labelled(dlg, "Reason").fill("Used days not on record");
    await dlg.getByRole("button", { name: /save adjustment/i }).click();
    await expect(toast(page, "Balance adjusted")).toBeVisible();
    expect(Number((await db.leaveAdjustment.findFirstOrThrow({ where: { employeeId: louId } })).days)).toBe(-1.5);
  });

  test("Save stays disabled for zero days or a too-short reason", async ({ page }) => {
    const dlg = await openAdjust(page);
    const save = dlg.getByRole("button", { name: /save adjustment/i });
    await expect(save).toBeDisabled();
    await labelled(dlg, "Days").fill("0");
    await labelled(dlg, "Reason").fill("Valid reason");
    await expect(save).toBeDisabled();
    await labelled(dlg, "Days").fill("1");
    await labelled(dlg, "Reason").fill("ab");
    await expect(save).toBeDisabled();
    await labelled(dlg, "Reason").fill("abc");
    await expect(save).toBeEnabled();
    expect(await db.leaveAdjustment.count({ where: { employeeId: louId } })).toBe(0);
  });

  test("an adjustment that rounds to zero and one that is far too large are refused", async ({ page }) => {
    const dlg = await openAdjust(page);
    await labelled(dlg, "Reason").fill("Rounding check");
    await labelled(dlg, "Days").fill("0.04"); // rounds to 0.0
    await dlg.getByRole("button", { name: /save adjustment/i }).click();
    await expect(toast(page, "Enter a non-zero number of days (use a minus sign to deduct).")).toBeVisible();
    await labelled(dlg, "Days").fill("400");
    await dlg.getByRole("button", { name: /save adjustment/i }).click();
    await expect(toast(page, "That adjustment is too large.")).toBeVisible();
    expect(await db.leaveAdjustment.count({ where: { employeeId: louId } })).toBe(0);
  });

  test("changing the sick-leave policy changes everyone's allowance and is audited", async ({ page }) => {
    await page.goto("/admin/leave");
    await page.getByRole("tab", { name: "Policy" }).click();
    const sick = page.getByRole("row").filter({ hasText: /^SICK/ });
    await sick.locator('input[type="number"]').first().fill("8");
    await page.getByRole("button", { name: /save policy/i }).click();
    await expect(toast(page, "Leave policy saved")).toBeVisible();
    const saved = await db.leavePolicy.findUniqueOrThrow({ where: { leaveType: "SICK" } });
    expect(Number(saved.daysPerYear)).toBe(8);
    expect(await db.auditLog.count({ where: { action: "leave.policy_update" } })).toBeGreaterThan(0);
    await page.getByRole("tab", { name: "Balances" }).click();
    await expect(louRow(page)).toContainText("33"); // 30 - 5 + 8
  });

  test("making a type unlimited removes the balance limit", async ({ page }) => {
    await page.goto("/admin/leave");
    await page.getByRole("tab", { name: "Policy" }).click();
    await page.getByRole("checkbox", { name: "SICK unlimited" }).click();
    await page.getByRole("button", { name: /save policy/i }).click();
    await expect(toast(page, "Leave policy saved")).toBeVisible();
    const saved = await db.leavePolicy.findUniqueOrThrow({ where: { leaveType: "SICK" } });
    expect(saved.unlimited).toBe(true);
    await page.getByRole("tab", { name: "Balances" }).click();
    await expect(louRow(page)).toContainText("25"); // sick no longer counted: 10+10+3+2
  });

  test("a policy value above 365 days is rejected and nothing is saved", async ({ page }) => {
    await page.goto("/admin/leave");
    await page.getByRole("tab", { name: "Policy" }).click();
    const sick = page.getByRole("row").filter({ hasText: /^SICK/ });
    await sick.locator('input[type="number"]').first().fill("400");
    await page.getByRole("button", { name: /save policy/i }).click();
    await expect(toast(page, /Check policies\.\d+\.daysPerYear/)).toBeVisible();
    expect(await db.leavePolicy.count()).toBe(0);
  });
});

test.describe("admin leave: failures and double submits", () => {
  test("connection dropped while approving: error screen, nothing saved", async ({ page }) => {
    const start = mondayWindow(14);
    const lr = await louLeave(start, start, 1);
    await openPending(page);
    await row(page).getByRole("button", { name: /approve/i }).click();
    await failServerActions(page, "abort");
    await dialogOf(page, "Approve leave").getByRole("button", { name: /^approve$/i }).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect((await db.leaveRequest.findUniqueOrThrow({ where: { id: lr.id } })).status).toBe("PENDING");
  });

  test("server error (500) while rejecting: error shown, nothing saved", async ({ page }) => {
    const start = mondayWindow(14);
    const lr = await louLeave(start, start, 1);
    await openPending(page);
    await row(page).getByRole("button", { name: "Reject" }).click();
    const dlg = dialogOf(page, "Reject leave");
    await dlg.locator("textarea").fill("Not possible");
    await failServerActions(page, "500");
    await dlg.getByRole("button", { name: /^reject$/i }).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect((await db.leaveRequest.findUniqueOrThrow({ where: { id: lr.id } })).status).toBe("PENDING");
  });

  test("stale deployment while saving policy: error shown, nothing saved", async ({ page }) => {
    await page.goto("/admin/leave");
    await page.getByRole("tab", { name: "Policy" }).click();
    await failServerActions(page, "stale");
    await page.getByRole("button", { name: /save policy/i }).click();
    await expect(page.getByText(/something went wrong|refresh|newer version/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect(await db.leavePolicy.count()).toBe(0);
  });

  test("double click on Approve decides once (one audit entry, one notification)", async ({ page }) => {
    const start = mondayWindow(14);
    const lr = await louLeave(start, start, 1);
    await openPending(page);
    await row(page).getByRole("button", { name: /approve/i }).click();
    const slow = await delayServerActions(page, 1500);
    await dialogOf(page, "Approve leave").getByRole("button", { name: /^approve$/i }).dblclick();
    await expect(toast(page, "Approved")).toBeVisible();
    expect(slow.count()).toBe(1);
    expect(await db.auditLog.count({ where: { action: "leave.approve", resource: `LeaveRequest:${lr.id}` } })).toBe(1);
    expect(
      await db.notificationRecipient.count({
        where: { employeeId: louId, notification: { title: "Leave request approved" } },
      }),
    ).toBe(1);
  });

  test("double click on Save adjustment adds the days once", async ({ page }) => {
    await page.goto("/admin/leave");
    await page.getByRole("tab", { name: "Balances" }).click();
    await page.getByRole("row").filter({ hasText: SS.lou.name }).getByRole("button", { name: /adjust/i }).click();
    const dlg = dialogOf(page, "Adjust leave balance");
    await labelled(dlg, "Days").fill("1");
    await labelled(dlg, "Reason").fill("Double click check");
    const slow = await delayServerActions(page, 1500);
    await dlg.getByRole("button", { name: /save adjustment/i }).dblclick();
    await expect(toast(page, "Balance adjusted")).toBeVisible();
    expect(slow.count()).toBe(1);
    expect(await db.leaveAdjustment.count({ where: { employeeId: louId } })).toBe(1);
  });
});
