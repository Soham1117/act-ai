import { test, expect, type Page } from "@playwright/test";
import { db } from "./support/db";
import { toast } from "./support/helpers";
import { ADMIN_STATE } from "./support/test-data";
import {
  SS,
  SS_PLAN_MEDICAL,
  answerNextDialog,
  empDbId,
  labelled,
  loginState,
  mondayWindow,
  pdfFile,
  pngFile,
  dateOnly,
  pick,
} from "./support/self-service";

// A read-only account (terminated 5 days ago, inside the 60-day grace): can look, cannot change.
test.use({ storageState: "e2e/.auth/rory.json" });

let roryId: string;
const READ_ONLY = "Your account is read-only. You can view your records but can't make changes.";

test.beforeAll(async ({ browser }) => {
  await loginState(browser, SS.rory, "rory");
  roryId = await empDbId(SS.rory);
});
test.beforeEach(async () => {
  await db.leaveRequest.deleteMany({ where: { employeeId: roryId } });
});
test.afterAll(async () => {
  await db.leaveRequest.deleteMany({ where: { employeeId: roryId } });
  await db.benefitEnrollment.deleteMany({ where: { employeeId: roryId } });
});

test.describe("read-only account", () => {
  test("leave: the request is refused with the read-only message", async ({ page }) => {
    await page.goto("/dashboard/leave");
    await page.getByRole("button", { name: "Request leave" }).click();
    const d = page.getByRole("dialog", { name: "Request leave" });
    const start = mondayWindow(14);
    await pick(page, d, "Type", /^SICK/);
    await labelled(d, "Start date").fill(start);
    await labelled(d, "End date").fill(start);
    await d.getByRole("button", { name: /^submit$/i }).click();
    await expect(toast(page, READ_ONLY)).toBeVisible();
    expect(await db.leaveRequest.count({ where: { employeeId: roryId } })).toBe(0);
  });

  test("leave: cancelling an existing request is refused", async ({ page }) => {
    const start = mondayWindow(14);
    const lr = await db.leaveRequest.create({
      data: { employeeId: roryId, leaveType: "SICK", startDate: dateOnly(start), endDate: dateOnly(start), totalDays: 1 },
    });
    await page.goto("/dashboard/leave");
    answerNextDialog(page);
    await page.getByRole("button", { name: /cancel leave request/i }).click();
    await expect(toast(page, READ_ONLY)).toBeVisible();
    expect((await db.leaveRequest.findUniqueOrThrow({ where: { id: lr.id } })).status).toBe("PENDING");
  });

  test("reimbursements: no New claim button", async ({ page }) => {
    await page.goto("/dashboard/reimbursements");
    await expect(page.getByRole("heading", { name: "Reimbursements" })).toBeVisible();
    await expect(page.getByRole("button", { name: "New claim" })).toHaveCount(0);
  });

  test("requests: submitting is refused with the read-only message", async ({ page }) => {
    await page.goto("/dashboard/requests");
    await page.getByRole("button", { name: "New request" }).click();
    const d = page.getByRole("dialog", { name: "New request" });
    await labelled(d, "Subject").fill("Please help");
    await labelled(d, "Details").fill("Something");
    await d.getByRole("button", { name: /^submit$/i }).click();
    await expect(toast(page, READ_ONLY)).toBeVisible();
    expect(await db.request.count({ where: { employeeId: roryId } })).toBe(0);
  });

  test("documents: uploading is refused with the read-only message", async ({ page }) => {
    await page.goto("/dashboard/documents");
    await page.getByRole("button", { name: "Upload" }).click();
    const d = page.getByRole("dialog", { name: "Upload document" });
    await d.getByLabel("File", { exact: true }).setInputFiles(pdfFile());
    await d.getByLabel("Title").fill("Should not save");
    await d.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(toast(page, READ_ONLY)).toBeVisible();
    expect(await db.document.count({ where: { employeeId: roryId } })).toBe(0);
  });

  test("settings: PIN, email and consent are replaced by a read-only note; password stays available", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await expect(page.getByText("Your account is read-only, so this can't be changed right now.")).toHaveCount(4);
    await expect(page.getByRole("button", { name: "Set PIN" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Update password" })).toBeVisible();
  });

  test("notifications can still be read and marked read", async ({ page }) => {
    await db.notification.create({
      data: { type: "COMPANY", title: "Rory notice", message: "hello", recipients: { create: [{ employeeId: roryId }] } },
    });
    await page.goto("/dashboard/notifications");
    await page.getByRole("listitem").filter({ hasText: "Rory notice" }).getByRole("button", { name: "Mark as read" }).click();
    await expect.poll(() => db.notificationRecipient.count({ where: { employeeId: roryId, read: false } })).toBe(0);
  });

  test("benefits page says coverage ended for a terminated employee", async ({ page }) => {
    const plan = await db.benefitPlan.findFirstOrThrow({ where: { name: SS_PLAN_MEDICAL } });
    await db.benefitEnrollment.create({
      data: { employeeId: roryId, planId: plan.id, tier: "EMPLOYEE_ONLY", status: "ENROLLED", effectiveDate: dateOnly("2024-01-01"), endDate: dateOnly("2024-06-30"), confirmedAsOf: dateOnly("2024-06-30") },
    });
    await page.goto("/dashboard/benefits");
    await expect(page.getByText(/Your coverage ended/)).toBeVisible();
  });
});

test.describe("profile picture (admin)", () => {
  test.use({ storageState: ADMIN_STATE });

  async function open(page: Page) {
    const id = await empDbId(SS.nina);
    await page.goto(`/admin/employees/${id}`);
    return { id, input: page.locator('input[type="file"]').first() };
  }

  test("uploads a PNG: stored, served back, audited", async ({ page }) => {
    const { id, input } = await open(page);
    const png = pngFile("me.png");
    await input.setInputFiles(png);
    await expect(toast(page, "Profile picture updated")).toBeVisible();
    expect((await db.employee.findUniqueOrThrow({ where: { id } })).profilePic).toBe(`/api/employees/${id}/profile-pic`);
    const res = await page.request.get(`/api/employees/${id}/profile-pic`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
    expect(Buffer.compare(await res.body(), png.buffer)).toBe(0);
    expect(await db.auditLog.count({ where: { action: "employee.profile_pic_update", resource: `Employee:${id}` } })).toBeGreaterThan(0);
  });

  test("a PDF, a mislabelled image, an empty file and a 5 MB+ image are refused", async ({ page }) => {
    const { input } = await open(page);
    await input.setInputFiles(pdfFile("doc.pdf"));
    await expect(toast(page, "Unsupported file type. Allowed: PNG, JPG, JPEG, WEBP.")).toBeVisible();
    await input.setInputFiles({ name: "fake.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
    await expect(toast(page, "The file contents don't match its type. Re-export it and try again.")).toBeVisible();
    await input.setInputFiles({ name: "empty.png", mimeType: "image/png", buffer: Buffer.alloc(0) });
    await expect(toast(page, "The file is empty.")).toBeVisible();
    const big = Buffer.concat([pngFile().buffer, Buffer.alloc(5 * 1024 * 1024)]);
    await input.setInputFiles({ name: "big.png", mimeType: "image/png", buffer: big });
    await expect(toast(page, "File is too large (max 5 MB).")).toBeVisible({ timeout: 30_000 });
  });

  test("the picture route needs a session", async ({ browser }) => {
    const id = await empDbId(SS.nina);
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const res = await anon.request.get(`http://localhost:${process.env.E2E_PORT}/api/employees/${id}/profile-pic`, { maxRedirects: 0 });
    expect([302, 303, 307, 308, 401]).toContain(res.status());
    await anon.close();
  });
});
