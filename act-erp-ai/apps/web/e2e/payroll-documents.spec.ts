import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { db } from "./support/db";
import { fakeS3Keys } from "./support/fake-s3";
import { delayServerActions, expectNoCrash, failServerActions, toast } from "./support/helpers";
import { PT, dateOnly, fakePdf, paystubPdf, putFakeS3, sessionFor } from "./support/payroll-time";
import { ADMIN_STATE, BASE_URL, PIN_EMPLOYEE } from "./support/test-data";

const USED = [PT.rex, PT.tina, PT.penny].map((e) => e.employeeId);
const S3 = () => `${process.env.S3_BUCKET}/payroll/`;

test.afterEach(async () => {
  await db.payroll.deleteMany({ where: { employee: { employeeId: { in: USED } } } });
  await db.employee.updateMany({ where: { employeeId: { in: USED } }, data: { w2ConsentAt: null, ssnLast4: null } });
});

const docs = (employeeId: string) => db.payroll.findMany({ where: { employee: { employeeId } }, orderBy: { uploadedAt: "asc" } });
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

// ──────────────────────────────────────────────────────────────────────
// Admin: upload dialog
// ──────────────────────────────────────────────────────────────────────
test.describe("admin payroll documents: upload", () => {
  test.use({ storageState: ADMIN_STATE });

  async function openUpload(page: Page) {
    await page.goto("/admin/payroll");
    await page.getByRole("button", { name: /upload pay stubs/i }).click();
    const dialog = page.getByRole("dialog", { name: /upload pay stubs/i });
    await expect(dialog).toBeVisible();
    return dialog;
  }
  type Dialog = Awaited<ReturnType<typeof openUpload>>;

  const rowOf = (dialog: Dialog, n = 0) => dialog.locator("tbody tr").nth(n);

  /** Drop one file and wait until its row has finished reading. */
  async function drop(dialog: Dialog, file: { name: string; mimeType?: string; buffer: Buffer }, n = 0) {
    await dialog.locator('input[type="file"]').setInputFiles({
      name: file.name,
      mimeType: file.mimeType ?? "application/pdf",
      buffer: file.buffer,
    });
    await expect(rowOf(dialog, n).getByRole("combobox")).toBeVisible();
  }

  async function fill(
    page: Page,
    dialog: Dialog,
    v: { employee?: string; start?: string; end?: string },
    n = 0,
  ) {
    const row = rowOf(dialog, n);
    if (v.employee) {
      await row.getByRole("combobox").click();
      await page.getByRole("option", { name: v.employee }).click();
    }
    if (v.start) await row.locator('input[type="date"]').nth(0).fill(v.start);
    if (v.end) await row.locator('input[type="date"]').nth(1).fill(v.end);
  }

  const confirm = (dialog: Dialog) => dialog.getByRole("button", { name: /confirm & upload/i });

  test("uploads a pay stub: row, stored file, audit record and notification", async ({ page }) => {
    const bytes = fakePdf("happy");
    const dialog = await openUpload(page);
    await drop(dialog, { name: "stub june.pdf", buffer: bytes });
    await expect(confirm(dialog)).toBeDisabled(); // no employee / dates yet
    await fill(page, dialog, { employee: PT.rex.name, start: "2025-06-01", end: "2025-06-14" });
    await confirm(dialog).click();
    await expect(toast(page, /1 pay stub uploaded/i)).toBeVisible();

    const [doc] = await docs(PT.rex.employeeId);
    expect(doc).toBeTruthy();
    expect(doc!.title).toBe("Pay Stub — 2025-06-14");
    expect(doc!.category).toBe("Pay Stub");
    expect(doc!.fileSha256).toBe(sha(bytes));
    expect(doc!.payPeriodStart.toISOString().slice(0, 10)).toBe("2025-06-01");
    expect(doc!.payPeriodEnd.toISOString().slice(0, 10)).toBe("2025-06-14");
    expect(doc!.fileType).toBe("application/pdf");
    expect(await fakeS3Keys()).toContain(`${S3()}${doc!.fileName}`);
    expect(await db.auditLog.count({ where: { action: "payroll.document.upload", resource: `Payroll:${doc!.id}` } })).toBe(1);
    const notified = await db.notificationRecipient.count({
      where: { employee: { employeeId: PT.rex.employeeId }, notification: { title: "New pay document available" } },
    });
    expect(notified).toBeGreaterThanOrEqual(1);

    await page.getByRole("tab", { name: /documents/i }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "Pay Stub — 2025-06-14" })).toContainText(PT.rex.name);
  });

  // BUG: previewPaystub/parsePaystub (src/lib/paystub-parser.ts) cannot read any PDF under the Turbopack dev server: pdfjs fake worker cannot find pdf.worker.mjs, so auto-match never works. Proposed fix: add "pdfjs-dist" to serverExternalPackages in next.config.ts (verified locally, reverted per coordinator).
  test.fixme("a stub laid out like the payroll provider's is matched to the employee and dated automatically", async ({ page }) => {
    await db.employee.update({ where: { employeeId: PT.rex.employeeId }, data: { ssnLast4: "4417" } });
    const bytes = paystubPdf({ name: PT.rex.name, last4: "4417", start: "06/01/2025", end: "06/14/2025", payDate: "06/20/2025", tag: "auto1" });
    const dialog = await openUpload(page);
    await drop(dialog, { name: "auto.pdf", buffer: bytes });
    const row = rowOf(dialog);
    await expect(row).toContainText("Matched");
    await expect(row.getByRole("combobox")).toContainText(PT.rex.name);
    await expect(row.locator('input[type="date"]').nth(0)).toHaveValue("2025-06-01");
    await expect(row.locator('input[type="date"]').nth(1)).toHaveValue("2025-06-14");
    await confirm(dialog).click();
    await expect(toast(page, /1 pay stub uploaded/i)).toBeVisible();
    expect(await docs(PT.rex.employeeId)).toHaveLength(1);
  });

  // BUG: same pdfjs worker problem, so the pre-upload duplicate flag (needs a parsed employee) never shows. Same fix as above.
  test.fixme("dropping a file that is already on file flags it before upload; Replace swaps the old one", async ({ page }) => {
    await db.employee.update({ where: { employeeId: PT.rex.employeeId }, data: { ssnLast4: "4417" } });
    const bytes = paystubPdf({ name: PT.rex.name, last4: "4417", start: "06/01/2025", end: "06/14/2025", payDate: "06/20/2025", tag: "dupe1" });
    let dialog = await openUpload(page);
    await drop(dialog, { name: "a.pdf", buffer: bytes });
    await confirm(dialog).click();
    await expect(toast(page, /1 pay stub uploaded/i)).toBeVisible();
    const [first] = await docs(PT.rex.employeeId);
    const firstKey = `${S3()}${first!.fileName}`;
    expect(await fakeS3Keys()).toContain(firstKey);

    dialog = await openUpload(page);
    await drop(dialog, { name: "a-again.pdf", buffer: bytes });
    const row = rowOf(dialog);
    await expect(row.getByText(/already on file/i)).toBeVisible();
    await expect(confirm(dialog)).toBeDisabled(); // must choose Replace first
    await row.getByRole("checkbox").check();
    await expect(confirm(dialog)).toBeEnabled();
    await confirm(dialog).click();
    await expect(toast(page, /1 pay stub uploaded/i)).toBeVisible();

    const after = await docs(PT.rex.employeeId);
    expect(after).toHaveLength(1);
    expect(after[0]!.id).not.toBe(first!.id);
    expect(await fakeS3Keys()).not.toContain(firstKey); // old file removed from storage
    expect(await db.auditLog.count({ where: { action: "payroll.document.replace" } })).toBeGreaterThanOrEqual(1);
  });

  test("identical file (same sha256) is rejected by the server and nothing new is saved", async ({ page }) => {
    const bytes = fakePdf("same-bytes");
    let dialog = await openUpload(page);
    await drop(dialog, { name: "one.pdf", buffer: bytes });
    await fill(page, dialog, { employee: PT.rex.name, start: "2025-06-01", end: "2025-06-14" });
    await confirm(dialog).click();
    await expect(toast(page, /1 pay stub uploaded/i)).toBeVisible();

    // Same bytes, different pay period: no auto-match, so only the server catches it.
    dialog = await openUpload(page);
    await drop(dialog, { name: "two.pdf", buffer: bytes });
    await fill(page, dialog, { employee: PT.rex.name, start: "2025-07-01", end: "2025-07-14" });
    await confirm(dialog).click();
    await expect(rowOf(dialog)).toContainText(/Duplicate pay document:.*identical file/);
    await expect(toast(page, /0 uploaded, 1 failed/i)).toBeVisible();
    expect(await docs(PT.rex.employeeId)).toHaveLength(1);
    // The row now offers Replace.
    await expect(rowOf(dialog).getByText(/already on file/i)).toBeVisible();
  });

  test("same category and pay-period end with different bytes is also a duplicate", async ({ page }) => {
    let dialog = await openUpload(page);
    await drop(dialog, { name: "one.pdf", buffer: fakePdf("v1") });
    await fill(page, dialog, { employee: PT.rex.name, start: "2025-06-01", end: "2025-06-14" });
    await confirm(dialog).click();
    await expect(toast(page, /1 pay stub uploaded/i)).toBeVisible();

    dialog = await openUpload(page);
    await drop(dialog, { name: "two.pdf", buffer: fakePdf("v2") });
    await fill(page, dialog, { employee: PT.rex.name, start: "2025-06-01", end: "2025-06-14" });
    await confirm(dialog).click();
    await expect(rowOf(dialog)).toContainText(/Duplicate pay document:.*for this category and pay period/);
    expect(await docs(PT.rex.employeeId)).toHaveLength(1);
  });

  test("two files for the same employee and period in one batch are blocked on screen", async ({ page }) => {
    const dialog = await openUpload(page);
    await dialog.locator('input[type="file"]').setInputFiles([
      { name: "a.pdf", mimeType: "application/pdf", buffer: fakePdf("b1") },
      { name: "b.pdf", mimeType: "application/pdf", buffer: fakePdf("b2") },
    ]);
    await expect(dialog.locator("tbody tr")).toHaveCount(2);
    await expect(rowOf(dialog, 1).getByRole("combobox")).toBeVisible();
    for (const n of [0, 1]) await fill(page, dialog, { employee: PT.rex.name, start: "2025-06-01", end: "2025-06-14" }, n);
    await expect(dialog.getByText(/duplicate in this batch/i)).toHaveCount(2);
    await expect(confirm(dialog)).toBeDisabled();
    // Removing one row clears the block.
    await rowOf(dialog, 1).getByRole("button").click();
    await expect(confirm(dialog)).toBeEnabled();
  });

  test("a batch of two different employees uploads both", async ({ page }) => {
    const dialog = await openUpload(page);
    await dialog.locator('input[type="file"]').setInputFiles([
      { name: "a.pdf", mimeType: "application/pdf", buffer: fakePdf("m1") },
      { name: "b.pdf", mimeType: "application/pdf", buffer: fakePdf("m2") },
    ]);
    await expect(rowOf(dialog, 1).getByRole("combobox")).toBeVisible();
    await fill(page, dialog, { employee: PT.rex.name, start: "2025-06-01", end: "2025-06-14" }, 0);
    await fill(page, dialog, { employee: PT.tina.name, start: "2025-06-01", end: "2025-06-14" }, 1);
    await confirm(dialog).click();
    await expect(toast(page, /2 pay stubs uploaded/i)).toBeVisible();
    expect(await docs(PT.rex.employeeId)).toHaveLength(1);
    expect(await docs(PT.tina.employeeId)).toHaveLength(1);
  });

  test("pay period end before start keeps Confirm disabled", async ({ page }) => {
    const dialog = await openUpload(page);
    await drop(dialog, { name: "a.pdf", buffer: fakePdf("dates") });
    await fill(page, dialog, { employee: PT.rex.name, start: "2025-06-14", end: "2025-06-01" });
    await expect(confirm(dialog)).toBeDisabled();
    await fill(page, dialog, { start: "2025-06-01", end: "2025-06-14" });
    await expect(confirm(dialog)).toBeEnabled();
  });

  test("dates that differ from the chosen pay period get a warning (but can still upload)", async ({ page }) => {
    const dialog = await openUpload(page);
    await drop(dialog, { name: "a.pdf", buffer: fakePdf("mismatch") });
    await fill(page, dialog, { employee: PT.rex.name, start: "2020-01-01", end: "2020-01-14" });
    await expect(dialog.getByText(/doesn.t match selected period/i)).toBeVisible();
    await expect(confirm(dialog)).toBeEnabled();
  });

  test("a non-PDF in the Pay Stub category is refused with the allowed type", async ({ page }) => {
    const dialog = await openUpload(page);
    await drop(dialog, { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await expect(rowOf(dialog)).toBeVisible();
    await fill(page, dialog, { employee: PT.rex.name, start: "2025-06-01", end: "2025-06-14" });
    await confirm(dialog).click();
    await expect(rowOf(dialog)).toContainText(/Unsupported file type\. Allowed: PDF\./);
    expect(await docs(PT.rex.employeeId)).toHaveLength(0);
  });

  test("a file named .pdf whose contents are not a PDF is refused", async ({ page }) => {
    const dialog = await openUpload(page);
    await drop(dialog, { name: "fake.pdf", buffer: Buffer.from("this is not a pdf at all") });
    await fill(page, dialog, { employee: PT.rex.name, start: "2025-06-01", end: "2025-06-14" });
    await confirm(dialog).click();
    await expect(rowOf(dialog)).toContainText(/contents don.t match its type/i);
    expect(await docs(PT.rex.employeeId)).toHaveLength(0);
  });

  test("an empty file is refused", async ({ page }) => {
    const dialog = await openUpload(page);
    await drop(dialog, { name: "empty.pdf", buffer: Buffer.alloc(0) });
    await fill(page, dialog, { employee: PT.rex.name, start: "2025-06-01", end: "2025-06-14" });
    await confirm(dialog).click();
    await expect(rowOf(dialog)).toContainText(/file is empty/i);
    expect(await docs(PT.rex.employeeId)).toHaveLength(0);
  });

  test("a W-2 is refused without the employee's e-delivery consent; allowed once consent is on file", async ({ page }) => {
    let dialog = await openUpload(page);
    await dialog.getByRole("textbox").first().fill("W-2");
    await drop(dialog, { name: "w2.pdf", buffer: fakePdf("w2") });
    await fill(page, dialog, { employee: PT.tina.name, start: "2024-01-01", end: "2024-12-31" });
    await confirm(dialog).click();
    await expect(rowOf(dialog)).toContainText(/hasn.t consented to electronic W-2 delivery/i);
    expect(await docs(PT.tina.employeeId)).toHaveLength(0);

    await db.employee.update({ where: { employeeId: PT.tina.employeeId }, data: { w2ConsentAt: new Date() } });
    dialog = await openUpload(page);
    await dialog.getByRole("textbox").first().fill("w2");
    await drop(dialog, { name: "w2.pdf", buffer: fakePdf("w2b") });
    await fill(page, dialog, { employee: PT.tina.name, start: "2024-01-01", end: "2024-12-31" });
    await confirm(dialog).click();
    await expect(toast(page, /1 pay stub uploaded/i)).toBeVisible();
    expect((await docs(PT.tina.employeeId))[0]!.category).toBe("w2");
  });

  test("an employee who is still pending onboarding review cannot get documents", async ({ page }) => {
    const dialog = await openUpload(page);
    await drop(dialog, { name: "a.pdf", buffer: fakePdf("pending-review") });
    await fill(page, dialog, { employee: PT.penny.name, start: "2025-06-01", end: "2025-06-14" });
    await confirm(dialog).click();
    await expect(rowOf(dialog)).toContainText(/hasn.t been approved yet/i);
    expect(await docs(PT.penny.employeeId)).toHaveLength(0);
  });

  // BUG: upload-paystubs-dialog.tsx onConfirm has no try/catch around uploadPayrollDocument; a network failure leaves uploading=true, Cancel and Confirm stay disabled forever. Proposed fix: wrap the call in try/catch, mark the row error with humanizeUnexpectedError, and always setUploading(false).
  test.fixme("server failure while uploading shows an error, the row can be retried and nothing is stored", async ({ page }) => {
    const dialog = await openUpload(page);
    await drop(dialog, { name: "a.pdf", buffer: fakePdf("fail1") });
    await fill(page, dialog, { employee: PT.rex.name, start: "2025-06-01", end: "2025-06-14" });
    const failing = await failServerActions(page, "abort", { times: 1 });
    await confirm(dialog).click();
    await expect.poll(() => failing.count()).toBe(1);
    await expectNoCrash(page);
    expect(await docs(PT.rex.employeeId)).toHaveLength(0);
    // The dialog must stay usable: Cancel works and a retry succeeds.
    await expect(dialog.getByRole("button", { name: /cancel/i })).toBeEnabled();
    await expect(confirm(dialog)).toBeEnabled();
    await confirm(dialog).click();
    await expect(toast(page, /1 pay stub uploaded/i)).toBeVisible();
    expect(await docs(PT.rex.employeeId)).toHaveLength(1);
  });

  // BUG: same stuck-dialog bug as the abort case (upload-paystubs-dialog.tsx onConfirm).
  test.fixme("server 500 while uploading leaves the dialog usable and stores nothing", async ({ page }) => {
    const dialog = await openUpload(page);
    await drop(dialog, { name: "a.pdf", buffer: fakePdf("fail500") });
    await fill(page, dialog, { employee: PT.rex.name, start: "2025-06-01", end: "2025-06-14" });
    const failing = await failServerActions(page, "500", { times: 1 });
    await confirm(dialog).click();
    await expect.poll(() => failing.count()).toBe(1);
    await expectNoCrash(page);
    expect(await docs(PT.rex.employeeId)).toHaveLength(0);
    await expect(dialog.getByRole("button", { name: /cancel/i })).toBeEnabled();
  });

  test("a failed read of the dropped file still allows manual entry", async ({ page }) => {
    const dialog = await openUpload(page);
    await failServerActions(page, "abort", { times: 1 });
    await drop(dialog, { name: "a.pdf", buffer: fakePdf("preview-fail") });
    await fill(page, dialog, { employee: PT.rex.name, start: "2025-06-01", end: "2025-06-14" });
    await expect(confirm(dialog)).toBeEnabled();
    await confirm(dialog).click();
    await expect(toast(page, /1 pay stub uploaded/i)).toBeVisible();
  });

  test("double-clicking Confirm uploads once", async ({ page }) => {
    const dialog = await openUpload(page);
    await drop(dialog, { name: "a.pdf", buffer: fakePdf("dbl") });
    await fill(page, dialog, { employee: PT.rex.name, start: "2025-06-01", end: "2025-06-14" });
    const calls = await delayServerActions(page, 1200);
    await confirm(dialog).dblclick();
    await expect(toast(page, /1 pay stub uploaded/i)).toBeVisible();
    expect(await docs(PT.rex.employeeId)).toHaveLength(1);
    expect(calls.count()).toBe(1);
  });

  test("stale page (old deployment) during upload does not crash or store anything", async ({ page }) => {
    const dialog = await openUpload(page);
    await drop(dialog, { name: "a.pdf", buffer: fakePdf("stale") });
    await fill(page, dialog, { employee: PT.rex.name, start: "2025-06-01", end: "2025-06-14" });
    await failServerActions(page, "stale");
    await confirm(dialog).click();
    await expect(page.locator("body")).not.toBeEmpty();
    expect(await docs(PT.rex.employeeId)).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Admin: documents list, view, download, delete
// ──────────────────────────────────────────────────────────────────────
test.describe("admin payroll documents: list, download, delete", () => {
  test.use({ storageState: ADMIN_STATE });
  const BYTES = fakePdf("admin-list");

  async function seedDoc(title = "PT Admin Stub") {
    const emp = await db.employee.findUniqueOrThrow({ where: { employeeId: PT.rex.employeeId } });
    const fileName = `${emp.id}/2025-06-14-${Date.now()}-stub.pdf`;
    await putFakeS3(`payroll/${fileName}`, BYTES, "application/pdf");
    return db.payroll.create({
      data: {
        employeeId: emp.id,
        title,
        category: "Pay Stub",
        fileName,
        fileType: "application/pdf",
        fileUrl: `payroll/${fileName}`,
        fileSha256: sha(BYTES),
        payPeriodStart: dateOnly("2025-06-01"),
        payPeriodEnd: dateOnly("2025-06-14"),
      },
    });
  }

  async function openDocs(page: Page) {
    await page.goto("/admin/payroll");
    await page.getByRole("tab", { name: /documents/i }).click();
  }
  const item = (page: Page, title: string) => page.getByRole("listitem").filter({ hasText: title });

  test("lists the document with employee, category and period", async ({ page }) => {
    await seedDoc();
    await openDocs(page);
    const li = item(page, "PT Admin Stub");
    await expect(li).toContainText(`${PT.rex.name} · Pay Stub`);
    await expect(li).toContainText("Jun 1, 2025");
    await expect(li).toContainText("Jun 14, 2025");
  });

  test("view and download return the stored file with safe headers", async ({ page }) => {
    const d = await seedDoc();
    await openDocs(page);
    await expect(item(page, "PT Admin Stub").getByRole("link", { name: /view document/i })).toHaveAttribute("href", `/api/payroll/${d.id}/file`);
    const view = await page.request.get(`/api/payroll/${d.id}/file`);
    expect(view.status()).toBe(200);
    expect(view.headers()["content-type"]).toBe("application/pdf");
    expect(view.headers()["content-disposition"]).toMatch(/^inline/);
    expect(view.headers()["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.from(await view.body()).equals(BYTES)).toBe(true);
    const dl = await page.request.get(`/api/payroll/${d.id}/file?download=1`);
    expect(dl.headers()["content-disposition"]).toMatch(/^attachment; filename="PT Admin Stub\.pdf"/);
    // The download link in the UI really downloads.
    const download = page.waitForEvent("download");
    await item(page, "PT Admin Stub").getByRole("link", { name: /download document/i }).click();
    expect((await download).suggestedFilename()).toBe("PT Admin Stub.pdf");
  });

  test("a missing id gives 404 and a missing stored file gives 404", async ({ page }) => {
    expect((await page.request.get("/api/payroll/no-such-doc/file")).status()).toBe(404);
    const d = await seedDoc();
    await db.payroll.update({ where: { id: d.id }, data: { fileName: "gone/missing.pdf" } });
    expect((await page.request.get(`/api/payroll/${d.id}/file`)).status()).toBe(404);
  });

  test("delete asks first; cancelling keeps the document", async ({ page }) => {
    const d = await seedDoc();
    await openDocs(page);
    page.once("dialog", (dlg) => {
      expect(dlg.message()).toContain("PT Admin Stub");
      void dlg.dismiss();
    });
    await item(page, "PT Admin Stub").getByRole("button", { name: /delete document/i }).click();
    await expect(item(page, "PT Admin Stub")).toBeVisible();
    expect(await db.payroll.count({ where: { id: d.id } })).toBe(1);
  });

  test("delete removes the row and the stored file, and writes an audit record", async ({ page }) => {
    const d = await seedDoc();
    expect(await fakeS3Keys()).toContain(`${S3()}${d.fileName}`);
    await openDocs(page);
    page.once("dialog", (dlg) => void dlg.accept());
    await item(page, "PT Admin Stub").getByRole("button", { name: /delete document/i }).click();
    await expect(toast(page, /payroll document deleted/i)).toBeVisible();
    await expect(item(page, "PT Admin Stub")).toHaveCount(0);
    expect(await db.payroll.count({ where: { id: d.id } })).toBe(0);
    await expect.poll(async () => (await fakeS3Keys()).includes(`${S3()}${d.fileName}`)).toBe(false);
    expect(await db.auditLog.count({ where: { action: "payroll.document.delete", resource: `Payroll:${d.id}` } })).toBe(1);
  });

  test("deleting a document someone else already deleted gives a clear message", async ({ page }) => {
    const d = await seedDoc();
    await openDocs(page);
    await db.payroll.delete({ where: { id: d.id } });
    page.once("dialog", (dlg) => void dlg.accept());
    await item(page, "PT Admin Stub").getByRole("button", { name: /delete document/i }).click();
    await expect(toast(page, /no longer exists/i)).toBeVisible();
  });

  test("delete failure keeps the document and the file", async ({ page }) => {
    const d = await seedDoc();
    await openDocs(page);
    await failServerActions(page, "abort");
    page.once("dialog", (dlg) => void dlg.accept());
    await item(page, "PT Admin Stub").getByRole("button", { name: /delete document/i }).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    expect(await db.payroll.count({ where: { id: d.id } })).toBe(1);
    expect(await fakeS3Keys()).toContain(`${S3()}${d.fileName}`);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Employee: only their own documents
// ──────────────────────────────────────────────────────────────────────
test.describe("employee pay stubs", () => {
  let ella: BrowserContext;
  let page: Page;
  const ids: Record<string, string> = {};
  const BYTES = fakePdf("ella-stub");

  async function seedFor(employeeId: string, title: string, end: string) {
    const emp = await db.employee.findUniqueOrThrow({ where: { employeeId } });
    const fileName = `${emp.id}/${end}-${title.replace(/\W+/g, "-")}.pdf`;
    await putFakeS3(`payroll/${fileName}`, BYTES, "application/pdf");
    const d = await db.payroll.create({
      data: {
        employeeId: emp.id,
        title,
        category: "Pay Stub",
        fileName,
        fileType: "application/pdf",
        fileUrl: `payroll/${fileName}`,
        fileSha256: createHash("sha256").update(title).digest("hex"),
        payPeriodStart: dateOnly("2025-06-01"),
        payPeriodEnd: dateOnly(end),
      },
    });
    ids[title] = d.id;
  }

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    await seedFor(PT.ella.employeeId, "PT Ella Stub One", "2025-06-14");
    await seedFor(PT.ella.employeeId, "PT Ella Stub Two", "2025-06-28");
    await seedFor(PIN_EMPLOYEE.employeeId, "PT Pia Secret Stub", "2025-06-14");
    ella = await sessionFor(browser, "ella", PT.ella.email);
    page = await ella.newPage();
  });
  test.afterAll(async () => {
    await db.payroll.deleteMany({ where: { title: { startsWith: "PT " } } });
    await ella?.close();
  });

  test("sees only their own documents, newest period first", async () => {
    await page.goto("/dashboard/payroll");
    await expect(page.getByText("PT Ella Stub One")).toBeVisible();
    await expect(page.getByText("PT Ella Stub Two")).toBeVisible();
    await expect(page.getByText("PT Pia Secret Stub")).toHaveCount(0);
    const titles = await page.locator("li p.text-sm.font-medium").allTextContents();
    expect(titles.indexOf("PT Ella Stub Two")).toBeLessThan(titles.indexOf("PT Ella Stub One"));
    await expect(page.getByRole("listitem").filter({ hasText: "PT Ella Stub" })).toHaveCount(2);
  });

  test("can view and download their own file", async () => {
    await page.goto("/dashboard/payroll");
    const own = await page.request.get(`/api/payroll/${ids["PT Ella Stub One"]}/file`);
    expect(own.status()).toBe(200);
    expect(Buffer.from(await own.body()).equals(BYTES)).toBe(true);
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download PT Ella Stub One" }).click();
    expect((await download).suggestedFilename()).toBe("PT Ella Stub One.pdf");
  });

  test("cannot fetch another employee's file by id (403) and the file API needs a login (401)", async ({ browser }) => {
    const other = await page.request.get(`/api/payroll/${ids["PT Pia Secret Stub"]}/file`);
    expect(other.status()).toBe(403);
    const anon = await browser.newContext({ baseURL: BASE_URL });
    const res = await anon.request.get(`/api/payroll/${ids["PT Ella Stub One"]}/file`, { maxRedirects: 0 });
    expect([301, 302, 303, 307, 308, 401]).toContain(res.status());
    expect(res.headers()["content-type"] ?? "").not.toContain("application/pdf");
    await anon.close();
  });

  test("a deleted document disappears from their page", async () => {
    await seedFor(PT.ella.employeeId, "PT Ella Temp Stub", "2025-07-12");
    await page.goto("/dashboard/payroll");
    await expect(page.getByText("PT Ella Temp Stub")).toBeVisible();
    await db.payroll.delete({ where: { id: ids["PT Ella Temp Stub"] } });
    await page.reload();
    await expect(page.getByText("PT Ella Temp Stub")).toHaveCount(0);
    expect((await page.request.get(`/api/payroll/${ids["PT Ella Temp Stub"]}/file`)).status()).toBe(404);
  });

  test("upcoming pay dates list only future pay dates", async () => {
    const admin = await db.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    const p = await db.payrollCalendar.create({
      data: {
        title: "PT Temp Future Pay",
        payPeriodStart: dateOnly("2031-01-05"),
        payPeriodEnd: dateOnly("2031-01-18"),
        payDate: dateOnly("2031-01-23"),
        status: "UPCOMING",
        createdById: admin.id,
      },
    });
    try {
      await page.goto("/dashboard/payroll");
      await expect(page.getByText("PT Temp Future Pay")).toBeVisible();
      await expect(page.getByText("Jan 23, 2031").first()).toBeVisible();
      await expect(page.getByText("PT Period A")).toHaveCount(0); // pay date long past
    } finally {
      await db.payrollCalendar.delete({ where: { id: p.id } });
    }
  });

  test("an employee cannot open the admin payroll page", async () => {
    await page.goto("/admin/payroll");
    await expect(page).toHaveURL(/unauthorized/);
    await expect(page.getByRole("button", { name: /new pay period/i })).toHaveCount(0);
  });

  test("a user with no documents sees the empty state", async ({ browser }) => {
    const zed = await sessionFor(browser, "zed", PT.zed.email);
    const p = await zed.newPage();
    await p.goto("/dashboard/payroll");
    await expect(p.getByText(/no payroll documents yet/i)).toBeVisible();
    await expect(p.getByText(/PT .* Stub/)).toHaveCount(0);
    await zed.close();
  });
});
