import { test, expect, type Page } from "@playwright/test";
import AdmZip from "adm-zip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "./support/db";
import { fakeS3Keys } from "./support/fake-s3";
import { failServerActions, toast } from "./support/helpers";
import { PEOPLE, personRow, personUrl, pngBytes } from "./support/people";
import { ADMIN_STATE } from "./support/test-data";

test.use({ storageState: ADMIN_STATE });

/** A one-page PDF with a real text layer (>= 200 characters so no OCR is attempted). */
async function textPdf(lines: string[]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  lines.forEach((l, i) => page.drawText(l, { x: 40, y: 740 - i * 18, size: 10, font }));
  return Buffer.from(await doc.save());
}

const I9_TEXT = [
  "Form I-9 Employment Eligibility Verification  Department of Homeland Security  USCIS",
  "Section 1. Employee Information and Attestation. Date of Birth: 03/04/1990",
  "SSN: 6789 Phone (281) 555-0142 Email hugo.personal@example.com",
  "Employee must complete and sign Section 1 of Form I-9 no later than the first day of employment.",
];

async function goodZip() {
  const zip = new AdmZip();
  zip.addFile("i9.pdf", await textPdf(I9_TEXT));
  zip.addFile("badge.png", pngBytes());
  zip.addFile("notes.exe", Buffer.from("MZ not allowed"));
  return zip.toBuffer();
}

type Upload = { name: string; buffer: Buffer } | string;

async function upload(page: Page, key: keyof typeof PEOPLE, file: Upload) {
  await page.goto(await personUrl(key));
  if (await page.getByText("Page not found").count()) await page.reload();
  await page.getByRole("button", { name: /import hire packet/i }).click();
  const dialog = page.getByRole("dialog", { name: /import hire packet/i });
  await dialog
    .getByLabel(/zip file/i)
    .setInputFiles(typeof file === "string" ? file : { name: file.name, mimeType: "application/zip", buffer: file.buffer });
  await dialog.getByRole("button", { name: /upload & process/i }).click();
  return dialog;
}

const jobs = (key: keyof typeof PEOPLE) =>
  personRow(key).then((e) => db.hirePacketImport.findMany({ where: { employeeId: e.id }, orderBy: { createdAt: "asc" } }));

/** A finished import with proposals, created directly so review/apply do not depend on PDF parsing. */
async function readyJob(key: keyof typeof PEOPLE) {
  const e = await personRow(key);
  const admin = await db.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  const field = (value: string) => ({ value, confidence: "high", sourceFile: "i9.pdf", sourceForm: "I9" });
  return db.hirePacketImport.create({
    data: {
      employeeId: e.id,
      uploadedById: admin.id,
      status: "READY",
      zipFileName: "seeded.zip",
      zipStorageKey: "hire-packets/seeded/seeded.zip",
      proposedFields: {
        ssnLast4: field("6789"),
        dateOfBirth: field("1990-03-04"),
        phoneNumber: field("(281) 555-0142"),
        personalEmail: field("hugo.personal@example.com"),
      },
      fileResults: [{ fileName: "i9.pdf", documentId: null, formType: "I9", textSource: "digital", warnings: [] }],
      processedAt: new Date(),
    },
  });
}

const applyBtn = (page: Page) => page.getByRole("button", { name: /^apply \d+ fields?$/i });

test.afterAll(async () => {
  for (const k of ["hp1", "hp2"] as const) {
    const e = await personRow(k);
    await db.hirePacketImport.deleteMany({ where: { employeeId: e.id } });
    await db.document.deleteMany({ where: { employeeId: e.id } });
    await db.employee.update({
      where: { id: e.id },
      data: { phoneNumber: null, dateOfBirth: null, ssnLast4: null, personalEmail: null },
    });
  }
});

