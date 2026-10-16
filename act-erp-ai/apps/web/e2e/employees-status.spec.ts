import { test, expect, type Page } from "@playwright/test";
import { db, businessYmd } from "./support/db";
import { delayServerActions, expectNoCrash, failServerActions, openKiosk, toast } from "./support/helpers";
import {
  NEW_EMAIL_DOMAIN,
  PEOPLE,
  PEOPLE_PASSWORD,
  failedLogin,
  loginAs,
  personRow,
  personUrl,
  purgeNewPeople,
} from "./support/people";
import { ADMIN_STATE, KIOSK_ACTIVE_SLUG } from "./support/test-data";

test.use({ storageState: ADMIN_STATE });

test.afterAll(async () => {
  await purgeNewPeople();
  // Terry must be active again (active people need hours for payroll readiness).
  await db.employee.update({
    where: { employeeId: PEOPLE.terry.employeeId },
    data: { employmentStatus: "ACTIVE", terminationDate: null, terminationReason: null },
  });
  // Penny / Percy may have been approved or removed.
  const users = await db.user.findMany({
    where: { email: { in: [PEOPLE.pend1.email, PEOPLE.pend2.email] } },
    select: { id: true },
  });
  await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
});

const terminateDialog = (page: Page) => page.getByRole("dialog", { name: /terminate employee/i });
const dateInput = (d: ReturnType<Page["locator"]>) => d.locator('input[type="date"]');

async function openTerry(page: Page) {
  await page.goto(await personUrl("terry"));
  await expect(page.getByText(PEOPLE.terry.name).first()).toBeVisible();
}

async function terminateTerry(page: Page, date?: string, reason?: string) {
  await openTerry(page);
  await page.getByRole("button", { name: /^terminate$/i }).click();
  const d = terminateDialog(page);
  if (date) await dateInput(d).fill(date);
  if (reason) await d.getByPlaceholder(/resigned/i).fill(reason);
  await d.getByRole("button", { name: /^terminate$/i }).click();
}

async function setTerry(data: Record<string, unknown>) {
  await db.employee.update({ where: { employeeId: PEOPLE.terry.employeeId }, data });
}

