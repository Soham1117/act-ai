import { test, expect, type Locator, type Page } from "@playwright/test";
import { db } from "./support/db";
import { delayServerActions, expectNoCrash, failServerActions, toast } from "./support/helpers";
import { SS, answerNextDialog, empDbId, labelled, loginState, pick } from "./support/self-service";
import { NETWORK_ERROR, SERVER_ERROR, STALE_ERROR } from "./support/action-errors";

// Requests, employee side. Dedicated employee: Quinn.
test.use({ storageState: "e2e/.auth/quinn.json" });

let quinnId: string;

test.beforeAll(async ({ browser }) => {
  await loginState(browser, SS.quinn, "quinn");
  quinnId = await empDbId(SS.quinn);
});

test.afterAll(async () => {
  await db.request.deleteMany({ where: { employeeId: quinnId } });
});

test.beforeEach(async () => {
  await db.request.deleteMany({ where: { employeeId: quinnId } });
});

const TYPES = [
  "DOCUMENT_REQUEST", "DETAILS_CHANGE", "PAYROLL_INQUIRY", "SCHEDULE_CHANGE", "ACCESS_REQUEST",
  "TRAINING_REQUEST", "EQUIPMENT_REQUEST", "LOCATION_CHANGE", "TEAM_REQUEST", "PROJECT_REQUEST",
  "BENEFITS_INQUIRY", "OTHER",
] as const;

async function openDialog(page: Page) {
  await page.goto("/dashboard/requests");
  await page.getByRole("button", { name: "New request" }).click();
  const dialog = page.getByRole("dialog", { name: "New request" });
  await expect(dialog).toBeVisible();
  return dialog;
}
const submit = (d: Locator) => d.getByRole("button", { name: /^submit$/i });
const count = () => db.request.count({ where: { employeeId: quinnId } });
const item = (page: Page, title: string) => page.getByRole("listitem").filter({ hasText: title });

async function fill(d: Locator, title = "Need a new badge", details = "My badge stopped working") {
  await labelled(d, "Subject").fill(title);
  await labelled(d, "Details").fill(details);
}

test.describe("requests: create", () => {
  for (const type of TYPES) {
    test(`creates a ${type} request: DB row, history, audit log and list`, async ({ page }) => {
      const dialog = await openDialog(page);
      await pick(page, dialog, "Type", type.replace(/_/g, " "));
      await fill(dialog, `Request ${type}`, `Details for ${type}`);
      await submit(dialog).click();
      await expect(toast(page, "Request submitted")).toBeVisible();
      await expect(dialog).toBeHidden();

      const r = await db.request.findFirstOrThrow({ where: { employeeId: quinnId }, include: { history: true } });
      expect(r.type).toBe(type);
      expect(r.status).toBe("PENDING");
      expect(r.title).toBe(`Request ${type}`);
      expect(r.description).toBe(`Details for ${type}`);
      expect(r.history.map((h) => [h.status, h.note])).toEqual([["PENDING", "Submitted by employee"]]);
      expect(await db.auditLog.count({ where: { action: "request.submit", resource: `Request:${r.id}` } })).toBe(1);

      const li = item(page, `Request ${type}`);
      await expect(li).toContainText("PENDING");
      await expect(li).toContainText(type.replace(/_/g, " "));
      await expect(page.getByText("My requests (1)")).toBeVisible();
    });
  }

  test("time off cannot be requested here: the form points to the Leave page and cannot be sent", async ({ page }) => {
    const dialog = await openDialog(page);
    await pick(page, dialog, "Type", "LEAVE REQUEST");
    await expect(dialog).toContainText("This form can't create a leave request.");
    await expect(dialog.getByRole("link", { name: "Leave page" })).toHaveAttribute("href", "/dashboard/leave");
    await fill(dialog);
    await expect(submit(dialog)).toBeDisabled();
    expect(await count()).toBe(0);
  });

  test("opens with Benefits inquiry preselected from the benefits page link", async ({ page }) => {
    await page.goto("/dashboard/requests?type=BENEFITS_INQUIRY");
    const dialog = page.getByRole("dialog", { name: "New request" });
    await expect(dialog).toBeVisible();
    await expect(labelled(dialog, "Type")).toContainText("BENEFITS INQUIRY");
  });
});

