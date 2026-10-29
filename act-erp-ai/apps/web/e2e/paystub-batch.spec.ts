import { test, expect, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { PDFDocument, PDFName, StandardFonts, rgb } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { db } from "./support/db";
import { fakeS3Keys } from "./support/fake-s3";
import { PERIOD_A, PT, sessionFor } from "./support/payroll-time";
import { ADMIN_STATE, BASE_URL } from "./support/test-data";

// All identities and check references belong to the synthetic e2e seed.
const IDS = [PT.rex.employeeId, PT.ella.employeeId];
const QA = "D:/Deployed Projects/ACT Sprout/tmp/persona-paystub-release/qa";
const rex = { name: PT.rex.name, last4: "4417", check: "BATCH-REX-100" };
const ella = { name: PT.ella.name, last4: "5588", check: "BATCH-ELLA-200" };
type Identity = { name: string; last4: string; check: string };

test.use({ storageState: ADMIN_STATE });

test.beforeEach(async () => {
  await db.payroll.deleteMany({ where: { employee: { employeeId: { in: IDS } } } });
  await db.employee.update({
    where: { employeeId: PT.rex.employeeId },
    data: { ssnLast4: rex.last4 },
  });
  await db.employee.update({
    where: { employeeId: PT.ella.employeeId },
    data: { ssnLast4: ella.last4 },
  });
});

test.afterEach(async () => {
  await db.payroll.deleteMany({ where: { employee: { employeeId: { in: IDS } } } });
  await db.employee.updateMany({
    where: { employeeId: { in: IDS } },
    data: { ssnLast4: null },
  });
});

async function syntheticPdf(identities: Identity[], extraLines: string[] = []) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const identity of identities) {
    const page = pdf.addPage([612, 792]);
    const lines = [
      "Employee Pay Stub",
      `${identity.name} ***-**-${identity.last4}, Hourly`,
      "Pay Period: 03/01/2025 - 03/14/2025",
      "Pay Date: 03/19/2025",
      `Check number: ${identity.check}`,
      "Net Pay 100.00",
      ...extraLines,
    ];
    lines.forEach((line, index) =>
      page.drawText(line, { x: 50, y: 730 - index * 22, size: 12, font }),
    );
  }
  // A linked destination must not cause the other person's page to travel with a fragment.
  if (pdf.getPageCount() > 1) {
    const annotation = pdf.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [0, 0, 20, 20],
      Dest: [pdf.getPage(1).ref, PDFName.of("Fit")],
    });
    pdf.getPage(0).node.set(PDFName.of("Annots"), pdf.context.obj([annotation]));
  }
  return Buffer.from(await pdf.save());
}

async function textPdf(lines: string[], pageCount = 1) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < pageCount; index++) {
    const page = pdf.addPage([612, 792]);
    // A synthetic image-like scan has no readable text layer.
    if (!lines.length)
      page.drawRectangle({
        x: 50,
        y: 50,
        width: 500,
        height: 650,
        color: rgb(0.9, 0.9, 0.9),
      });
    lines.forEach((line, position) =>
      page.drawText(line, { x: 50, y: 730 - position * 22, size: 12, font }),
    );
  }
  return Buffer.from(await pdf.save());
}

async function openUpload(page: Page) {
  await page.goto("/admin/payroll/import");
  await expect(page.getByRole("heading", { name: "Import pay stubs", exact: true })).toBeVisible();
  await page.getByLabel("Pay period", { exact: true }).click();
  await page.getByRole("option", { name: PERIOD_A.title, exact: true }).click();
  return page.locator("body");
}

async function drop(
  dialog: Locator,
  bytes: Buffer,
  name = "synthetic-combined-paystubs.pdf",
  pageCount = 2,
) {
  await dialog
    .getByLabel("PDF files", { exact: true })
    .setInputFiles({ name, mimeType: "application/pdf", buffer: bytes });
  await expect(dialog.getByRole("row", { name: new RegExp(`^Page .+ of ${name}$`) })).toHaveCount(
    pageCount,
  );
  await expect(dialog.getByText("Analyzing PDFs…", { exact: true })).toHaveCount(0);
}

function rowOf(dialog: Locator, pageNumber: number, sourceName = "synthetic-combined-paystubs.pdf") {
  return dialog.getByRole("row", {
    name: `Page ${pageNumber} of ${sourceName}`,
    exact: true,
  });
}