test.describe("admin: terminate and reactivate", () => {
  test("terminating keeps read-only sign-in, removes them from the kiosk, then reactivating restores everything", async ({
    page,
    browser,
  }) => {
    const before = await personRow("terry");
    await terminateTerry(page, undefined, "Left for another job");
    await expect(toast(page, "Employee terminated")).toBeVisible();

    const t = await personRow("terry");
    expect(t.employmentStatus).toBe("TERMINATED");
    expect(t.terminationReason).toBe("Left for another job");
    expect(t.terminationDate?.toISOString().slice(0, 10)).toBe(businessYmd(0));
    expect(t.user.tokenVersion).toBe(before.user.tokenVersion + 1); // sessions revoked
    expect(
      await db.notificationRecipient.count({ where: { employeeId: t.id } }),
    ).toBeGreaterThan(0);

    // Inside the 60-day window they can still sign in, but read-only.
    const mine = await loginAs(browser, PEOPLE.terry.email, PEOPLE_PASSWORD);
    await expect(mine.getByRole("status").filter({ hasText: /your employment has ended/i })).toBeVisible();
    await mine.context().close();

    // Not on the kiosk roster; typing their ID is refused.
    const kiosk = await openKiosk(browser, KIOSK_ACTIVE_SLUG);
    await expect(kiosk.getByRole("button", { name: new RegExp(PEOPLE.edith.name) }).first()).toBeVisible();
    await expect(kiosk.getByText(PEOPLE.terry.name)).toHaveCount(0);
    await kiosk.getByRole("button", { name: /enter id/i }).click();
    await kiosk.getByPlaceholder("Full ID or last digits").fill(PEOPLE.terry.employeeId);
    await kiosk.getByPlaceholder("Full ID or last digits").press("Enter");
    await expect(toast(kiosk, /isn.t active for kiosk use/i)).toBeVisible();
    await kiosk.context().close();

    // Reactivate.
    await openTerry(page);
    await page.getByRole("button", { name: /^reactivate$/i }).click();
    await expect(toast(page, "Employee reactivated")).toBeVisible();
    const back = await personRow("terry");
    expect(back.employmentStatus).toBe("ACTIVE");
    expect(back.terminationDate).toBeNull();
    expect(back.terminationReason).toBeNull();

    const again = await loginAs(browser, PEOPLE.terry.email, PEOPLE_PASSWORD);
    await expect(again.getByRole("status").filter({ hasText: /your employment has ended/i })).toHaveCount(0);
    await again.context().close();
    const kiosk2 = await openKiosk(browser, KIOSK_ACTIVE_SLUG);
    await expect(kiosk2.getByRole("button", { name: new RegExp(PEOPLE.terry.name) }).first()).toBeVisible();
    await kiosk2.context().close();
  });

  test("terminated more than 60 days ago: sign-in is refused", async ({ page, browser }) => {
    const old = businessYmd(100);
    await terminateTerry(page, old);
    await expect(toast(page, "Employee terminated")).toBeVisible();
    const p = await failedLogin(browser, PEOPLE.terry.email, PEOPLE_PASSWORD);
    await expect(p.getByText(/no longer has access/i)).toBeVisible();
    await expect(p).toHaveURL(/\/login/);
    await p.context().close();
    await setTerry({ employmentStatus: "ACTIVE", terminationDate: null, terminationReason: null });
  });

  test("a future termination date is refused and nothing changes", async ({ page }) => {
    await terminateTerry(page, businessYmd(-5));
    await expect(toast(page, /can.t be in the future/i)).toBeVisible();
    expect((await personRow("terry")).employmentStatus).toBe("ACTIVE");
  });

  test("a termination year before 1990 is refused", async ({ page }) => {
    await terminateTerry(page, "1980-01-01");
    await expect(toast(page, /looks wrong/i)).toBeVisible();
    expect((await personRow("terry")).employmentStatus).toBe("ACTIVE");
  });

  test("terminate: server failure shows an error and keeps them active", async ({ page }) => {
    await openTerry(page);
    await page.getByRole("button", { name: /^terminate$/i }).click();
    await failServerActions(page, "abort");
    await terminateDialog(page).getByRole("button", { name: /^terminate$/i }).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect((await personRow("terry")).employmentStatus).toBe("ACTIVE");
  });

  test("terminate: double click records one termination", async ({ page }) => {
    const auditsBefore = await db.auditLog.count({ where: { action: "employee.status_change", resource: `Employee:${(await personRow("terry")).id}` } });
    await openTerry(page);
    await page.getByRole("button", { name: /^terminate$/i }).click();
    const calls = await delayServerActions(page, 1500);
    await terminateDialog(page).getByRole("button", { name: /^terminate$/i }).dblclick();
    await expect(toast(page, "Employee terminated")).toBeVisible();
    expect(calls.count()).toBe(1);
    expect(await db.auditLog.count({ where: { action: "employee.status_change", resource: `Employee:${(await personRow("terry")).id}` } })).toBe(auditsBefore + 1);
    await setTerry({ employmentStatus: "ACTIVE", terminationDate: null, terminationReason: null });
  });

  test("terminate: page from an older deployment saves nothing", async ({ page }) => {
    await openTerry(page);
    await page.getByRole("button", { name: /^terminate$/i }).click();
    await failServerActions(page, "stale");
    await terminateDialog(page).getByRole("button", { name: /^terminate$/i }).click();
    await expect.poll(async () => (await page.getByText(/something went wrong|refresh|reload|try again/i).count()) > 0).toBe(true);
    expect((await personRow("terry")).employmentStatus).toBe("ACTIVE");
  });

  test("an employee deleted by someone else gives a clear message", async ({ page }) => {
    const user = await db.user.create({ data: { email: `ppnew-gone@${NEW_EMAIL_DOMAIN}`, name: "Gone Soon", role: "EMPLOYEE" } });
    const e = await db.employee.create({
      data: { employeeId: "PPL-9001", userId: user.id, name: "Gone Soon", email: user.email, gender: "OTHER", employmentType: "FULL_PART_TIME", compensationType: "HOURLY_RATE" },
    });
    await page.goto(`/admin/employees/${e.id}`);
    await page.getByRole("button", { name: /^terminate$/i }).click();
    await db.user.delete({ where: { id: user.id } });
    await terminateDialog(page).getByRole("button", { name: /^terminate$/i }).click();
    await expect(toast(page, /employee was not found/i)).toBeVisible();
  });
});

/** Tick one row. Searches first so the row is on screen whatever else is seeded (pagination); the
 * search clears the selection, so to tick several rows pass search: null for the later ones. */
async function tick(page: Page, name: string, opts: { search?: string | null } = {}) {
  const term = opts.search === undefined ? name : opts.search;
  if (term) await page.getByPlaceholder(/search name/i).fill(term);
  await page.getByRole("row").filter({ hasText: name }).getByRole("checkbox").click();
}