test.describe("hire packet import", () => {
  test("upload and process a packet with a text PDF and an image", async ({ page }) => {
    await upload(page, "hp1", { name: "packet.zip", buffer: await goodZip() });
    await expect(page).toHaveURL(/\/hire-import\//);
    await expect(page.getByText(/imported files|import failed/i).first()).toBeVisible({ timeout: 60_000 });
    // BUG (dev server): pdf.js cannot load its worker (pdf.worker.mjs) under `next dev`, so any text
    // PDF fails the whole import. src/lib/hire-packet/extract/pdf-text.ts. Proposed fix: point
    // GlobalWorkerOptions.workerSrc at the worker copied by scripts/copy-pdf-worker.mjs.
    await expect(page.getByText("i9.pdf", { exact: true })).toBeVisible();
    await expect(page.getByText("badge.png", { exact: true })).toBeVisible();
    await expect(page.getByText("notes.exe")).toHaveCount(0); // filtered by extension
    const e = await personRow("hp1");
    expect(await db.document.count({ where: { employeeId: e.id, fileName: { contains: "/hire-import/" } } })).toBe(2);
    expect((await fakeS3Keys()).some((k) => k.includes("hire-packets/"))).toBe(true);
    await expect(page.getByRole("checkbox", { name: /date of birth/i })).toBeVisible();
  });

  test("review shows current vs proposed; apply writes only the ticked fields", async ({ page }) => {
    const job = await readyJob("hp1");
    const e = await personRow("hp1");
    await page.goto(`/admin/employees/${e.id}/hire-import/${job.id}`);
    await expect(page.getByRole("heading", { name: /review hire packet import/i })).toBeVisible();
    await expect(page.getByText("(281) 555-0142")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /phone/i })).toBeChecked();
    await page.getByRole("checkbox", { name: /personal email/i }).uncheck();
    await page.getByRole("button", { name: /^apply 3 fields$/i }).click();
    await expect.poll(async () => (await db.hirePacketImport.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("APPLIED");

    const after = await personRow("hp1");
    expect(after.ssnLast4).toBe("6789");
    expect(after.dateOfBirth?.toISOString().slice(0, 10)).toBe("1990-03-04");
    expect(after.phoneNumber).toContain("555");
    expect(after.personalEmail).toBeNull(); // not selected
    expect(await db.auditLog.count({ where: { action: "hire_packet.apply", resource: `HirePacketImport:${job.id}` } })).toBe(1);

    await page.goto(`/admin/employees/${e.id}/hire-import/${job.id}`);
    await expect(page.getByText(/fields applied to/i)).toBeVisible();
  });

  // BUG (app): the review page formats a date-only proposal with new Date("1990-03-04").toLocaleDateString(),
  // which is UTC midnight shown in the browser's zone, so in the US it reads 3/3/1990 (one day early).
  // src/app/(admin)/admin/employees/[id]/hire-import/[jobId]/review-form.tsx formatDisplay.
  // Proposed fix: format with { timeZone: "UTC" }.
  test.describe("date display", () => {
    test.use({ timezoneId: "America/Chicago" });
    test("a date of birth proposal shows the same day that will be saved", async ({ page }) => {
      const job = await readyJob("hp2");
      const e = await personRow("hp2");
      await page.goto(`/admin/employees/${e.id}/hire-import/${job.id}`);
      await expect(page.getByText("3/4/1990")).toBeVisible();
    });
  });

  test("apply: failure keeps the import ready; applying with nothing ticked is blocked", async ({ page }) => {
    const job = await readyJob("hp1");
    const e = await personRow("hp1");
    await db.employee.update({ where: { id: e.id }, data: { ssnLast4: null, dateOfBirth: null } });
    await page.goto(`/admin/employees/${e.id}/hire-import/${job.id}`);
    await expect(applyBtn(page)).toBeVisible();
    await failServerActions(page, "abort", { times: 1 });
    await applyBtn(page).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    expect((await db.hirePacketImport.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("READY");

    await page.goto(`/admin/employees/${e.id}/hire-import/${job.id}`);
    await expect(applyBtn(page)).toBeVisible();
    for (const cb of await page.getByRole("checkbox").all()) await cb.uncheck();
    await expect(page.getByRole("button", { name: /^apply 0 fields$/i })).toBeDisabled();
  });

  test("apply on a stale page: an import cancelled elsewhere is refused", async ({ page }) => {
    const job = await readyJob("hp1");
    const e = await personRow("hp1");
    await page.goto(`/admin/employees/${e.id}/hire-import/${job.id}`);
    await expect(applyBtn(page)).toBeVisible();
    await db.hirePacketImport.update({ where: { id: job.id }, data: { status: "CANCELLED" } });
    await applyBtn(page).click();
    await expect(toast(page, /not ready to apply/i)).toBeVisible();
  });

  test("cancel ends the import and goes back to the employee", async ({ page }) => {
    const job = await readyJob("hp2");
    const e = await personRow("hp2");
    await page.goto(`/admin/employees/${e.id}/hire-import/${job.id}`);
    await page.getByRole("button", { name: /cancel import/i }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/employees/${e.id}$`));
    expect((await db.hirePacketImport.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("CANCELLED");
  });

  test("a review link for another employee's import is not found", async ({ page }) => {
    const job = await readyJob("hp2");
    const other = await personRow("hp1");
    await page.goto(`/admin/employees/${other.id}/hire-import/${job.id}`);
    await expect(page.getByText(/not found|404/i).first()).toBeVisible();
  });

  test("a zip with nothing usable fails with the reason and can be retried", async ({ page }) => {
    const bad = new AdmZip();
    bad.addFile("readme.txt", Buffer.from("no pdf here"));
    await upload(page, "hp2", { name: "empty.zip", buffer: bad.toBuffer() });
    await expect(page.getByText(/import failed/i)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/no supported files/i)).toBeVisible();
    await page.getByRole("button", { name: /retry import/i }).click();
    await expect(page.getByText(/import failed/i)).toBeVisible({ timeout: 60_000 }); // still bad, fails again
  });

  test("a pdf that is not really a pdf is skipped; if all are skipped the import fails", async ({ page }) => {
    const z = new AdmZip();
    z.addFile("fake.pdf", Buffer.from("this is not a pdf"));
    await upload(page, "hp2", { name: "fake.zip", buffer: z.toBuffer() });
    await expect(page.getByText(/import failed/i)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/none of the files in the zip could be imported/i)).toBeVisible();
  });

  test("upload is refused for a wrong extension, a fake zip and an oversize zip", async ({ page }) => {
    const before = (await jobs("hp2")).length;
    const cases: Array<[{ name: string; buffer: Buffer }, RegExp]> = [
      [{ name: "packet.txt", buffer: Buffer.from("hello") }, /unsupported file type/i],
      [{ name: "fake.zip", buffer: Buffer.from("not a zip at all") }, /contents don.t match its type/i],
    ];
    for (const [file, msg] of cases) {
      await upload(page, "hp2", file);
      await expect(toast(page, msg)).toBeVisible();
    }
    const bigPath = join(tmpdir(), "pp-big.zip");
    writeFileSync(bigPath, Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(51 * 1024 * 1024)]));
    await upload(page, "hp2", bigPath);
    // The 60 MB proxy limit lets the 51 MB body through, so the server answers with the proper message.
    await expect(toast(page, /too large \(max 50 mb\)/i)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/something went wrong|unexpected end of form/i)).toHaveCount(0);
    expect((await jobs("hp2")).length).toBe(before);
  });

  test("upload: server failure shows the error screen and no job is left behind", async ({ page }) => {
    const before = (await jobs("hp2")).length;
    await page.goto(await personUrl("hp2"));
    if (await page.getByText("Page not found").count()) await page.reload();
    await page.getByRole("button", { name: /import hire packet/i }).click();
    const dialog = page.getByRole("dialog", { name: /import hire packet/i });
    await dialog.getByLabel(/zip file/i).setInputFiles({ name: "p.zip", mimeType: "application/zip", buffer: await goodZip() });
    await failServerActions(page, "abort", { times: 1 });
    await dialog.getByRole("button", { name: /upload & process/i }).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    expect((await jobs("hp2")).length).toBe(before);
  });
});
