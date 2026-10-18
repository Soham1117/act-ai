import { test, expect, type Locator, type Page } from "@playwright/test";
import { db } from "./support/db";
import { fakeS3Keys } from "./support/fake-s3";
import { delayServerActions, expectNoCrash, failServerActions, toast } from "./support/helpers";
import { ADMIN_STATE, BASE_URL } from "./support/test-data";
import {
  SS,
  SS_OLIVE_RECEIPT,
  empDbId,
  labelled,
  loginState,
  pdfFile,
  pick,
  pngFile,
  statValue,
  textFile,
  ymdFromToday,
} from "./support/self-service";
import { NETWORK_ERROR, SERVER_ERROR, STALE_ERROR } from "./support/action-errors";

// Reimbursements, employee side. Dedicated employee: Reed.
test.use({ storageState: "e2e/.auth/reed.json" });

let reedId: string;

test.beforeAll(async ({ browser }) => {
  await loginState(browser, SS.reed, "reed");
  reedId = await empDbId(SS.reed);
});

test.afterAll(async () => {
  await db.reimbursement.deleteMany({ where: { employeeId: reedId } });
});

test.beforeEach(async () => {
  await db.reimbursement.deleteMany({ where: { employeeId: reedId } });
});

async function openDialog(page: Page) {
  await page.goto("/dashboard/reimbursements");
  await page.getByRole("button", { name: "New claim" }).click();
  const dialog = page.getByRole("dialog", { name: "New reimbursement claim" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function fillClaim(
  dialog: Locator,
  v: { title?: string; amount?: string; description?: string; date?: string } = {},
) {
  await labelled(dialog, "Title").fill(v.title ?? "Hotel in Dallas");
  await labelled(dialog, "Amount").fill(v.amount ?? "45.50");
  await labelled(dialog, "Description").fill(v.description ?? "Two nights for the trade show");
  if (v.date) await labelled(dialog, "Expense date").fill(v.date);
}

const fileInput = (dialog: Locator) => dialog.locator('input[type="file"]');
const submit = (dialog: Locator) => dialog.getByRole("button", { name: /^submit$/i });
const claimCount = () => db.reimbursement.count({ where: { employeeId: reedId } });
const noValidate = (dialog: Locator) => dialog.locator("form").evaluate((f) => ((f as HTMLFormElement).noValidate = true));

test.describe("reimbursements: submit a claim", () => {
  test("submits a claim with a PDF receipt; the file lands in storage and can be downloaded back", async ({
    page,
  }) => {
    const dialog = await openDialog(page);
    await fillClaim(dialog);
    await pick(page, dialog, "Category", "MEALS");
    const receipt = pdfFile("hotel-receipt.pdf");
    await fileInput(dialog).setInputFiles(receipt);
    await expect(dialog.getByText("hotel-receipt.pdf")).toBeVisible();
    await submit(dialog).click();
    await expect(toast(page, "Claim submitted")).toBeVisible();
    await expect(dialog).toBeHidden();

    const claim = await db.reimbursement.findFirstOrThrow({
      where: { employeeId: reedId },
      include: { receipts: true, history: true },
    });
    expect(claim.status).toBe("PENDING");
    expect(Number(claim.amount)).toBe(45.5);
    expect(claim.category).toBe("MEALS");
    expect(claim.title).toBe("Hotel in Dallas");
    expect(claim.expenseDate.toISOString().slice(0, 10)).toBe(ymdFromToday(0));
    expect(claim.history.map((h) => [h.status, h.note])).toEqual([["PENDING", "Submitted"]]);
    expect(claim.receipts).toHaveLength(1);
    const r = claim.receipts[0]!;
    expect(r.originalName).toBe("hotel-receipt.pdf");
    expect(r.mimeType).toBe("application/pdf");
    expect(r.fileSize).toBe(receipt.buffer.length);
    expect((await fakeS3Keys()).some((k) => k.endsWith(r.fileName))).toBe(true);
    expect(await db.auditLog.count({ where: { action: "reimbursement.submit", resource: `Reimbursement:${claim.id}` } })).toBe(1);

    // List, stats, history.
    const item = page.getByRole("listitem").filter({ hasText: "Hotel in Dallas" });
    await expect(item).toContainText("$45.50");
    await expect(item).toContainText("PENDING");
    await expect(item).toContainText("MEALS");
    await expect(item.getByText("History (1)")).toBeVisible();
    await expect(statValue(page, "Total claims")).toHaveText("1");
    await expect(statValue(page, "Pending review")).toHaveText("$45.50");

    // The receipt comes back byte for byte, as a download and inline.
    const dl = await page.request.get(`/api/reimbursements/receipts/${r.id}/file?download=1`);
    expect(dl.status()).toBe(200);
    expect(dl.headers()["content-disposition"]).toMatch(/^attachment/);
    expect(dl.headers()["content-type"]).toContain("application/pdf");
    expect(Buffer.compare(await dl.body(), receipt.buffer)).toBe(0);
    const inline = await page.request.get(`/api/reimbursements/receipts/${r.id}/file`);
    expect(inline.headers()["content-disposition"]).toMatch(/^inline/);
    await expect(item.getByRole("link", { name: "View hotel-receipt.pdf" })).toHaveAttribute(
      "href",
      `/api/reimbursements/receipts/${r.id}/file`,
    );
  });

  test("a claim can have a PDF and a PNG receipt, and a receipt can be removed before sending", async ({ page }) => {
    const dialog = await openDialog(page);
    await fillClaim(dialog, { title: "Two receipts" });
    await fileInput(dialog).setInputFiles([pdfFile("a.pdf"), pngFile("b.png"), pngFile("c.png")]);
    await dialog.getByRole("button", { name: "Remove c.png" }).click();
    await expect(dialog.getByText("c.png")).toHaveCount(0);
    await submit(dialog).click();
    await expect(toast(page, "Claim submitted")).toBeVisible();
    const receipts = await db.reimbursementReceipt.findMany({
      where: { reimbursement: { employeeId: reedId } },
      orderBy: { originalName: "asc" },
    });
    expect(receipts.map((r) => [r.originalName, r.mimeType])).toEqual([
      ["a.pdf", "application/pdf"],
      ["b.png", "image/png"],
    ]);
  });

  test("a claim without any receipt is allowed and says so", async ({ page }) => {
    const dialog = await openDialog(page);
    await fillClaim(dialog, { title: "No receipt" });
    await submit(dialog).click();
    await expect(toast(page, "Claim submitted")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "No receipt" })).toContainText("No receipts attached");
  });

  test("the cents are kept exactly (1234.56)", async ({ page }) => {
    const dialog = await openDialog(page);
    await fillClaim(dialog, { amount: "1234.56" });
    await submit(dialog).click();
    await expect(toast(page, "Claim submitted")).toBeVisible();
    expect(Number((await db.reimbursement.findFirstOrThrow({ where: { employeeId: reedId } })).amount)).toBe(1234.56);
    await expect(page.getByRole("listitem").filter({ hasText: "Hotel in Dallas" })).toContainText("$1,234.56");
  });
});

test.describe("reimbursements: validation", () => {
  test("Submit stays disabled until title, amount and description are filled", async ({ page }) => {
    const dialog = await openDialog(page);
    await expect(submit(dialog)).toBeDisabled();
    await labelled(dialog, "Title").fill("Taxi");
    await expect(submit(dialog)).toBeDisabled();
    await labelled(dialog, "Amount").fill("20");
    await expect(submit(dialog)).toBeDisabled();
    await labelled(dialog, "Description").fill("Ride to airport");
    await expect(submit(dialog)).toBeEnabled();
    expect(await claimCount()).toBe(0);
  });

  test("a one-character title or description is refused by the server with the field name", async ({ page }) => {
    const dialog = await openDialog(page);
    await fillClaim(dialog, { title: "A" });
    await noValidate(dialog);
    await submit(dialog).click();
    await expect(toast(page, /Check title/)).toBeVisible();
    await fillClaim(dialog, { title: "Valid title", description: "B" });
    await submit(dialog).click();
    await expect(toast(page, /Check description/)).toBeVisible();
    expect(await claimCount()).toBe(0);
  });

  test("zero or negative amounts are refused with a message", async ({ page }) => {
    const dialog = await openDialog(page);
    await fillClaim(dialog, { amount: "0" });
    await noValidate(dialog);
    await submit(dialog).click();
    await expect(toast(page, "Enter an amount greater than $0.00.")).toBeVisible();
    await labelled(dialog, "Amount").fill("-5");
    await submit(dialog).click();
    await expect(toast(page, "Enter an amount greater than $0.00.").last()).toBeVisible();
    expect(await claimCount()).toBe(0);
  });

  test("an amount over the $50,000 limit is refused", async ({ page }) => {
    const dialog = await openDialog(page);
    await fillClaim(dialog, { amount: "50000.01" });
    await noValidate(dialog);
    await submit(dialog).click();
    await expect(toast(page, "Claims over $50,000 need to go through HR.")).toBeVisible();
    expect(await claimCount()).toBe(0);
  });

  test("more than two decimal places is refused by the server", async ({ page }) => {
    const dialog = await openDialog(page);
    await fillClaim(dialog, { amount: "12.345" });
    await noValidate(dialog); // the browser's step=0.01 check would stop it first
    await submit(dialog).click();
    await expect(toast(page, "Amounts can have at most two decimal places.")).toBeVisible();
    expect(await claimCount()).toBe(0);
  });

  test("an expense date in the future is refused", async ({ page }) => {
    const dialog = await openDialog(page);
    await fillClaim(dialog, { date: ymdFromToday(5) });
    await expect(labelled(dialog, "Expense date")).toHaveAttribute("max", ymdFromToday(0));
    await noValidate(dialog);
    await submit(dialog).click();
    await expect(toast(page, "The expense date can't be in the future.")).toBeVisible();
    expect(await claimCount()).toBe(0);
  });

  test("a bad expense date (cleared) never reaches a saved claim", async ({ page }) => {
    const dialog = await openDialog(page);
    await fillClaim(dialog);
    await labelled(dialog, "Expense date").fill("");
    await noValidate(dialog);
    await submit(dialog).click();
    await expect(toast(page, /Check expenseDate|valid expense date/i)).toBeVisible();
    expect(await claimCount()).toBe(0);
  });
});

test.describe("reimbursements: receipt uploads", () => {
  test("a .txt receipt is turned away in the form (PDF/PNG/JPG only)", async ({ page }) => {
    const dialog = await openDialog(page);
    await fileInput(dialog).setInputFiles(textFile("notes.txt", "not a receipt"));
    await expect(toast(page, "notes.txt: receipts must be PDF, PNG or JPG.")).toBeVisible();
    await expect(dialog.getByText("notes.txt")).toHaveCount(0);
  });

  test("a receipt over 8 MB is turned away in the form", async ({ page }) => {
    const dialog = await openDialog(page);
    const big = pdfFile("huge.pdf", "x".repeat(8 * 1024 * 1024 + 10));
    await fileInput(dialog).setInputFiles(big);
    await expect(toast(page, "huge.pdf is larger than 8 MB.")).toBeVisible();
    await expect(dialog.getByText("huge.pdf")).toHaveCount(0);
  });

  test("more than five receipts: the sixth is refused", async ({ page }) => {
    const dialog = await openDialog(page);
    const files = Array.from({ length: 6 }, (_, i) => pdfFile(`r${i + 1}.pdf`));
    await fileInput(dialog).setInputFiles(files);
    await expect(toast(page, "You can attach up to 5 receipts.")).toBeVisible();
    await expect(dialog.getByText("r5.pdf")).toBeVisible();
    await expect(dialog.getByText("r6.pdf")).toHaveCount(0);
    await expect(fileInput(dialog)).toBeDisabled();
  });

  test("a file whose contents do not match its .pdf name is refused by the server; no claim, no stored file", async ({
    page,
  }) => {
    const dialog = await openDialog(page);
    await fillClaim(dialog, { title: "Fake pdf" });
    const before = (await fakeS3Keys()).length;
    await fileInput(dialog).setInputFiles(textFile("fake.pdf", "just some text, not a PDF"));
    await submit(dialog).click();
    await expect(
      toast(page, "fake.pdf: The file contents don't match its type. Re-export it and try again."),
    ).toBeVisible();
    expect(await claimCount()).toBe(0);
    expect((await fakeS3Keys()).length).toBe(before);
  });

  test("an empty file is refused by the server", async ({ page }) => {
    const dialog = await openDialog(page);
    await fillClaim(dialog, { title: "Empty file" });
    await fileInput(dialog).setInputFiles({ name: "empty.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(0) });
    await submit(dialog).click();
    await expect(toast(page, "empty.pdf: The file is empty.")).toBeVisible();
    expect(await claimCount()).toBe(0);
  });

  test("a file at exactly the size limit is accepted (8 MB)", async ({ page }) => {
    const dialog = await openDialog(page);
    await fillClaim(dialog, { title: "Big but fine" });
    const buf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(8 * 1024 * 1024 - 9, 0x20)]);
    expect(buf.length).toBe(8 * 1024 * 1024);
    await fileInput(dialog).setInputFiles({ name: "limit.pdf", mimeType: "application/pdf", buffer: buf });
    await submit(dialog).click();
    await expect(toast(page, "Claim submitted")).toBeVisible({ timeout: 30_000 });
    expect((await db.reimbursementReceipt.findFirstOrThrow({ where: { reimbursement: { employeeId: reedId } } })).fileSize).toBe(
      8 * 1024 * 1024,
    );
  });
});

test.describe("reimbursements: what the employee sees", () => {
  test("shows status history, reviewer notes and the paid amount of decided claims", async ({ page }) => {
    const rejected = await db.reimbursement.create({
      data: {
        employeeId: reedId,
        title: "Rejected claim",
        category: "OTHER",
        amount: 30,
        description: "x",
        expenseDate: new Date(),
        status: "REJECTED",
        reviewNotes: "Missing receipt",
        history: {
          create: [
            { status: "PENDING", note: "Submitted" },
            { status: "REJECTED", note: "Missing receipt" },
          ],
        },
      },
    });
    await db.reimbursement.create({
      data: {
        employeeId: reedId,
        title: "Part paid claim",
        category: "FUEL",
        amount: 100,
        paidAmount: 80,
        paidDate: new Date(),
        description: "x",
        expenseDate: new Date(),
        status: "PAID",
        reviewNotes: "Fuel cap applied",
        history: { create: [{ status: "PENDING" }, { status: "APPROVED" }, { status: "PAID", note: "Fuel cap applied" }] },
      },
    });
    await page.goto("/dashboard/reimbursements");
    const rej = page.getByRole("listitem").filter({ hasText: "Rejected claim" });
    await expect(rej).toContainText("Rejection reason: Missing receipt");
    await rej.getByText("History (2)").click();
    await expect(rej).toContainText("PENDING — Submitted");
    await expect(rej).toContainText("REJECTED — Missing receipt");
    const paid = page.getByRole("listitem").filter({ hasText: "Part paid claim" });
    await expect(paid).toContainText("$100.00");
    await expect(paid).toContainText("paid $80.00");
    await expect(statValue(page, /^Paid \d{4}$/)).toHaveText("$80.00");
    expect(rejected.id).toBeTruthy();
  });

  test("lists 25 claims per page and pages through the rest", async ({ page }) => {
    await db.reimbursement.createMany({
      data: Array.from({ length: 27 }, (_, i) => ({
        employeeId: reedId,
        title: `Bulk claim ${String(i + 1).padStart(2, "0")}`,
        category: "OTHER" as const,
        amount: 1,
        description: "bulk",
        expenseDate: new Date(),
        createdAt: new Date(Date.now() - i * 1000), // 01 is newest
      })),
    });
    await page.goto("/dashboard/reimbursements");
    await expect(page.getByText("Page 1 of 2").filter({ visible: true })).toBeVisible();
    await expect(page.getByText("Bulk claim 01")).toBeVisible();
    await expect(page.getByText("Bulk claim 26")).toHaveCount(0);
    await page.getByRole("link", { name: "Next" }).click();
    await expect(page.getByText("Page 2 of 2").filter({ visible: true })).toBeVisible();
    await expect(page.getByText("Bulk claim 26")).toBeVisible();
    await expect(page.getByText("Bulk claim 27")).toBeVisible();
    await expect(page.getByText("Bulk claim 01")).toHaveCount(0);
    await page.getByRole("link", { name: "Previous" }).click();
    await expect(page.getByText("Page 1 of 2").filter({ visible: true })).toBeVisible();
  });

  test("an employee cannot see another employee's claims or open their receipts", async ({ page, browser }) => {
    await db.reimbursement.create({
      data: { employeeId: reedId, title: "Reed's own claim", category: "OTHER", amount: 5, description: "mine", expenseDate: new Date() },
    });
    await page.goto("/dashboard/reimbursements");
    await expect(page.getByText("Reed's own claim")).toBeVisible();
    await expect(page.getByText("Olive Secret Claim")).toHaveCount(0);
    await expect(statValue(page, "Total claims")).toHaveText("1");

    const receipt = await db.reimbursementReceipt.findFirstOrThrow({ where: { originalName: SS_OLIVE_RECEIPT } });
    const url = `/api/reimbursements/receipts/${receipt.id}/file`;
    expect((await page.request.get(url)).status()).toBe(403); // signed in, but not hers
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    // Not signed in: sent to the login page (or 401), never the file.
    expect([302, 303, 307, 308, 401]).toContain((await anon.request.get(`${BASE_URL}${url}`, { maxRedirects: 0 })).status());
    await anon.close();
    const admin = await browser.newContext({ storageState: ADMIN_STATE });
    // An admin may open it (the object itself is not in the fake store, so: not found, but not forbidden).
    expect((await admin.request.get(`${BASE_URL}${url}`)).status()).toBe(404);
    await admin.close();
    expect((await page.request.get(`/api/reimbursements/receipts/does-not-exist/file`)).status()).toBe(404);
  });
});

test.describe("reimbursements: failures and double submits", () => {
  async function filled(page: Page) {
    const dialog = await openDialog(page);
    await fillClaim(dialog, { title: "Failure case" });
    await fileInput(dialog).setInputFiles(pdfFile("f.pdf"));
    return dialog;
  }

  test("connection dropped while submitting: toast, dialog kept, no claim, no stored file", async ({ page }) => {
    const dialog = await filled(page);
    const before = (await fakeS3Keys()).length;
    await failServerActions(page, "abort");
    await submit(dialog).click();
    await expect(toast(page, NETWORK_ERROR)).toBeVisible();
    await expectNoCrash(page);
    expect(await claimCount()).toBe(0);
    expect((await fakeS3Keys()).length).toBe(before);
  });

  test("server error (500) while submitting: error shown, no claim saved", async ({ page }) => {
    const dialog = await filled(page);
    await failServerActions(page, "500");
    await submit(dialog).click();
    await expect(toast(page, SERVER_ERROR)).toBeVisible();
    await expectNoCrash(page);
    expect(await claimCount()).toBe(0);
  });

  test("page from an older deployment (stale action): no crash, no claim saved", async ({ page }) => {
    const dialog = await filled(page);
    await failServerActions(page, "stale");
    await submit(dialog).click();
    await expect(toast(page, STALE_ERROR)).toBeVisible();
    await expectNoCrash(page);
    expect(await claimCount()).toBe(0);
  });

  test("double click on Submit creates one claim with one receipt", async ({ page }) => {
    const dialog = await filled(page);
    const slow = await delayServerActions(page, 1500);
    await submit(dialog).dblclick();
    await expect(toast(page, "Claim submitted")).toBeVisible();
    expect(slow.count()).toBe(1);
    expect(await claimCount()).toBe(1);
    expect(await db.reimbursementReceipt.count({ where: { reimbursement: { employeeId: reedId } } })).toBe(1);
  });

  test("pressing Enter twice in the form creates one claim", async ({ page }) => {
    const dialog = await openDialog(page);
    await fillClaim(dialog, { title: "Enter twice" });
    const slow = await delayServerActions(page, 1500);
    await labelled(dialog, "Title").press("Enter");
    await labelled(dialog, "Title").press("Enter");
    await expect(toast(page, "Claim submitted")).toBeVisible();
    expect(slow.count()).toBe(1);
    expect(await claimCount()).toBe(1);
  });
});