test.describe("admin: bulk actions", () => {
  test("bulk terminate: failure keeps them active", async ({ page }) => {
    await page.goto("/admin/employees");
    await tick(page, PEOPLE.bulkA.name);
    await page.getByRole("button", { name: /^terminate 1$/i }).click();
    await failServerActions(page, "abort");
    await page.getByRole("dialog").getByRole("button", { name: /^terminate$/i }).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    expect((await personRow("bulkA")).employmentStatus).toBe("ACTIVE");
  });

  test("bulk terminate two employees; they are removed from the active list", async ({ page }) => {
    await page.goto("/admin/employees");
    await tick(page, PEOPLE.bulkA.name, { search: "Bulk" });
    await tick(page, PEOPLE.bulkB.name, { search: null });
    await page.getByRole("button", { name: /^terminate 2$/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder(/resigned/i).fill("Season ended");
    await dialog.getByRole("button", { name: /^terminate$/i }).click();
    await expect(toast(page, /terminated 2 employees/i)).toBeVisible();
    for (const k of ["bulkA", "bulkB"] as const) {
      const e = await personRow(k);
      expect(e.employmentStatus).toBe("TERMINATED");
      expect(e.terminationReason).toBe("Season ended");
    }
    await expect(page.getByRole("row").filter({ hasText: PEOPLE.bulkA.name })).toHaveCount(0);
  });

  // BUG (app): bulkTerminateEmployees (src/server/actions/employees.ts) does not bump
  // User.tokenVersion, unlike setEmploymentStatus, so a bulk-terminated person's existing
  // sessions are not revoked. Fix: increment tokenVersion for the eligible users in the same
  // transaction as the status update.
  test.fixme("bulk terminate revokes the sessions of the people it terminates", async ({ page }) => {
    const before = (await personRow("bulkB")).user.tokenVersion;
    await db.employee.update({ where: { employeeId: PEOPLE.bulkB.employeeId }, data: { employmentStatus: "ACTIVE", terminationDate: null } });
    await page.goto("/admin/employees");
    await tick(page, PEOPLE.bulkB.name);
    await page.getByRole("button", { name: /^terminate 1$/i }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^terminate$/i }).click();
    await expect(toast(page, /terminated 1 employee/i)).toBeVisible();
    expect((await personRow("bulkB")).user.tokenVersion).toBe(before + 1);
  });

  test("bulk terminate of someone already terminated says there is nothing to do", async ({ page }) => {
    await page.goto("/admin/employees");
    await page.getByLabel(/show inactive/i).click();
    await tick(page, PEOPLE.bulkC.name);
    await page.getByRole("button", { name: /^terminate 1$/i }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^terminate$/i }).click();
    await expect(toast(page, /nothing to terminate/i)).toBeVisible();
  });

  test("bulk delete needs the word DELETE; history needs the force box; then the person is gone", async ({ page }) => {
    await page.goto("/admin/employees");
    await tick(page, PEOPLE.bulkD.name);
    await page.getByRole("button", { name: /^delete 1$/i }).click();
    const dialog = page.getByRole("dialog");
    const go = dialog.getByRole("button", { name: /delete permanently/i });
    await expect(go).toBeDisabled();
    await dialog.locator("input:not([type=checkbox])").fill("delete"); // wrong case
    await expect(go).toBeDisabled();
    await dialog.locator("input:not([type=checkbox])").fill("DELETE");
    await go.click();
    await expect(dialog.getByText(/records that would be destroyed/i)).toBeVisible();
    expect(await db.employee.count({ where: { employeeId: PEOPLE.bulkD.employeeId } })).toBe(1);

    await dialog.getByRole("checkbox").click();
    await go.click();
    await expect(toast(page, /deleted 1 employee/i)).toBeVisible();
    expect(await db.employee.count({ where: { employeeId: PEOPLE.bulkD.employeeId } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: "employee.delete" } })).toBeGreaterThan(0);
  });

  test("bulk delete of an employee without history; failure and double click", async ({ page }) => {
    await page.goto("/admin/employees");
    await page.getByLabel(/show inactive/i).click();
    await tick(page, PEOPLE.bulkC.name);
    await page.getByRole("button", { name: /^delete 1$/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("input:not([type=checkbox])").fill("DELETE");
    await failServerActions(page, "abort", { times: 1 });
    await dialog.getByRole("button", { name: /delete permanently/i }).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    expect(await db.employee.count({ where: { employeeId: PEOPLE.bulkC.employeeId } })).toBe(1);

    await page.reload();
    await page.getByLabel(/show inactive/i).click();
    await tick(page, PEOPLE.bulkC.name);
    await page.getByRole("button", { name: /^delete 1$/i }).click();
    await page.getByRole("dialog").locator("input:not([type=checkbox])").fill("DELETE");
    const calls = await delayServerActions(page, 1500);
    await page.getByRole("dialog").getByRole("button", { name: /delete permanently/i }).dblclick();
    await expect(toast(page, /deleted 1 employee/i)).toBeVisible();
    expect(calls.count()).toBe(1);
    expect(await db.employee.count({ where: { employeeId: PEOPLE.bulkC.employeeId } })).toBe(0);
  });

  test("admin accounts cannot be ticked", async ({ page }) => {
    const rory = await personRow("rory");
    await db.user.update({ where: { id: rory.userId }, data: { role: "ADMIN" } });
    try {
      await page.goto("/admin/employees");
      await page.getByPlaceholder(/search name/i).fill(PEOPLE.rory.name);
      await expect(page.getByRole("row").filter({ hasText: PEOPLE.rory.name }).getByRole("checkbox")).toBeDisabled();
    } finally {
      await db.user.update({ where: { id: rory.userId }, data: { role: "EMPLOYEE" } });
    }
  });
});

test.describe("admin: approve or reject a pending hire", () => {
  test("approving moves the hire to ACTIVE and notifies them; a second approve is refused", async ({ page }) => {
    await page.goto("/admin/employees");
    const card = page.locator("div").filter({ hasText: PEOPLE.pend1.name }).filter({ has: page.getByRole("button", { name: /approve/i }) }).last();
    await card.getByRole("button", { name: /approve/i }).click();
    await expect(toast(page, `${PEOPLE.pend1.name} approved`)).toBeVisible();
    const e = await personRow("pend1");
    expect(e.employmentStatus).toBe("ACTIVE");
    expect(await db.auditLog.count({ where: { action: "employee.approve", resource: `Employee:${e.id}` } })).toBe(1);
    expect(await db.notificationRecipient.count({ where: { employeeId: e.id } })).toBeGreaterThan(0);
  });

  test("approve on a stale page says the hire is no longer awaiting review", async ({ page }) => {
    const user = await db.user.create({ data: { email: `ppnew-stale@${NEW_EMAIL_DOMAIN}`, name: "Stale Pending", role: "EMPLOYEE" } });
    await db.employee.create({
      data: { employeeId: "PPL-9002", userId: user.id, name: "Stale Pending", email: user.email, gender: "OTHER", employmentType: "FULL_PART_TIME", compensationType: "HOURLY_RATE", employmentStatus: "PENDING_REVIEW" },
    });
    await page.goto("/admin/employees");
    await db.employee.update({ where: { employeeId: "PPL-9002" }, data: { employmentStatus: "ACTIVE" } });
    const card = page.locator("div").filter({ hasText: "Stale Pending" }).filter({ has: page.getByRole("button", { name: /approve/i }) }).last();
    await card.getByRole("button", { name: /approve/i }).click();
    await expect(toast(page, /no longer awaiting review/i)).toBeVisible();
  });

  test("rejecting deletes the account and record; failure keeps them", async ({ page }) => {
    await page.goto("/admin/employees");
    const card = page.locator("div").filter({ hasText: PEOPLE.pend2.name }).filter({ has: page.getByRole("button", { name: /reject/i }) }).last();
    await card.getByRole("button", { name: /reject/i }).click();
    const dialog = page.getByRole("dialog");
    await failServerActions(page, "abort", { times: 1 });
    await dialog.getByRole("button", { name: /reject and delete/i }).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    expect(await db.employee.count({ where: { employeeId: PEOPLE.pend2.employeeId } })).toBe(1);

    await page.reload();
    await page.locator("div").filter({ hasText: PEOPLE.pend2.name }).filter({ has: page.getByRole("button", { name: /reject/i }) }).last().getByRole("button", { name: /reject/i }).click();
    await page.getByRole("dialog").getByRole("button", { name: /reject and delete/i }).click();
    await expect(toast(page, `${PEOPLE.pend2.name} rejected`)).toBeVisible();
    expect(await db.employee.count({ where: { employeeId: PEOPLE.pend2.employeeId } })).toBe(0);
    expect(await db.user.count({ where: { email: PEOPLE.pend2.email } })).toBe(0);
  });
});