test.describe("requests: validation", () => {
  test("Submit stays disabled until both subject and details have at least 2 characters", async ({ page }) => {
    const dialog = await openDialog(page);
    await expect(submit(dialog)).toBeDisabled();
    await labelled(dialog, "Subject").fill("A");
    await labelled(dialog, "Details").fill("Some details");
    await expect(submit(dialog)).toBeDisabled();
    await labelled(dialog, "Subject").fill("AB");
    await expect(submit(dialog)).toBeEnabled();
    await labelled(dialog, "Details").fill("B");
    await expect(submit(dialog)).toBeDisabled();
    expect(await count()).toBe(0);
  });

  test("a subject of only spaces is refused by the server with the field name", async ({ page }) => {
    const dialog = await openDialog(page);
    await fill(dialog, "    ", "Real details");
    await submit(dialog).click();
    await expect(toast(page, /Check title/)).toBeVisible();
    expect(await count()).toBe(0);
  });

  test("details of only spaces are refused by the server", async ({ page }) => {
    const dialog = await openDialog(page);
    await fill(dialog, "Real subject", "     ");
    await submit(dialog).click();
    await expect(toast(page, /Check description/)).toBeVisible();
    expect(await count()).toBe(0);
  });

  test("details over 5000 characters are refused; subject is capped at 120 in the form", async ({ page }) => {
    const dialog = await openDialog(page);
    await expect(labelled(dialog, "Subject")).toHaveAttribute("maxlength", "120");
    await fill(dialog, "Long details", "x".repeat(5001));
    await submit(dialog).click();
    await expect(toast(page, /Check description/)).toBeVisible();
    expect(await count()).toBe(0);
    // Exactly 5000 is fine.
    await labelled(dialog, "Details").fill("y".repeat(5000));
    await submit(dialog).click();
    await expect(toast(page, "Request submitted")).toBeVisible();
    expect(await count()).toBe(1);
  });

  test("text with quotes, angle brackets and newlines is stored and shown as plain text", async ({ page }) => {
    const dialog = await openDialog(page);
    const nasty = `<img src=x onerror="window.__xss=1"> & "quotes" 'single'`;
    await fill(dialog, "Odd <b>subject</b>", `${nasty}\nsecond line`);
    await submit(dialog).click();
    await expect(toast(page, "Request submitted")).toBeVisible();
    const r = await db.request.findFirstOrThrow({ where: { employeeId: quinnId } });
    expect(r.title).toBe("Odd <b>subject</b>");
    expect(r.description).toBe(`${nasty}\nsecond line`);
    await expect(page.getByText("Odd <b>subject</b>")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  });
});

test.describe("requests: withdraw and view", () => {
  async function make(over: { title?: string; status?: "PENDING" | "PROCESSING" | "COMPLETED" | "REJECTED"; adminNotes?: string } = {}) {
    return db.request.create({
      data: {
        employeeId: quinnId,
        type: "EQUIPMENT_REQUEST",
        title: over.title ?? "Need a laptop",
        description: "Old one is broken",
        status: over.status ?? "PENDING",
        adminNotes: over.adminNotes,
        history: { create: [{ status: "PENDING", note: "Submitted by employee" }] },
      },
    });
  }

  test("withdraws a pending request: it is recorded as rejected with a history note", async ({ page }) => {
    const r = await make();
    await page.goto("/dashboard/requests");
    answerNextDialog(page);
    await item(page, "Need a laptop").getByRole("button", { name: "Withdraw" }).click();
    await expect(toast(page, "Request withdrawn")).toBeVisible();
    const after = await db.request.findUniqueOrThrow({ where: { id: r.id }, include: { history: { orderBy: { updatedAt: "asc" } } } });
    expect(after.status).toBe("REJECTED");
    expect(after.history.map((h) => [h.status, h.note])).toEqual([
      ["PENDING", "Submitted by employee"],
      ["REJECTED", "Withdrawn by employee"],
    ]);
    expect(await db.auditLog.count({ where: { action: "request.cancel", resource: `Request:${r.id}` } })).toBe(1);
    await expect(item(page, "Need a laptop")).toContainText("REJECTED");
    await expect(item(page, "Need a laptop").getByRole("button", { name: "Withdraw" })).toHaveCount(0);
  });

  test("answering No to the withdraw question keeps the request pending", async ({ page }) => {
    const r = await make();
    await page.goto("/dashboard/requests");
    answerNextDialog(page, false);
    await item(page, "Need a laptop").getByRole("button", { name: "Withdraw" }).click();
    expect((await db.request.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("PENDING");
  });

  test("only pending requests can be withdrawn (no button once an admin picked it up)", async ({ page }) => {
    await make({ title: "In progress", status: "PROCESSING" });
    await make({ title: "Done", status: "COMPLETED" });
    await page.goto("/dashboard/requests");
    await expect(item(page, "In progress")).toContainText("PROCESSING");
    await expect(page.getByRole("button", { name: "Withdraw" })).toHaveCount(0);
  });

  test("withdrawing something an admin just picked up is refused and nothing changes", async ({ page }) => {
    const r = await make();
    await page.goto("/dashboard/requests");
    await db.request.update({ where: { id: r.id }, data: { status: "PROCESSING" } });
    answerNextDialog(page);
    await item(page, "Need a laptop").getByRole("button", { name: "Withdraw" }).click();
    await expect(
      toast(page, "Only requests that haven't been picked up yet can be withdrawn. Contact an admin."),
    ).toBeVisible();
    expect((await db.request.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("PROCESSING");
  });

  test("withdrawing a request that no longer exists says so", async ({ page }) => {
    const r = await make();
    await page.goto("/dashboard/requests");
    await db.request.delete({ where: { id: r.id } });
    answerNextDialog(page);
    await item(page, "Need a laptop").getByRole("button", { name: "Withdraw" }).click();
    await expect(toast(page, "That request no longer exists. Refresh the page.")).toBeVisible();
  });

  test("shows the admin's note and the status history", async ({ page }) => {
    const r = await make({ status: "COMPLETED", adminNotes: "Pick it up from IT on Friday" });
    await db.requestStatusHistory.createMany({
      data: [
        { requestId: r.id, status: "PROCESSING", note: "Ordered", updatedAt: new Date(Date.now() + 1000) },
        { requestId: r.id, status: "COMPLETED", note: "Pick it up from IT on Friday", updatedAt: new Date(Date.now() + 2000) },
      ],
    });
    await page.goto("/dashboard/requests");
    const li = item(page, "Need a laptop");
    await expect(li).toContainText("Admin note: Pick it up from IT on Friday");
    await li.getByText("Status history (3)").click();
    await expect(li).toContainText("PROCESSING — Ordered");
    await expect(li).toContainText("COMPLETED — Pick it up from IT on Friday");
  });

  test("another employee's requests are not shown", async ({ page }) => {
    await make();
    await page.goto("/dashboard/requests");
    await expect(page.getByText("My requests (1)")).toBeVisible();
    await expect(page.getByText("Olive Secret Request")).toHaveCount(0);
  });
});

test.describe("requests: failures and double submits", () => {
  async function filled(page: Page) {
    const dialog = await openDialog(page);
    await fill(dialog, "Failure case");
    return dialog;
  }

  test("connection dropped while submitting: toast, dialog kept, nothing saved", async ({ page }) => {
    const dialog = await filled(page);
    await failServerActions(page, "abort");
    await submit(dialog).click();
    await expect(toast(page, NETWORK_ERROR)).toBeVisible();
    await expectNoCrash(page);
    expect(await count()).toBe(0);
  });

  test("server error (500) while submitting: error shown, nothing saved", async ({ page }) => {
    const dialog = await filled(page);
    await failServerActions(page, "500");
    await submit(dialog).click();
    await expect(toast(page, SERVER_ERROR)).toBeVisible();
    await expectNoCrash(page);
    expect(await count()).toBe(0);
  });

  test("page from an older deployment: no crash, nothing saved", async ({ page }) => {
    const dialog = await filled(page);
    await failServerActions(page, "stale");
    await submit(dialog).click();
    await expect(toast(page, STALE_ERROR)).toBeVisible();
    await expectNoCrash(page);
    expect(await count()).toBe(0);
  });

  test("double click on Submit creates one request", async ({ page }) => {
    const dialog = await filled(page);
    const slow = await delayServerActions(page, 1500);
    await submit(dialog).dblclick();
    await expect(toast(page, "Request submitted")).toBeVisible();
    expect(slow.count()).toBe(1);
    expect(await count()).toBe(1);
    expect(await db.requestStatusHistory.count({ where: { request: { employeeId: quinnId } } })).toBe(1);
  });

  test("server failure while withdrawing: error shown, request stays pending", async ({ page }) => {
    const r = await db.request.create({
      data: { employeeId: quinnId, type: "OTHER", title: "Keep me", description: "details" },
    });
    await page.goto("/dashboard/requests");
    await failServerActions(page, "abort");
    answerNextDialog(page);
    await item(page, "Keep me").getByRole("button", { name: "Withdraw" }).click();
    await expect(toast(page, NETWORK_ERROR)).toBeVisible();
    await expectNoCrash(page);
    expect((await db.request.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("PENDING");
  });
});
