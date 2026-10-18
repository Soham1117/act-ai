import { test, expect, type Page } from "@playwright/test";
import { db } from "./support/db";
import { delayServerActions, expectNoCrash, failServerActions, toast } from "./support/helpers";
import { ADMIN_STATE } from "./support/test-data";
import { SS, empDbId, loginState } from "./support/self-service";

// Requests, admin side. Quinn is the requester here too (the two specs never overlap in time).
test.use({ storageState: ADMIN_STATE });

let quinnId: string;

test.beforeAll(async ({ browser }) => {
  await loginState(browser, SS.quinn, "quinn-admin-side");
  quinnId = await empDbId(SS.quinn);
});

test.afterAll(async () => {
  await db.request.deleteMany({ where: { employeeId: quinnId } });
});

test.beforeEach(async () => {
  await db.request.deleteMany({ where: { employeeId: quinnId } });
  await db.notificationRecipient.deleteMany({ where: { employeeId: quinnId } });
});

type Status = "PENDING" | "PROCESSING" | "COMPLETED" | "REJECTED";
async function make(status: Status = "PENDING", title = "Quinn request") {
  return db.request.create({
    data: {
      employeeId: quinnId,
      type: "ACCESS_REQUEST",
      title,
      description: "Please give me access",
      status,
      history: { create: [{ status: "PENDING", note: "Submitted by employee" }] },
    },
  });
}

const item = (page: Page, title = "Quinn request") => page.getByRole("listitem").filter({ hasText: title });
const menu = (page: Page, title?: string) => item(page, title).getByRole("button", { name: "Request actions" });
const load = (id: string) => db.request.findUniqueOrThrow({ where: { id }, include: { history: { orderBy: { updatedAt: "asc" } } } });
async function openAll(page: Page) {
  await page.goto("/admin/requests");
  await page.getByRole("tab", { name: /^All/ }).click();
  await expect(item(page)).toHaveCount(1);
}
async function choose(page: Page, name: string | RegExp, title?: string) {
  await menu(page, title).click();
  await page.getByRole("menuitem", { name }).click();
}
const notice = (title: string) =>
  db.notification.findFirstOrThrow({ where: { title, recipients: { some: { employeeId: quinnId } } } });

