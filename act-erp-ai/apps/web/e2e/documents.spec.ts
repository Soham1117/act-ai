import { test, expect, type Locator, type Page } from "@playwright/test";
import { db } from "./support/db";
import { fakeS3Keys } from "./support/fake-s3";
import { delayServerActions, expectNoCrash, failServerActions, toast } from "./support/helpers";
import { ADMIN_STATE, BASE_URL } from "./support/test-data";
import {
  SS,
  SS_OLIVE_DOC_TITLE,
  answerNextDialog,
  empDbId,
  loginState,
  pdfFile,
  putFakeS3,
  textFile,
} from "./support/self-service";
import { NETWORK_ERROR, SERVER_ERROR, STALE_ERROR } from "./support/action-errors";

// Documents: employee (Dana) and admin sides.
test.use({ storageState: "e2e/.auth/dana.json" });

let danaId: string;
let ninaId: string;
let adminUserId: string;

test.beforeAll(async ({ browser }) => {
  await loginState(browser, SS.dana, "dana");
  danaId = await empDbId(SS.dana);
  ninaId = await empDbId(SS.nina);
  adminUserId = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
});

async function clean() {
  await db.document.deleteMany({ where: { employeeId: { in: [danaId, ninaId] } } });
  await db.employee.update({ where: { id: danaId }, data: { benefitsEConsentAt: null } });
  await db.notificationRecipient.deleteMany({ where: { employeeId: { in: [danaId, ninaId] } } });
}
test.beforeEach(clean);
test.afterAll(clean);

const submit = (d: Locator) => d.getByRole("button", { name: "Upload", exact: true });
const docs = (employeeId = danaId) => db.document.findMany({ where: { employeeId }, orderBy: { uploadedAt: "asc" } });

async function openUpload(page: Page) {
  await page.goto("/dashboard/documents");
  await page.getByRole("button", { name: "Upload" }).click();
  return page.getByRole("dialog", { name: "Upload document" });
}
async function fillUpload(d: Locator, file: { name: string; mimeType: string; buffer: Buffer }, title = "My passport copy") {
  await d.getByLabel("File", { exact: true }).setInputFiles(file);
  await d.getByLabel("Title").fill(title);
}

