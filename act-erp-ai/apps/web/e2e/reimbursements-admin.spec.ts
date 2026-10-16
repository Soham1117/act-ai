import { test, expect, type Page } from "@playwright/test";
import { db } from "./support/db";
import { delayServerActions, expectNoCrash, failServerActions, toast } from "./support/helpers";
import { ADMIN_STATE } from "./support/test-data";
import { SS, empDbId, labelled, loginState, pdfFile, putFakeS3, statValue } from "./support/self-service";

// Reimbursements, admin side. Dedicated employee: Rita. Admin session from global setup.
test.use({ storageState: ADMIN_STATE });

let ritaId: string;

test.beforeAll(async ({ browser }) => {
  await loginState(browser, SS.rita, "rita");
  ritaId = await empDbId(SS.rita);
});

test.afterAll(async () => {
  await db.reimbursement.deleteMany({ where: { employeeId: ritaId } });
});

test.beforeEach(async () => {
  await db.reimbursement.deleteMany({ where: { employeeId: ritaId } });
  await db.notificationRecipient.deleteMany({ where: { employeeId: ritaId } });
});

async function claim(
  over: { title?: string; amount?: number; status?: "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "PAID"; createdAt?: Date } = {},
) {
  return db.reimbursement.create({
    data: {
      employeeId: ritaId,
      title: over.title ?? "Rita claim",
      category: "TRAVEL",
      amount: over.amount ?? 100,
      description: "Admin review test",
      expenseDate: new Date(),
      status: over.status ?? "PENDING",
      createdAt: over.createdAt,
      history: { create: [{ status: "PENDING", note: "Submitted" }] },
    },
  });
}

const item = (page: Page, title = "Rita claim") => page.getByRole("listitem").filter({ hasText: title });
const menu = (page: Page, title?: string) => item(page, title).getByRole("button", { name: "Review actions" });
const claimRow = (id: string) => db.reimbursement.findUniqueOrThrow({ where: { id }, include: { history: { orderBy: { updatedAt: "asc" } } } });

async function openAll(page: Page) {
  await page.goto("/admin/reimbursements?tab=all");
  await expect(item(page)).toHaveCount(1);
}
async function choose(page: Page, name: string | RegExp, title?: string) {
  await menu(page, title).click();
  await page.getByRole("menuitem", { name }).click();
}
const notice = (title: string) =>
  db.notification.findFirstOrThrow({ where: { title, recipients: { some: { employeeId: ritaId } } } });

test.describe("admin reimbursements: review", () => {
  test("approves a pending claim; employee is notified and sees the status history", async ({ page, browser }) => {
    const c = await claim();
    await page.goto("/admin/reimbursements");
    await expect(item(page)).toHaveCount(1);
    await choose(page, "Approve");
    await expect(toast(page, "approved")).toBeVisible();
    const after = await claimRow(c.id);
    expect(after.status).toBe("APPROVED");
    expect(after.approvalDate).not.toBeNull();
    expect(after.history.map((h) => h.status)).toEqual(["PENDING", "APPROVED"]);
    expect(await db.auditLog.count({ where: { action: "reimbursement.approved", resource: `Reimbursement:${c.id}` } })).toBe(1);
    expect((await notice("Reimbursement approved")).message).toContain('Your claim "Rita claim" was approved.');
    await expect(item(page)).toHaveCount(0); // gone from the pending tab

    // What Rita sees.
    const ctx = await browser.newContext({ storageState: "e2e/.auth/rita.json" });
    const rp = await ctx.newPage();
    await rp.goto("/dashboard/reimbursements");
    const mine = rp.getByRole("listitem").filter({ hasText: "Rita claim" });
    await expect(mine).toContainText("APPROVED");
    await expect(mine.getByText("History (2)")).toBeVisible();
    await expect(statValue(rp, "Approved, unpaid")).toHaveText("$100.00");
    await ctx.close();
  });

  test("full path: under review, approved, then paid in full", async ({ page }) => {
    const c = await claim({ amount: 80 });
    await openAll(page);
    await choose(page, "Under review");
    await expect(toast(page, "under review")).toBeVisible();
    await expect(item(page)).toContainText("UNDER REVIEW");
    await choose(page, "Approve");
    await expect(item(page)).toContainText("APPROVED");
    await choose(page, "Mark paid");
    const dlg = page.getByRole("dialog", { name: "Mark paid" });
    await expect(labelled(dlg, "Amount paid")).toHaveValue("80.00");
    await dlg.getByRole("button", { name: "Mark paid" }).click();
    await expect(toast(page, "paid")).toBeVisible();
    const after = await claimRow(c.id);
    expect(after.status).toBe("PAID");
    expect(Number(after.paidAmount)).toBe(80);
    expect(after.paidDate).not.toBeNull();
    expect(after.history.map((h) => h.status)).toEqual(["PENDING", "UNDER_REVIEW", "APPROVED", "PAID"]);
    expect((await notice("Reimbursement paid")).message).toContain("was paid ($80.00)");
    await expect(item(page)).toContainText("PAID");
    // Paid is final: no more actions.
    await expect(menu(page)).toHaveCount(0);
  });

  test("a partial payment needs a note, and the paid amount is what is stored", async ({ page }) => {
    const c = await claim({ amount: 100, status: "APPROVED" });
    await openAll(page);
    await choose(page, "Mark paid");
    const dlg = page.getByRole("dialog", { name: "Mark paid" });
    const confirm = dlg.getByRole("button", { name: "Mark paid" });
    await labelled(dlg, "Amount paid").fill("40");
    await expect(confirm).toBeDisabled(); // partial, no note yet
    await dlg.locator("textarea").fill("Only meals are covered");
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(toast(page, "paid")).toBeVisible();
    const after = await claimRow(c.id);
    expect(Number(after.paidAmount)).toBe(40);
    expect(after.reviewNotes).toBe("Only meals are covered");
    expect((await notice("Reimbursement paid")).message).toContain("was paid ($40.00)");
    expect((await notice("Reimbursement paid")).message).toContain("Note: Only meals are covered");
    await expect(item(page)).toContainText("paid $40.00");
  });

  test("the paid amount cannot be zero or more than the claim", async ({ page }) => {
    await claim({ amount: 100, status: "APPROVED" });
    await openAll(page);
    await choose(page, "Mark paid");
    const dlg = page.getByRole("dialog", { name: "Mark paid" });
    const confirm = dlg.getByRole("button", { name: "Mark paid" });
    await labelled(dlg, "Amount paid").fill("0");
    await expect(confirm).toBeDisabled();
    await labelled(dlg, "Amount paid").fill("100.01");
    await expect(confirm).toBeDisabled();
    await labelled(dlg, "Amount paid").fill("100");
    await expect(confirm).toBeEnabled();
  });

  test("rejecting needs a reason, which the employee sees; the claim can then be reopened", async ({ page, browser }) => {
    const c = await claim();
    await openAll(page);
    await choose(page, "Reject");
    const dlg = page.getByRole("dialog", { name: "Reject claim" });
    const confirm = dlg.getByRole("button", { name: "Reject claim" });
    await expect(confirm).toBeDisabled();
    await dlg.locator("textarea").fill("Not a business expense");
    await confirm.click();
    await expect(toast(page, "rejected")).toBeVisible();
    let after = await claimRow(c.id);
    expect(after.status).toBe("REJECTED");
    expect(after.reviewNotes).toBe("Not a business expense");
    const n = await notice("Reimbursement rejected");
    expect(n.message).toContain("Reason: Not a business expense");
    expect(n.priority).toBe("HIGH");

    const ctx = await browser.newContext({ storageState: "e2e/.auth/rita.json" });
    const rp = await ctx.newPage();
    await rp.goto("/dashboard/reimbursements");
    await expect(rp.getByText("Rejection reason: Not a business expense")).toBeVisible();
    await ctx.close();

    // Reopen: back to pending with the old decision cleared and a history entry.
    await choose(page, "Reopen");
    const reopen = page.getByRole("dialog", { name: "Reopen claim" });
    await reopen.locator("textarea").fill("Employee sent the missing proof");
    await reopen.getByRole("button", { name: "Reopen" }).click();
    await expect(toast(page, "Claim reopened")).toBeVisible();
    after = await claimRow(c.id);
    expect(after.status).toBe("PENDING");
    expect(after.reviewNotes).toBeNull();
    expect(after.reviewedAt).toBeNull();
    expect(after.history.map((h) => [h.status, h.note])).toEqual([
      ["PENDING", "Submitted"],
      ["REJECTED", "Not a business expense"],
      ["PENDING", "Reopened: Employee sent the missing proof"],
    ]);
    expect(await db.auditLog.count({ where: { action: "reimbursement.reopen", resource: `Reimbursement:${c.id}` } })).toBe(1);
    await notice("Reimbursement reopened");
  });

  test("an approved claim can still be rejected, but a paid or rejected one has no review actions", async ({ page }) => {
    await claim({ title: "Approved one", status: "APPROVED" });
    await claim({ title: "Paid one", status: "PAID" });
    await claim({ title: "Rejected one", status: "REJECTED" });
    await page.goto("/admin/reimbursements?tab=all");
    await menu(page, "Approved one").click();
    await expect(page.getByRole("menuitem", { name: "Reject" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Mark paid" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Under review" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(menu(page, "Paid one")).toHaveCount(0);
    await menu(page, "Rejected one").click();
    await expect(page.getByRole("menuitem", { name: "Reopen" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Approve" })).toHaveCount(0);
  });

  test("a claim decided meanwhile is reported instead of being changed again", async ({ page }) => {
    const c = await claim();
    await openAll(page);
    await db.reimbursement.update({ where: { id: c.id }, data: { status: "REJECTED", reviewNotes: "Other admin said no" } });
    await choose(page, "Approve");
    await expect(toast(page, "This claim is already rejected and can't be changed.")).toBeVisible();
    expect((await claimRow(c.id)).status).toBe("REJECTED");
  });

  test("moving a claim to a status it cannot reach says which move is not allowed", async ({ page }) => {
    const c = await claim();
    await openAll(page);
    await db.reimbursement.update({ where: { id: c.id }, data: { status: "APPROVED" } }); // approved elsewhere
    await choose(page, "Under review");
    await expect(toast(page, "A approved claim can't be moved to under review. Refresh the page.")).toBeVisible();
    expect((await claimRow(c.id)).status).toBe("APPROVED");
  });

  test("a claim deleted meanwhile says it no longer exists", async ({ page }) => {
    const c = await claim();
    await openAll(page);
    await db.reimbursement.delete({ where: { id: c.id } });
    await choose(page, "Approve");
    await expect(toast(page, "That claim no longer exists. Refresh the page and try again.")).toBeVisible();
  });

  test("reopening a claim that is no longer rejected is refused", async ({ page }) => {
    const c = await claim({ status: "REJECTED" });
    await openAll(page);
    await db.reimbursement.update({ where: { id: c.id }, data: { status: "PENDING" } });
    await choose(page, "Reopen");
    await page.getByRole("dialog", { name: "Reopen claim" }).getByRole("button", { name: "Reopen" }).click();
    await expect(toast(page, "Only a rejected claim can be reopened.")).toBeVisible();
    expect((await claimRow(c.id)).history).toHaveLength(1);
  });

  test("the admin can open and download an employee's receipt", async ({ page }) => {
    const c = await claim();
    const f = pdfFile("rita-receipt.pdf");
    const stored = `${ritaId}/seed-rita-receipt.pdf`;
    await putFakeS3(`reimbursement-receipts/${stored}`, f.buffer, "application/pdf");
    const r = await db.reimbursementReceipt.create({
      data: { reimbursementId: c.id, fileName: stored, originalName: "rita-receipt.pdf", fileUrl: stored, fileSize: f.buffer.length, mimeType: "application/pdf" },
    });
    await openAll(page);
    await expect(item(page).getByRole("link", { name: "View rita-receipt.pdf" })).toBeVisible();
    const res = await page.request.get(`/api/reimbursements/receipts/${r.id}/file?download=1`);
    expect(res.status()).toBe(200);
    expect(Buffer.compare(await res.body(), f.buffer)).toBe(0);
  });

  test("an employee cannot open the admin reimbursements page", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: "e2e/.auth/rita.json" });
    const rp = await ctx.newPage();
    await rp.goto("/admin/reimbursements");
    await expect(rp).not.toHaveURL(/\/admin\/reimbursements/);
    await ctx.close();
  });

  test("the All tab pages through claims 50 at a time", async ({ page }) => {
    const old = new Date(Date.now() - 400 * 86_400_000);
    await db.reimbursement.createMany({
      data: Array.from({ length: 52 }, (_, i) => ({
        employeeId: ritaId,
        title: `Rita bulk ${i}`,
        category: "OTHER" as const,
        amount: 1,
        description: "bulk",
        expenseDate: old,
        createdAt: new Date(old.getTime() + i * 1000),
      })),
    });
    await page.goto("/admin/reimbursements?tab=all");
    await expect(page.getByText(/Page 1 of \d+/)).toBeVisible();
    await page.getByRole("link", { name: "Next" }).click();
    await expect(page.getByText(/Page 2 of \d+/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Previous" })).toBeVisible();
  });
});

test.describe("admin reimbursements: failures and double submits", () => {
  test("connection dropped while approving: error shown, claim stays pending", async ({ page }) => {
    const c = await claim();
    await openAll(page);
    await failServerActions(page, "abort");
    await choose(page, "Approve");
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect((await claimRow(c.id)).status).toBe("PENDING");
  });

  test("server error (500) while rejecting: error shown, claim unchanged", async ({ page }) => {
    const c = await claim();
    await openAll(page);
    await choose(page, "Reject");
    const dlg = page.getByRole("dialog", { name: "Reject claim" });
    await dlg.locator("textarea").fill("Policy violation");
    await failServerActions(page, "500");
    await dlg.getByRole("button", { name: "Reject claim" }).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    await expectNoCrash(page);
    const after = await claimRow(c.id);
    expect(after.status).toBe("PENDING");
    expect(after.history).toHaveLength(1);
  });

  test("stale deployment while marking paid: error shown, claim unchanged", async ({ page }) => {
    const c = await claim({ status: "APPROVED" });
    await openAll(page);
    await choose(page, "Mark paid");
    await failServerActions(page, "stale");
    await page.getByRole("dialog", { name: "Mark paid" }).getByRole("button", { name: "Mark paid" }).click();
    await expect(page.getByText(/something went wrong|refresh|newer version/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect((await claimRow(c.id)).status).toBe("APPROVED");
  });

  test("double click on Reject claim rejects once (one history entry, one notification)", async ({ page }) => {
    const c = await claim();
    await openAll(page);
    await choose(page, "Reject");
    const dlg = page.getByRole("dialog", { name: "Reject claim" });
    await dlg.locator("textarea").fill("Duplicate claim");
    const slow = await delayServerActions(page, 1500);
    await dlg.getByRole("button", { name: "Reject claim" }).dblclick();
    await expect(toast(page, "rejected")).toBeVisible();
    expect(slow.count()).toBe(1);
    expect((await claimRow(c.id)).history.filter((h) => h.status === "REJECTED")).toHaveLength(1);
    expect(
      await db.notificationRecipient.count({ where: { employeeId: ritaId, notification: { title: "Reimbursement rejected" } } }),
    ).toBe(1);
  });

  test("double click on Mark paid pays once", async ({ page }) => {
    const c = await claim({ status: "APPROVED" });
    await openAll(page);
    await choose(page, "Mark paid");
    const slow = await delayServerActions(page, 1500);
    await page.getByRole("dialog", { name: "Mark paid" }).getByRole("button", { name: "Mark paid" }).dblclick();
    await expect(toast(page, "paid")).toBeVisible();
    expect(slow.count()).toBe(1);
    expect((await claimRow(c.id)).history.filter((h) => h.status === "PAID")).toHaveLength(1);
  });
});