async function selectReviewed(
  row: Locator,
  pageNumber: number,
  sourceName = "synthetic-combined-paystubs.pdf",
) {
  const table = row.locator("xpath=ancestor::table[1]");
  const employeeReason = table.getByLabel(
    `Employee assignment reason page ${pageNumber} of ${sourceName}`,
    { exact: true },
  );
  if (await employeeReason.count())
    await employeeReason.fill("Verified synthetic employee name against this page.");
  const dateReason = table.getByLabel(`Pay period reason page ${pageNumber} of ${sourceName}`, {
    exact: true,
  });
  if (await dateReason.count())
    await dateReason.fill("Verified the printed synthetic pay period.");
  await row
    .getByRole("checkbox", {
      name: `Reviewed page ${pageNumber} of ${sourceName}`,
      exact: true,
    })
    .check();
  await row
    .getByRole("checkbox", {
      name: `Select page ${pageNumber} of ${sourceName}`,
      exact: true,
    })
    .check();
}

async function confirmSelected(dialog: Locator, count: number) {
  await dialog
    .getByRole("button", { name: `Review selected (${count})`, exact: true })
    .click();
  const confirmation = dialog.getByRole("region", {
    name: "Confirm selected pages",
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  await confirmation
    .getByRole("checkbox", { name: /I confirm these selected pages/ })
    .check();
  await dialog
    .getByRole("button", { name: `Save ${count} selected pages`, exact: true })
    .click();
  await expect(dialog.getByText(/Import finished\./)).toBeVisible();
}

const docs = () =>
  db.payroll.findMany({
    where: { employee: { employeeId: { in: IDS } } },
    include: { employee: { select: { name: true } } },
    orderBy: { sourcePage: "asc" },
  });

async function extractedText(bytes: Buffer) {
  const task = getDocument({
    data: Uint8Array.from(bytes),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0,
  });
  try {
    const pdf = await task.promise;
    const strings: string[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const content = await (await pdf.getPage(number)).getTextContent();
      strings.push(
        content.items.map((item) => ("str" in item ? item.str : "")).join(" "),
      );
    }
    return { pageCount: pdf.numPages, text: strings.join("\n") };
  } finally {
    await task.destroy();
  }
}

async function businessState() {
  const [periods, employees, time] = await Promise.all([
    db.payrollCalendar.findMany({ orderBy: { id: "asc" } }),
    db.employee.findMany({
      where: { employeeId: { in: IDS } },
      select: { id: true, employmentStatus: true },
      orderBy: { id: "asc" },
    }),
    db.timeEntry.findMany({
      where: { employee: { employeeId: { in: IDS } } },
      include: { breaks: true },
      orderBy: { id: "asc" },
    }),
  ]);
  return JSON.stringify({ periods, employees, time });
}

async function assertNoOverflow(page: Page, dialog: Locator) {
  // The existing payroll table remains behind the modal. Verify this feature's
  // viewport bounds and contents rather than the background table's scroll size.
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(
    await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
}

test("combined source saves isolated pages, enforces employee access, and skips reimports", async ({
  page,
  browser,
}) => {
  const bytes = await syntheticPdf([rex, ella]);
  const dialog = await openUpload(page);
  const beforeKeys = await fakeS3Keys();
  await drop(dialog, bytes);
  await expect(
    rowOf(dialog, 1).getByRole("combobox", {
      name: "Employee for page 1 of synthetic-combined-paystubs.pdf",
      exact: true,
    }),
  ).toContainText(rex.name);
  await expect(
    rowOf(dialog, 2).getByRole("combobox", {
      name: "Employee for page 2 of synthetic-combined-paystubs.pdf",
      exact: true,
    }),
  ).toContainText(ella.name);
  await expect(dialog.getByText(/100\.00/)).toHaveCount(0);
  await expect(
    rowOf(dialog, 1).getByRole("checkbox", {
      name: "Select page 1 of synthetic-combined-paystubs.pdf",
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(
    rowOf(dialog, 1).getByRole("checkbox", {
      name: "Reviewed page 1 of synthetic-combined-paystubs.pdf",
      exact: true,
    }),
  ).not.toBeChecked();
  expect(await docs()).toHaveLength(0);
  expect(await fakeS3Keys()).toEqual(beforeKeys);

  await mkdir(QA, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1080 });
  await assertNoOverflow(page, dialog);
  await page.screenshot({
    path: `${QA}/batch-paystubs-desktop.png`,
    fullPage: true,
    animations: "disabled",
    caret: "initial",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await assertNoOverflow(page, dialog);
  await page.screenshot({
    path: `${QA}/batch-paystubs-mobile.png`,
    fullPage: true,
    animations: "disabled",
    caret: "initial",
  });
  await page.setViewportSize({ width: 1440, height: 1080 });

  await selectReviewed(rowOf(dialog, 1), 1);
  await selectReviewed(rowOf(dialog, 2), 2);
  await confirmSelected(dialog, 2);
  const saved = await docs();
  expect(saved).toHaveLength(2);
  expect(saved.map((doc) => doc.sourcePage)).toEqual([1, 2]);
  expect(new Set(saved.map((doc) => doc.sourceSha256)).size).toBe(1);
  for (const document of saved) {
    const response = await page.request.get(`/api/payroll/${document.id}/file`);
    expect(response.status()).toBe(200);
    const body = Buffer.from(await response.body());
    const parsed = await extractedText(body);
    expect(parsed.pageCount).toBe(1);
    expect(parsed.text).toContain(document.employee.name);
    expect(parsed.text).not.toContain(
      document.employee.name === rex.name ? ella.name : rex.name,
    );
    const fragment = await PDFDocument.load(body);
    expect(fragment.getPage(0).node.has(PDFName.of("Annots"))).toBe(false);
  }

  const own = saved.find((doc) => doc.employee.name === ella.name)!;
  const other = saved.find((doc) => doc.employee.name === rex.name)!;
  const employeeContext = await sessionFor(browser, "batch-ella", PT.ella.email);
  try {
    const employeePage = await employeeContext.newPage();
    await employeePage.goto("/dashboard/payroll");
    expect((await employeePage.request.get(`/api/payroll/${own.id}/file`)).status()).toBe(
      200,
    );
    expect(
      (await employeePage.request.get(`/api/payroll/${other.id}/file`)).status(),
    ).toBe(403);
  } finally {
    await employeeContext.close();
  }
  const anonymous = await browser.newContext({
    baseURL: BASE_URL,
    storageState: { cookies: [], origins: [] },
  });
  try {
    const response = await anonymous.request.get(`/api/payroll/${own.id}/file`, {
      maxRedirects: 0,
    });
    expect([301, 302, 303, 307, 308, 401]).toContain(response.status());
    expect(response.headers()["content-type"] ?? "").not.toContain("application/pdf");
  } finally {
    await anonymous.close();
  }

  await dialog.getByRole("button", { name: "Back to payroll", exact: true }).click();
  const again = await openUpload(page);
  const afterKeys = await fakeS3Keys();
  await drop(again, bytes, "same-source-again.pdf");
  await expect(again.getByText("Already imported", { exact: true })).toHaveCount(2);
  await expect(
    again.getByRole("button", { name: "Review selected (0)", exact: true }),
  ).toBeDisabled();
  expect(await docs()).toHaveLength(2);
  expect(await fakeS3Keys()).toEqual(afterKeys);
});

test("only explicitly reviewed selected pages publish, without changing pay periods or time", async ({
  page,
}) => {
  const unchanged = await businessState();
  const dialog = await openUpload(page);
  await drop(dialog, await syntheticPdf([rex, ella]));
  expect(await docs()).toHaveLength(0);
  expect(await businessState()).toBe(unchanged);
  await rowOf(dialog, 1)
    .getByRole("checkbox", {
      name: "Select page 1 of synthetic-combined-paystubs.pdf",
      exact: true,
    })
    .check();
  await expect(
    dialog.getByRole("button", { name: "Review selected (1)", exact: true }),
  ).toBeDisabled();
  await rowOf(dialog, 1)
    .getByRole("checkbox", {
      name: "Reviewed page 1 of synthetic-combined-paystubs.pdf",
      exact: true,
    })
    .check();
  await confirmSelected(dialog, 1);
  const saved = await docs();
  expect(saved).toHaveLength(1);
  expect(saved[0].employee.name).toBe(rex.name);
  expect(saved[0].sourcePage).toBe(1);
  await expect(
    rowOf(dialog, 2).getByRole("checkbox", {
      name: "Select page 2 of synthetic-combined-paystubs.pdf",
      exact: true,
    }),
  ).not.toBeChecked();
  expect(await businessState()).toBe(unchanged);
});

test("summaries, mixed identities, continuations and scans stay excluded; OCR is bounded", async ({
  page,
}) => {
  const unchanged = await businessState();
  const beforeKeys = await fakeS3Keys();
  const dialog = await openUpload(page);
  await dialog.getByLabel("PDF files", { exact: true }).setInputFiles([
    {
      name: "summary.pdf",
      mimeType: "application/pdf",
      buffer: await textPdf([
        "Payroll Summary",
        `${rex.name} ***-**-${rex.last4}`,
        `${ella.name} ***-**-${ella.last4}`,
      ]),
    },
    {
      name: "mixed-identities.pdf",
      mimeType: "application/pdf",
      buffer: await syntheticPdf([rex], [`${ella.name} ***-**-${ella.last4}, Hourly`]),
    },
    {
      name: "continuation.pdf",
      mimeType: "application/pdf",
      buffer: await syntheticPdf([rex], ["Page 2 of 2 - continued"]),
    },
    {
      name: "eleven-scanned-pages.pdf",
      mimeType: "application/pdf",
      buffer: await textPdf([], 11),
    },
  ]);
  await expect(dialog.getByRole("row", { name: /^Page / })).toHaveCount(14);
  await expect(dialog.getByText("Analyzing PDFs…", { exact: true })).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Review selected (0)", exact: true }),
  ).toBeDisabled();
  await expect(dialog.getByRole("checkbox", { name: /^Select page/ })).toHaveCount(14);
  for (const checkbox of await dialog
    .getByRole("checkbox", { name: /^Select page/ })
    .all())
    await expect(checkbox).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Use OCR for scanned pages", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(/up to 10 scanned pages/i);
  expect(await docs()).toHaveLength(0);
  expect(await fakeS3Keys()).toEqual(beforeKeys);
  expect(await businessState()).toBe(unchanged);
});

test("stale employee evidence requires a fresh review before retry succeeds", async ({
  page,
}) => {
  const dialog = await openUpload(page);
  await drop(dialog, await syntheticPdf([rex]), "stale-evidence.pdf", 1);
  await selectReviewed(rowOf(dialog, 1, "stale-evidence.pdf"), 1, "stale-evidence.pdf");
  await dialog.getByRole("button", { name: "Review selected (1)", exact: true }).click();
  await dialog.getByRole("checkbox", { name: /I confirm these selected pages/ }).check();
  await db.employee.update({
    where: { employeeId: PT.rex.employeeId },
    data: { ssnLast4: "4499" },
  });
  await dialog
    .getByRole("button", { name: "Save 1 selected pages", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(/roster|evidence|analy[sz]e/i);
  expect(await docs()).toHaveLength(0);
  await dialog.getByRole("button", { name: "Analyze again", exact: true }).click();
  await expect(
    dialog.getByLabel("Employee assignment reason page 1 of stale-evidence.pdf", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    rowOf(dialog, 1, "stale-evidence.pdf").getByRole("checkbox", {
      name: "Reviewed page 1 of stale-evidence.pdf",
      exact: true,
    }),
  ).not.toBeChecked();
  await selectReviewed(rowOf(dialog, 1, "stale-evidence.pdf"), 1, "stale-evidence.pdf");
  await confirmSelected(dialog, 1);
  expect(await docs()).toHaveLength(1);
});

test("separate sources reviewed together save both employees without stale duplicate evidence", async ({
  page,
}) => {
  const dialog = await openUpload(page);
  const unchanged = await businessState();
  await dialog.getByLabel("PDF files", { exact: true }).setInputFiles([
    {
      name: "rex-source.pdf",
      mimeType: "application/pdf",
      buffer: await syntheticPdf([rex]),
    },
    {
      name: "ella-source.pdf",
      mimeType: "application/pdf",
      buffer: await syntheticPdf([ella]),
    },
  ]);
  await expect(dialog.getByRole("row", { name: /^Page / })).toHaveCount(2);
  await expect(dialog.getByText("Analyzing PDFs…", { exact: true })).toHaveCount(0);
  expect(await docs()).toHaveLength(0);
  await selectReviewed(rowOf(dialog, 1, "rex-source.pdf"), 1, "rex-source.pdf");
  await selectReviewed(rowOf(dialog, 1, "ella-source.pdf"), 1, "ella-source.pdf");
  await confirmSelected(dialog, 2);
  await expect(dialog.getByText("SAVED", { exact: true })).toHaveCount(2);
  await expect(dialog.getByText("FAILED", { exact: true })).toHaveCount(0);
  const saved = await docs();
  expect(saved).toHaveLength(2);
  expect(saved.map((document) => document.employee.name).sort()).toEqual(
    [rex.name, ella.name].sort(),
  );
  expect(new Set(saved.map((document) => document.sourceSha256)).size).toBe(2);
  expect(saved.every((document) => document.sourcePage === 1)).toBe(true);
  expect(await businessState()).toBe(unchanged);
});

test("concurrent admin confirmations retain one document, audit, notification and storage object", async ({
  page,
  browser,
}) => {
  const bytes = await syntheticPdf([rex]);
  const keysBefore = new Set(await fakeS3Keys());
  const auditBefore = await db.auditLog.count({
    where: { action: "payroll.document.upload" },
  });
  const notificationsBefore = await db.notificationRecipient.count({
    where: {
      employee: { employeeId: PT.rex.employeeId },
      notification: { type: "PAYROLL", title: "New pay document available" },
    },
  });
  const secondContext = await browser.newContext({
    baseURL: BASE_URL,
    storageState: ADMIN_STATE,
  });
  try {
    const secondPage = await secondContext.newPage();
    const firstDialog = await openUpload(page);
    const secondDialog = await openUpload(secondPage);
    // Both independent browser action queues finish the same preview before either writes.
    await Promise.all([
      drop(firstDialog, bytes, "same-concurrent-source.pdf", 1),
      drop(secondDialog, bytes, "same-concurrent-source.pdf", 1),
    ]);
    expect(await docs()).toHaveLength(0);
    await Promise.all([
      selectReviewed(
        rowOf(firstDialog, 1, "same-concurrent-source.pdf"),
        1,
        "same-concurrent-source.pdf",
      ),
      selectReviewed(
        rowOf(secondDialog, 1, "same-concurrent-source.pdf"),
        1,
        "same-concurrent-source.pdf",
      ),
    ]);
    for (const dialog of [firstDialog, secondDialog]) {
      await dialog
        .getByRole("button", { name: "Review selected (1)", exact: true })
        .click();
      await dialog
        .getByRole("checkbox", { name: /I confirm these selected pages/ })
        .check();
    }
    // Exercise the real PostgreSQL uniqueness/advisory-lock path from two requests.
    await Promise.all([
      firstDialog
        .getByRole("button", { name: "Save 1 selected pages", exact: true })
        .click(),
      secondDialog
        .getByRole("button", { name: "Save 1 selected pages", exact: true })
        .click(),
    ]);
    for (const dialog of [firstDialog, secondDialog]) {
      await expect(dialog.getByText(/Import finished\./)).toBeVisible();
      await expect(
        rowOf(dialog, 1, "same-concurrent-source.pdf").getByText(/^(SAVED|EXISTING)$/),
      ).toBeVisible();
      await expect(
        rowOf(dialog, 1, "same-concurrent-source.pdf").getByText("FAILED", { exact: true }),
      ).toHaveCount(0);
    }
    const saved = await docs();
    expect(saved).toHaveLength(1);
    expect(saved[0].employee.name).toBe(rex.name);
    expect(
      await db.auditLog.count({ where: { action: "payroll.document.upload" } }),
    ).toBe(auditBefore + 1);
    expect(
      await db.auditLog.count({
        where: { action: "payroll.document.upload", resource: `Payroll:${saved[0].id}` },
      }),
    ).toBe(1);
    expect(
      await db.notificationRecipient.count({
        where: {
          employee: { employeeId: PT.rex.employeeId },
          notification: { type: "PAYROLL", title: "New pay document available" },
        },
      }),
    ).toBe(notificationsBefore + 1);
    const retainedKeys = (await fakeS3Keys()).filter((key) => !keysBefore.has(key));
    expect(retainedKeys).toEqual([
      `${process.env.S3_BUCKET}/payroll/${saved[0].fileName}`,
    ]);
  } finally {
    await secondContext.close();
  }
});