test.describe("admin requests: status changes", () => {
  test("marks a pending request as processing with a note; the employee is told", async ({ page }) => {
    const r = await make();
    await openAll(page);
    await choose(page, "Mark processing");
    const dlg = page.getByRole("dialog", { name: "Mark as processing" });
    await dlg.locator("textarea").fill("IT has been asked");
    await dlg.getByRole("button", { name: "Mark processing" }).click();
    await expect(toast(page, "processing")).toBeVisible();
    const after = await load(r.id);
    expect(after.status).toBe("PROCESSING");
    expect(after.adminNotes).toBe("IT has been asked");
    expect(after.history.map((h) => [h.status, h.note])).toEqual([
      ["PENDING", "Submitted by employee"],
      ["PROCESSING", "IT has been asked"],
    ]);
    expect(await db.auditLog.count({ where: { action: "request.status", resource: `Request:${r.id}` } })).toBe(1);
    const n = await notice("Request processing");
    expect(n.message).toBe('Your request "Quinn request" is being processed. Note: IT has been asked');
    await expect(item(page)).toContainText("PROCESSING");
    await page.getByRole("tab", { name: /^Processing/ }).click();
    await expect(item(page)).toHaveCount(1);
  });

  test("completes a processing request without a note", async ({ page }) => {
    const r = await make("PROCESSING");
    await openAll(page);
    await choose(page, "Complete");
    await page.getByRole("dialog", { name: "Complete request" }).getByRole("button", { name: "Complete" }).click();
    await expect(toast(page, "completed")).toBeVisible();
    expect((await load(r.id)).status).toBe("COMPLETED");
    expect((await notice("Request completed")).message).toBe('Your request "Quinn request" was completed.');
  });

  test("a pending request can be completed straight away", async ({ page }) => {
    const r = await make();
    await openAll(page);
    await choose(page, "Complete");
    await page.getByRole("dialog", { name: "Complete request" }).getByRole("button", { name: "Complete" }).click();
    await expect(toast(page, "completed")).toBeVisible();
    expect((await load(r.id)).status).toBe("COMPLETED");
  });

  test("rejecting needs a note of at least 2 characters, which the employee sees", async ({ page, browser }) => {
    const r = await make();
    await openAll(page);
    await choose(page, "Reject");
    const dlg = page.getByRole("dialog", { name: "Reject request" });
    const confirm = dlg.getByRole("button", { name: "Reject" });
    await expect(confirm).toBeDisabled();
    await dlg.locator("textarea").fill("x");
    await expect(confirm).toBeDisabled();
    await dlg.locator("textarea").fill("Not allowed by policy");
    await confirm.click();
    await expect(toast(page, "rejected")).toBeVisible();
    const after = await load(r.id);
    expect(after.status).toBe("REJECTED");
    expect(after.adminNotes).toBe("Not allowed by policy");
    expect((await notice("Request rejected")).message).toContain("Note: Not allowed by policy");

    const ctx = await browser.newContext({ storageState: "e2e/.auth/quinn-admin-side.json" });
    const qp = await ctx.newPage();
    await qp.goto("/dashboard/requests");
    await expect(qp.getByRole("listitem").filter({ hasText: "Quinn request" })).toContainText("Admin note: Not allowed by policy");
    await expect(qp.getByRole("listitem").filter({ hasText: "Quinn request" })).toContainText("REJECTED");
    await ctx.close();
  });

  test("completed and rejected requests can only be reopened, with a reason", async ({ page }) => {
    const done = await make("COMPLETED", "Done request");
    await make("REJECTED", "Refused request");
    await page.goto("/admin/requests");
    await page.getByRole("tab", { name: /^All/ }).click();
    await menu(page, "Done request").click();
    await expect(page.getByRole("menuitem", { name: "Reopen" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Mark processing" })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Complete" })).toHaveCount(0);
    await page.getByRole("menuitem", { name: "Reopen" }).click();
    const dlg = page.getByRole("dialog", { name: "Reopen request" });
    const confirm = dlg.getByRole("button", { name: "Reopen" });
    await expect(confirm).toBeDisabled();
    await dlg.locator("textarea").fill("Employee says it is still broken");
    await confirm.click();
    await expect(toast(page, "Reopened")).toBeVisible();
    const after = await load(done.id);
    expect(after.status).toBe("PENDING");
    expect(after.history.at(-1)).toMatchObject({ status: "PENDING", note: "Employee says it is still broken" });
    expect(await db.auditLog.count({ where: { action: "request.reopen", resource: `Request:${done.id}` } })).toBe(1);
    expect((await notice("Request pending")).message).toContain("was reopened");
  });

  test("a request the employee withdrew meanwhile cannot be moved to processing", async ({ page }) => {
    const r = await make();
    await openAll(page);
    await db.request.update({ where: { id: r.id }, data: { status: "REJECTED" } });
    await choose(page, "Mark processing");
    await page.getByRole("dialog", { name: "Mark as processing" }).getByRole("button", { name: "Mark processing" }).click();
    await expect(toast(page, "A rejected request cannot be moved to processing. Refresh the page.")).toBeVisible();
    expect((await load(r.id)).status).toBe("REJECTED");
  });

  test("a request deleted meanwhile says it no longer exists", async ({ page }) => {
    const r = await make();
    await openAll(page);
    await db.request.delete({ where: { id: r.id } });
    await choose(page, "Complete");
    await page.getByRole("dialog", { name: "Complete request" }).getByRole("button", { name: "Complete" }).click();
    await expect(toast(page, "That request no longer exists. Refresh the page.")).toBeVisible();
  });

  test("reopening a request that is no longer completed or rejected is refused", async ({ page }) => {
    const r = await make("COMPLETED");
    await openAll(page);
    await db.request.update({ where: { id: r.id }, data: { status: "PENDING" } });
    await choose(page, "Reopen");
    const dlg = page.getByRole("dialog", { name: "Reopen request" });
    await dlg.locator("textarea").fill("Reopen please");
    await dlg.getByRole("button", { name: "Reopen" }).click();
    await expect(toast(page, "Only completed or rejected requests can be reopened.")).toBeVisible();
  });

  test("an employee cannot open the admin requests page", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: "e2e/.auth/quinn-admin-side.json" });
    const qp = await ctx.newPage();
    await qp.goto("/admin/requests");
    await expect(qp).not.toHaveURL(/\/admin\/requests/);
    await ctx.close();
  });

  test("the Pending tab shows counts and only pending requests", async ({ page }) => {
    await make("PENDING", "Pending one");
    await make("PROCESSING", "Processing one");
    await page.goto("/admin/requests");
    await expect(item(page, "Pending one")).toHaveCount(1);
    await expect(item(page, "Processing one")).toHaveCount(0);
    await page.getByRole("tab", { name: /^Processing/ }).click();
    await expect(item(page, "Processing one")).toHaveCount(1);
    await expect(item(page, "Pending one")).toHaveCount(0);
  });
});

test.describe("admin requests: failures and double submits", () => {
  test("connection dropped while changing status: error shown, status unchanged", async ({ page }) => {
    const r = await make();
    await openAll(page);
    await choose(page, "Complete");
    await failServerActions(page, "abort");
    await page.getByRole("dialog", { name: "Complete request" }).getByRole("button", { name: "Complete" }).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect((await load(r.id)).status).toBe("PENDING");
  });

  test("server error (500) while rejecting: error shown, status unchanged", async ({ page }) => {
    const r = await make();
    await openAll(page);
    await choose(page, "Reject");
    const dlg = page.getByRole("dialog", { name: "Reject request" });
    await dlg.locator("textarea").fill("No can do");
    await failServerActions(page, "500");
    await dlg.getByRole("button", { name: "Reject" }).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect((await load(r.id)).status).toBe("PENDING");
  });

  test("stale deployment while reopening: error shown, status unchanged", async ({ page }) => {
    const r = await make("REJECTED");
    await openAll(page);
    await choose(page, "Reopen");
    const dlg = page.getByRole("dialog", { name: "Reopen request" });
    await dlg.locator("textarea").fill("Please retry");
    await failServerActions(page, "stale");
    await dlg.getByRole("button", { name: "Reopen" }).click();
    await expect(page.getByText(/something went wrong|refresh|newer version/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect((await load(r.id)).status).toBe("REJECTED");
  });

  test("double click on Complete completes once (one history entry, one notification)", async ({ page }) => {
    const r = await make();
    await openAll(page);
    await choose(page, "Complete");
    const slow = await delayServerActions(page, 1500);
    await page.getByRole("dialog", { name: "Complete request" }).getByRole("button", { name: "Complete" }).dblclick();
    await expect(toast(page, "completed")).toBeVisible();
    expect(slow.count()).toBe(1);
    expect((await load(r.id)).history.filter((h) => h.status === "COMPLETED")).toHaveLength(1);
    expect(
      await db.notificationRecipient.count({ where: { employeeId: quinnId, notification: { title: "Request completed" } } }),
    ).toBe(1);
  });
});