test.describe("documents: employee upload, download, delete", () => {
  test("uploads a PDF: stored, listed, audited, and downloads back byte for byte", async ({ page }) => {
    const d = await openUpload(page);
    const f = pdfFile("passport.pdf");
    await fillUpload(d, f);
    await d.getByLabel("Description (optional)").fill("Front page");
    await submit(d).click();
    await expect(toast(page, "Document uploaded")).toBeVisible();
    await expect(d).toBeHidden();

    const [doc] = await docs();
    expect(doc).toMatchObject({ title: "My passport copy", description: "Front page", documentType: "PERSONAL", fileType: "application/pdf", uploadedById: expect.any(String) });
    expect((await fakeS3Keys()).some((k) => k.endsWith(`documents/${doc!.fileName}`))).toBe(true);
    expect(await db.auditLog.count({ where: { action: "document.upload", resource: `Document:${doc!.id}` } })).toBe(1);
    await expect(page.getByText("1 document accessible to you.")).toBeVisible();
    await expect(page.getByText("My passport copy")).toBeVisible();

    const res = await page.request.get(`/api/documents/${doc!.id}/file?download=1`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toMatch(/^attachment/);
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.compare(await res.body(), f.buffer)).toBe(0);
    expect((await page.request.get(`/api/documents/${doc!.id}/file`)).headers()["content-disposition"]).toMatch(/^inline/);
  });

  test("an employee can only pick Personal, Onboarding or Training", async ({ page }) => {
    const d = await openUpload(page);
    await d.getByLabel("Category").click();
    await expect(page.getByRole("option")).toHaveText(["PERSONAL", "ONBOARDING", "TRAINING"]);
  });

  test("Upload stays disabled without a file; a missing or one-letter title is refused", async ({ page }) => {
    const d = await openUpload(page);
    await expect(submit(d)).toBeDisabled();
    await d.getByLabel("File", { exact: true }).setInputFiles(pdfFile());
    await submit(d).click();
    await expect(toast(page, "Title is required")).toBeVisible();
    await d.getByLabel("Title").fill("A");
    await submit(d).click();
    await expect(toast(page, "Title is required").last()).toBeVisible();
    expect(await docs()).toHaveLength(0);
  });

  test("a .exe file is refused with the list of allowed types", async ({ page }) => {
    const d = await openUpload(page);
    await fillUpload(d, { name: "virus.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
    await submit(d).click();
    await expect(toast(page, "Unsupported file type. Allowed: PDF, PNG, JPG, JPEG, DOCX, XLSX, TXT.")).toBeVisible();
    expect(await docs()).toHaveLength(0);
  });

  test("an empty file is refused", async ({ page }) => {
    const d = await openUpload(page);
    await fillUpload(d, { name: "empty.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(0) });
    await submit(d).click();
    await expect(toast(page, "The file is empty.")).toBeVisible();
    expect(await docs()).toHaveLength(0);
  });

  test("a PDF whose contents are really text is refused", async ({ page }) => {
    const d = await openUpload(page);
    const before = (await fakeS3Keys()).length;
    await fillUpload(d, textFile("fake.pdf", "plain text"));
    await submit(d).click();
    await expect(toast(page, "The file contents don't match its type. Re-export it and try again.")).toBeVisible();
    expect(await docs()).toHaveLength(0);
    expect((await fakeS3Keys()).length).toBe(before);
  });

  // BUG: files between ~10 MB and 15 MB (the documented limit) crash the page with "Unexpected end of form" instead of
  // uploading, and a file over 15 MB crashes instead of showing "File is too large". Likely Next's default 10 MB
  // request-body buffering limit in the proxy layer (next.config.ts only raises serverActions.bodySizeLimit).
  // Proposed fix: raise the proxy client body-size limit in next.config.ts to match (>= 60mb) and/or check size in the form.
  test("a file over 15 MB is refused; one at exactly 15 MB is accepted", async ({ page }) => {
    const limit = 15 * 1024 * 1024;
    const d = await openUpload(page);
    const make = (n: number) => ({ name: "big.pdf", mimeType: "application/pdf", buffer: Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(n - 9, 0x20)]) });
    await fillUpload(d, make(limit + 1), "Too big");
    await submit(d).click();
    await expect(toast(page, "File is too large (max 15 MB).")).toBeVisible({ timeout: 30_000 });
    expect(await docs()).toHaveLength(0);
    await fillUpload(d, make(limit), "Just right");
    await submit(d).click();
    await expect(toast(page, "Document uploaded")).toBeVisible({ timeout: 45_000 });
    expect(await docs()).toHaveLength(1);
  });

  test("a .txt with script-like content is refused", async ({ page }) => {
    const d = await openUpload(page);
    await fillUpload(d, textFile("note.txt", "<script>alert(1)</script>"));
    await submit(d).click();
    await expect(toast(page, "The file contents don't match its type. Re-export it and try again.")).toBeVisible();
  });

  test("deletes own upload (row and stored file go); documents added by an admin cannot be deleted by the employee", async ({ page }) => {
    const d = await openUpload(page);
    await fillUpload(d, pdfFile("mine.pdf"), "Delete me");
    await submit(d).click();
    await expect(toast(page, "Document uploaded")).toBeVisible();
    const [mine] = await docs();
    await db.document.create({
      data: { employeeId: danaId, title: "From HR", fileName: `${danaId}/hr.pdf`, fileType: "application/pdf", fileUrl: "x", documentType: "COMPANY", uploadedById: adminUserId },
    });
    await page.reload();
    await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(1); // only her own
    answerNextDialog(page);
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(toast(page, "Document deleted")).toBeVisible();
    expect((await docs()).map((x) => x.title)).toEqual(["From HR"]);
    expect((await fakeS3Keys()).some((k) => k.endsWith(`documents/${mine!.fileName}`))).toBe(false);
    expect(await db.auditLog.count({ where: { action: "document.delete", resource: `Document:${mine!.id}` } })).toBe(1);
  });

  test("answering No to the delete question keeps the document", async ({ page }) => {
    const d = await openUpload(page);
    await fillUpload(d, pdfFile());
    await submit(d).click();
    await expect(toast(page, "Document uploaded")).toBeVisible();
    answerNextDialog(page, false);
    await page.getByRole("button", { name: "Delete" }).click();
    expect(await docs()).toHaveLength(1);
  });

  test("deleting a document that is already gone says so", async ({ page }) => {
    const d = await openUpload(page);
    await fillUpload(d, pdfFile());
    await submit(d).click();
    await expect(toast(page, "Document uploaded")).toBeVisible();
    await db.document.deleteMany({ where: { employeeId: danaId } });
    answerNextDialog(page);
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(toast(page, "That document no longer exists. Refresh the page and try again.")).toBeVisible();
  });
});

test.describe("documents: visibility", () => {
  test("another employee's document is not listed and cannot be opened", async ({ page, browser }) => {
    await page.goto("/dashboard/documents");
    await expect(page.getByText(SS_OLIVE_DOC_TITLE)).toHaveCount(0);
    const olive = await db.document.findFirstOrThrow({ where: { title: SS_OLIVE_DOC_TITLE } });
    const url = `/api/documents/${olive.id}/file`;
    expect((await page.request.get(url)).status()).toBe(403);
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    expect([302, 303, 307, 308, 401]).toContain((await anon.request.get(`${BASE_URL}${url}`, { maxRedirects: 0 })).status());
    await anon.close();
    const admin = await browser.newContext({ storageState: ADMIN_STATE });
    expect((await admin.request.get(`${BASE_URL}${url}`)).status()).toBe(404); // allowed, but the object is not in the fake store
    await admin.close();
    expect((await page.request.get("/api/documents/nope/file")).status()).toBe(404);
  });

  test("documents are grouped by category tabs", async ({ page }) => {
    for (const [i, t] of (["PERSONAL", "TRAINING"] as const).entries()) {
      await db.document.create({
        data: { employeeId: danaId, title: `Doc ${t}`, fileName: `${danaId}/${i}.pdf`, fileType: "application/pdf", fileUrl: "x", documentType: t, uploadedById: adminUserId },
      });
    }
    await page.goto("/dashboard/documents");
    await page.getByRole("tab", { name: "TRAINING (1)" }).click();
    await expect(page.getByText("Doc TRAINING")).toBeVisible();
    await expect(page.getByText("Doc PERSONAL")).toHaveCount(0);
  });
});

test.describe("documents: failures and double submits", () => {
  test("connection dropped while uploading: error shown, nothing stored", async ({ page }) => {
    const d = await openUpload(page);
    await fillUpload(d, pdfFile());
    const before = (await fakeS3Keys()).length;
    await failServerActions(page, "abort");
    await submit(d).click();
    await expect(toast(page, NETWORK_ERROR)).toBeVisible();
    await expectNoCrash(page);
    expect(await docs()).toHaveLength(0);
    expect((await fakeS3Keys()).length).toBe(before);
  });

  test("server error (500) while uploading: nothing saved", async ({ page }) => {
    const d = await openUpload(page);
    await fillUpload(d, pdfFile());
    await failServerActions(page, "500");
    await submit(d).click();
    await expect(toast(page, SERVER_ERROR)).toBeVisible();
    expect(await docs()).toHaveLength(0);
  });

  test("stale deployment while uploading: no crash", async ({ page }) => {
    const d = await openUpload(page);
    await fillUpload(d, pdfFile());
    await failServerActions(page, "stale");
    await submit(d).click();
    await expect(toast(page, STALE_ERROR)).toBeVisible();
    await expectNoCrash(page);
    expect(await docs()).toHaveLength(0);
  });

  test("double click on Upload stores one document", async ({ page }) => {
    const d = await openUpload(page);
    await fillUpload(d, pdfFile());
    const slow = await delayServerActions(page, 1500);
    await submit(d).dblclick();
    await expect(toast(page, "Document uploaded")).toBeVisible();
    expect(slow.count()).toBe(1);
    expect(await docs()).toHaveLength(1);
  });

  test("server failure while deleting: error shown, document stays", async ({ page }) => {
    const d = await openUpload(page);
    await fillUpload(d, pdfFile());
    await submit(d).click();
    await expect(toast(page, "Document uploaded")).toBeVisible();
    await failServerActions(page, "abort");
    answerNextDialog(page);
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(toast(page, NETWORK_ERROR)).toBeVisible();
    expect(await docs()).toHaveLength(1);
  });
});

test.describe("documents: admin", () => {
  test.use({ storageState: ADMIN_STATE });

  async function openBulk(page: Page) {
    await page.goto("/admin/documents");
    await page.getByRole("button", { name: "Upload to employees" }).click();
    return page.getByRole("dialog", { name: "Upload to employees" });
  }
  const bulkSubmit = (d: Locator) => d.getByRole("button", { name: /^Upload to/ }).last();
  async function pickRecipients(page: Page, d: Locator, ...users: { name: string }[]) {
    for (const u of users) {
      await d.getByPlaceholder("Search employees…").fill(u.name);
      await d.getByRole("checkbox", { name: new RegExp(u.name) }).click();
    }
  }

  test("uploads one file to two employees: one row each sharing one stored file; deleting keeps the file until the last row goes", async ({ page }) => {
    const d = await openBulk(page);
    const f = pdfFile("handbook.pdf");
    await d.locator("#bulk-file").setInputFiles(f);
    await d.locator("#bulk-title").fill("Employee Handbook");
    await pickRecipients(page, d, SS.dana, SS.nina);
    await bulkSubmit(d).click();
    await expect(toast(page, "Uploaded to 2 employees")).toBeVisible();
    const rows = await db.document.findMany({ where: { title: "Employee Handbook" } });
    expect(rows.map((r) => r.employeeId).sort()).toEqual([danaId, ninaId].sort());
    expect(new Set(rows.map((r) => r.fileName)).size).toBe(1);
    expect(rows[0]!.documentType).toBe("COMPANY");
    const key = `documents/${rows[0]!.fileName}`;
    for (const id of [danaId, ninaId]) {
      expect(await db.notificationRecipient.count({ where: { employeeId: id, notification: { title: "New document available" } } })).toBe(1);
    }

    // Admin list: delete Dana's copy first.
    await page.goto("/admin/documents");
    answerNextDialog(page);
    await page.getByRole("listitem").filter({ hasText: "Employee Handbook" }).filter({ hasText: SS.dana.name }).getByRole("button", { name: "Delete" }).click();
    await expect(toast(page, "Document deleted")).toBeVisible();
    // Wait for the list to refresh, so only Nina's row is left before the next delete (no strict-mode race).
    await expect(page.getByRole("listitem").filter({ hasText: "Employee Handbook" }).filter({ hasText: SS.dana.name })).toHaveCount(0);
    await expect(page.getByRole("listitem").filter({ hasText: "Employee Handbook" })).toHaveCount(1);
    expect((await fakeS3Keys()).some((k) => k.endsWith(key))).toBe(true); // Nina's copy still needs it
    answerNextDialog(page);
    await page.getByRole("listitem").filter({ hasText: "Employee Handbook" }).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "Employee Handbook" })).toHaveCount(0);
    await expect.poll(async () => (await fakeS3Keys()).some((k) => k.endsWith(key))).toBe(false);
  });

  test("bulk upload needs a file and recipients, and validates the file", async ({ page }) => {
    const d = await openBulk(page);
    await expect(bulkSubmit(d)).toBeDisabled();
    await d.locator("#bulk-file").setInputFiles({ name: "x.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
    await d.locator("#bulk-title").fill("Bad file");
    await pickRecipients(page, d, SS.dana);
    await bulkSubmit(d).click();
    await expect(toast(page, "Unsupported file type. Allowed: PDF, PNG, JPG, JPEG, DOCX, XLSX, TXT.")).toBeVisible();
    await d.locator("#bulk-title").fill("A");
    await bulkSubmit(d).click();
    await expect(toast(page, "Title is required")).toBeVisible();
    expect(await db.document.count({ where: { title: { in: ["Bad file", "A"] } } })).toBe(0);
  });

  test("benefits plan documents under ERISA only go to employees who consented; the rest are listed", async ({ page }) => {
    await db.employee.update({ where: { id: danaId }, data: { benefitsEConsentAt: new Date() } });
    const d = await openBulk(page);
    await d.locator("#bulk-file").setInputFiles(pdfFile("spd.pdf"));
    await d.locator("#bulk-title").fill("Summary Plan Description");
    await d.locator("#bulk-type").click();
    await page.getByRole("option", { name: "BENEFITS" }).click();
    await d.getByRole("checkbox", { name: /ERISA/ }).click();
    await pickRecipients(page, d, SS.dana, SS.nina);
    await bulkSubmit(d).click();
    await expect(toast(page, "Uploaded to 1 employee")).toBeVisible();
    await expect(toast(page, new RegExp(`Not delivered electronically to 1 employee.*${SS.nina.name}`))).toBeVisible();
    expect((await db.document.findMany({ where: { title: "Summary Plan Description" } })).map((r) => r.employeeId)).toEqual([danaId]);
  });

  test("ERISA upload to nobody who consented is refused with paper-copy advice", async ({ page }) => {
    const d = await openBulk(page);
    await d.locator("#bulk-file").setInputFiles(pdfFile("spd.pdf"));
    await d.locator("#bulk-title").fill("No consent doc");
    await d.locator("#bulk-type").click();
    await page.getByRole("option", { name: "BENEFITS" }).click();
    await d.getByRole("checkbox", { name: /ERISA/ }).click();
    await pickRecipients(page, d, SS.nina);
    await bulkSubmit(d).click();
    await expect(toast(page, /None of the selected employees have consented to electronic benefits document delivery/)).toBeVisible();
    expect(await db.document.count({ where: { title: "No consent doc" } })).toBe(0);
  });

  test("admin uploads a document for an employee from the employee page; she is notified and cannot delete it", async ({ page, browser }) => {
    await page.goto(`/admin/employees/${danaId}`);
    await page.getByRole("tab", { name: "Documents" }).click();
    await page.getByRole("button", { name: "Upload" }).click();
    const d = page.getByRole("dialog", { name: "Upload document" });
    await d.getByLabel("File", { exact: true }).setInputFiles(pdfFile("contract.pdf"));
    await d.getByLabel("Title").fill("Signed contract");
    await submit(d).click();
    await expect(toast(page, "Document uploaded")).toBeVisible();
    const [doc] = await docs();
    expect(doc).toMatchObject({ title: "Signed contract", uploadedById: adminUserId });
    expect(await db.notificationRecipient.count({ where: { employeeId: danaId, notification: { title: "New document available" } } })).toBe(1);

    const ctx = await browser.newContext({ storageState: "e2e/.auth/dana.json" });
    const dp = await ctx.newPage();
    await dp.goto("/dashboard/documents");
    await expect(dp.getByText("Signed contract")).toBeVisible();
    await expect(dp.getByRole("button", { name: "Delete" })).toHaveCount(0);
    await ctx.close();
  });

  test("admin can open any employee's document (stored object present)", async ({ page }) => {
    const f = pdfFile("seen.pdf");
    const doc = await db.document.create({
      data: { employeeId: danaId, title: "Seen by admin", fileName: `${danaId}/seen.pdf`, fileType: "application/pdf", fileUrl: "x", documentType: "PERSONAL", uploadedById: adminUserId },
    });
    await putFakeS3(`documents/${doc.fileName}`, f.buffer, "application/pdf");
    const res = await page.request.get(`/api/documents/${doc.id}/file`);
    expect(res.status()).toBe(200);
    expect(Buffer.compare(await res.body(), f.buffer)).toBe(0);
  });

  test("double click on bulk upload delivers once", async ({ page }) => {
    const d = await openBulk(page);
    await d.locator("#bulk-file").setInputFiles(pdfFile());
    await d.locator("#bulk-title").fill("Flaky bulk");
    await pickRecipients(page, d, SS.dana);
    const slow = await delayServerActions(page, 1500);
    await bulkSubmit(d).dblclick();
    await expect(toast(page, "Uploaded to 1 employee")).toBeVisible();
    expect(slow.count()).toBe(1);
    expect(await db.document.count({ where: { title: "Flaky bulk" } })).toBe(1);
  });
});

test.describe("documents: admin failure", () => {
  test.use({ storageState: ADMIN_STATE });
  test("server error while bulk uploading: error shown, nothing delivered", async ({ page }) => {
    await page.goto("/admin/documents");
    await page.getByRole("button", { name: "Upload to employees" }).click();
    const d = page.getByRole("dialog", { name: "Upload to employees" });
    await d.locator("#bulk-file").setInputFiles(pdfFile());
    await d.locator("#bulk-title").fill("Failing bulk");
    await d.getByPlaceholder("Search employees…").fill(SS.dana.name);
    await d.getByRole("checkbox", { name: new RegExp(SS.dana.name) }).click();
    await failServerActions(page, "500");
    await d.getByRole("button", { name: /^Upload to/ }).last().click();
    await expect(toast(page, SERVER_ERROR)).toBeVisible();
    // The dialog stays open (nothing was lost).
    await expect(d).toBeVisible();
    await expectNoCrash(page);
    expect(await db.document.count({ where: { title: "Failing bulk" } })).toBe(0);
  });
});
