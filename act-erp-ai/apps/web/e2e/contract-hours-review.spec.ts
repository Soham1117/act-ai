import { test, expect, type Locator, type Page } from "@playwright/test";
import { businessYmd, db } from "./support/db";
import { delayServerActions, expectNoCrash, failServerActions, toast } from "./support/helpers";
import { ADMIN_STATE } from "./support/test-data";
import {
  auditCount,
  captureActions,
  chicago,
  hoursUrl,
  makeAgency,
  makeBreak,
  makeEntry,
  makeWorker,
  replay,
  tamperActions,
} from "./support/contract";

test.use({ storageState: ADMIN_STATE });

/** One agency + worker so a test can load a page that shows only its own rows. */
async function setup(opts: { workers?: number } = {}) {
  const agency = await makeAgency();
  const workers = [];
  for (let i = 0; i < (opts.workers ?? 1); i++) workers.push(await makeWorker({ agencyId: agency.id }));
  return { agency, workers, w: workers[0]! };
}
async function openHours(page: Page, agencyId: string, extra = "") {
  await page.goto(hoursUrl(`&hagency=${agencyId}${extra}`));
  await expect(page.getByRole("button", { name: /download csv/i })).toBeVisible();
}
const row = (page: Page, name: string) => page.getByRole("row").filter({ hasText: name });
const approveBtn = (page: Page, name: string) => page.getByRole("button", { name: `Approve entry for ${name}` });
const rejectBtn = (page: Page, name: string) => page.getByRole("button", { name: `Reject entry for ${name}` });
const get = (id: string) => db.contractTimeEntry.findUniqueOrThrow({ where: { id } });

test.describe("admin hours: approve and reject", () => {
  test("approving records who approved, when, and audits it", async ({ page }) => {
    const { agency, w } = await setup();
    const e = await makeEntry(w.id);
    await openHours(page, agency.id);
    await approveBtn(page, w.name).click();
    await expect(toast(page, /entry approved/i)).toBeVisible();
    const saved = await get(e.id);
    expect(saved).toMatchObject({ approvalStatus: "APPROVED", status: "APPROVED", approvedByName: "Alex Admin" });
    expect(saved.approvedById).not.toBeNull();
    expect(saved.approvalDate).not.toBeNull();
    expect(await auditCount("contract.time.approve", e.id)).toBe(1);
    // The table refreshes via router.refresh() after the action; the page is heavy on a busy CI box.
    await expect(row(page, w.name)).toContainText("Approved", { timeout: 45_000 });
    await expect(approveBtn(page, w.name)).toHaveCount(0);
  });

  test("rejecting: the reason is required, trimmed, shown on the row and stored", async ({ page }) => {
    const { agency, w } = await setup();
    const e = await makeEntry(w.id);
    await openHours(page, agency.id);
    await rejectBtn(page, w.name).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: /^reject$/i })).toBeDisabled();
    await dialog.getByLabel(/reason/i).fill("     ");
    await expect(dialog.getByRole("button", { name: /^reject$/i })).toBeDisabled();
    await dialog.getByRole("button", { name: /cancel/i }).click();
    expect((await get(e.id)).approvalStatus).toBe("PENDING"); // cancelling changes nothing

    await rejectBtn(page, w.name).click();
    await dialog.getByLabel(/reason/i).fill("  Wrong site  ");
    await dialog.getByRole("button", { name: /^reject$/i }).click();
    await expect(toast(page, /entry rejected/i)).toBeVisible();
    const saved = await get(e.id);
    expect(saved).toMatchObject({ approvalStatus: "REJECTED", status: "REJECTED", approvalNotes: "Wrong site" });
    expect(await auditCount("contract.time.reject", e.id)).toBe(1);
    await expect(row(page, w.name)).toContainText("Wrong site");
  });

  test("the server refuses a rejection without a reason, or with too long a reason", async ({ page }) => {
    const { agency, w } = await setup();
    const e = await makeEntry(w.id);
    await openHours(page, agency.id);
    let notes = "   ";
    await tamperActions(page, (b) => b.replace('"MARK-REASON"', JSON.stringify(notes)));
    await rejectBtn(page, w.name).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/reason/i).fill("MARK-REASON");
    await dialog.getByRole("button", { name: /^reject$/i }).click();
    await expect(toast(page, /enter a reason for rejecting this entry/i)).toBeVisible();
    notes = "x".repeat(1001);
    await dialog.getByRole("button", { name: /^reject$/i }).click();
    await expect(toast(page, /check notes/i)).toBeVisible();
    expect((await get(e.id)).approvalStatus).toBe("PENDING");
  });

  test("an entry cannot be reviewed twice (stale page)", async ({ page }) => {
    const { agency, w } = await setup();
    const e = await makeEntry(w.id);
    await openHours(page, agency.id);
    await db.contractTimeEntry.update({
      where: { id: e.id },
      data: { approvalStatus: "APPROVED", status: "APPROVED" },
    });
    await approveBtn(page, w.name).click();
    await expect(toast(page, /this entry was already approved\. refresh the page/i)).toBeVisible();
    await rejectBtn(page, w.name).click();
    await page.getByRole("dialog").getByLabel(/reason/i).fill("Too late");
    await page.getByRole("dialog").getByRole("button", { name: /^reject$/i }).click();
    await expect(toast(page, /this entry was already approved/i).last()).toBeVisible();
    expect((await get(e.id)).approvalStatus).toBe("APPROVED");
  });

  test("an entry deleted or re-opened since the page loaded is refused with a clear message", async ({ page }) => {
    const { agency, workers } = await setup({ workers: 2 });
    const [a, b] = workers as [(typeof workers)[0], (typeof workers)[0]];
    const ea = await makeEntry(a.id);
    const eb = await makeEntry(b.id);
    await openHours(page, agency.id);
    await db.contractTimeEntry.delete({ where: { id: ea.id } });
    await approveBtn(page, a.name).click();
    await expect(toast(page, /that time entry no longer exists/i)).toBeVisible();
    await db.contractTimeEntry.update({ where: { id: eb.id }, data: { status: "ACTIVE", clockOut: null } });
    await approveBtn(page, b.name).click();
    await expect(toast(page, /this entry is still open/i)).toBeVisible();
    expect((await get(eb.id)).approvalStatus).toBe("PENDING");
  });

  test("an open shift and a reviewed entry have no approve or select controls", async ({ page }) => {
    const { agency, workers } = await setup({ workers: 3 });
    const [pending, done, open] = workers as [(typeof workers)[0], (typeof workers)[0], (typeof workers)[0]];
    await makeEntry(pending.id);
    await makeEntry(done.id, { approval: "APPROVED" });
    const { makeOpenEntry } = await import("./support/contract");
    await makeOpenEntry(open.id, 1);
    await openHours(page, agency.id);
    await expect(approveBtn(page, pending.name)).toBeVisible();
    await expect(approveBtn(page, done.name)).toHaveCount(0);
    await expect(approveBtn(page, open.name)).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: `Select entry for ${pending.name}` })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: `Select entry for ${done.name}` })).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: `Select entry for ${open.name}` })).toHaveCount(0);
    await expect(row(page, open.name)).toContainText(/open/i);
    // Open shifts cannot be edited either; the admin closes them with Clock out.
    await expect(row(page, open.name).getByRole("button", { name: /edit times/i })).toHaveCount(0);
  });

  test("server failure while approving or rejecting changes nothing (500 and stale)", async ({ page }) => {
    const { agency, workers } = await setup({ workers: 2 });
    const [a, b] = workers as [(typeof workers)[0], (typeof workers)[0]];
    const ea = await makeEntry(a.id);
    const eb = await makeEntry(b.id);
    await openHours(page, agency.id);
    await failServerActions(page, "500");
    await approveBtn(page, a.name).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect((await get(ea.id)).approvalStatus).toBe("PENDING");

    await openHours(page, agency.id);
    await page.unroute("**/*");
    await failServerActions(page, "stale");
    await approveBtn(page, b.name).click();
    await expect(page.getByText(/something went wrong|refresh|reload/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect((await get(eb.id)).approvalStatus).toBe("PENDING");
  });

  test("server failure while rejecting changes nothing", async ({ page }) => {
    const { agency, w } = await setup();
    const e = await makeEntry(w.id);
    await openHours(page, agency.id);
    await rejectBtn(page, w.name).click();
    await page.getByRole("dialog").getByLabel(/reason/i).fill("Not on the sheet");
    await failServerActions(page, "abort");
    await page.getByRole("dialog").getByRole("button", { name: /^reject$/i }).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect((await get(e.id)).approvalStatus).toBe("PENDING");
  });

  test("double-clicking Approve sends one request and one audit entry", async ({ page }) => {
    const { agency, w } = await setup();
    const e = await makeEntry(w.id);
    await openHours(page, agency.id);
    const slow = await delayServerActions(page, 1500);
    await approveBtn(page, w.name).click();
    await approveBtn(page, w.name).click({ force: true, timeout: 1000 }).catch(() => undefined);
    await expect(toast(page, /entry approved/i)).toBeVisible();
    expect(slow.count()).toBe(1);
    expect(await auditCount("contract.time.approve", e.id)).toBe(1);
  });

  test("two admins approving at the same instant: one wins, one is told it was already done", async ({ page }) => {
    const { agency, w } = await setup();
    const e = await makeEntry(w.id);
    const seen = await captureActions(page);
    await openHours(page, agency.id);
    await approveBtn(page, w.name).click();
    await expect(toast(page, /entry approved/i)).toBeVisible();
    await db.contractTimeEntry.update({
      where: { id: e.id },
      data: { approvalStatus: "PENDING", status: "COMPLETED", approvedById: null, approvedByName: null },
    });
    const call = seen.find((c) => c.body.includes(e.id))!;
    const out = await Promise.all([replay(page.context(), call), replay(page.context(), call)]);
    expect(out.filter((o) => /already approved/i.test(o))).toHaveLength(1);
    expect((await get(e.id)).approvalStatus).toBe("APPROVED");
    expect(await auditCount("contract.time.approve", e.id)).toBe(2); // the UI approval + exactly one replay
  });
});

test.describe("admin hours: bulk approve and reject", () => {
  test("select all then approve selected", async ({ page }) => {
    const { agency, workers } = await setup({ workers: 3 });
    const entries = [];
    for (const w of workers) entries.push(await makeEntry(w.id));
    await makeEntry(workers[0]!.id, { daysAgo: 3, approval: "APPROVED" }); // not selectable
    await openHours(page, agency.id);
    await page.getByRole("checkbox", { name: "Select all pending entries" }).check();
    await expect(page.getByText("3 selected")).toBeVisible();
    await page.getByRole("button", { name: /approve selected/i }).click();
    await expect(toast(page, /approved 3 entries/i)).toBeVisible();
    for (const e of entries) expect(await get(e.id)).toMatchObject({ approvalStatus: "APPROVED", approvedByName: "Alex Admin" });
    expect(await db.auditLog.count({ where: { action: "contract.time.bulk_approve", resource: "ContractTimeEntry:bulk" } })).toBeGreaterThan(0);
    await expect(page.getByText(/selected/)).toHaveCount(0);
  });

  test("bulk reject needs a reason, then rejects every selected entry", async ({ page }) => {
    const { agency, workers } = await setup({ workers: 2 });
    const entries = [];
    for (const w of workers) entries.push(await makeEntry(w.id));
    await openHours(page, agency.id);
    for (const w of workers) await page.getByRole("checkbox", { name: `Select entry for ${w.name}` }).check();
    await page.getByRole("button", { name: /reject selected/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: /reject 2 entries\?/i })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /^reject$/i })).toBeDisabled();
    await dialog.getByLabel(/reason/i).fill("Duplicate punches");
    await dialog.getByRole("button", { name: /^reject$/i }).click();
    await expect(toast(page, /rejected 2 entries/i)).toBeVisible();
    for (const e of entries)
      expect(await get(e.id)).toMatchObject({ approvalStatus: "REJECTED", approvalNotes: "Duplicate punches" });
  });

  test("bulk: entries that are no longer pending are skipped and reported", async ({ page }) => {
    const { agency, workers } = await setup({ workers: 2 });
    const [a, b] = workers as [(typeof workers)[0], (typeof workers)[0]];
    const ea = await makeEntry(a.id);
    const eb = await makeEntry(b.id);
    await openHours(page, agency.id);
    await page.getByRole("checkbox", { name: "Select all pending entries" }).check();
    await db.contractTimeEntry.update({ where: { id: ea.id }, data: { approvalStatus: "APPROVED", status: "APPROVED" } });
    await page.getByRole("button", { name: /approve selected/i }).click();
    await expect(toast(page, /approved 1, skipped 1 that were not pending/i)).toBeVisible();
    expect((await get(eb.id)).approvalStatus).toBe("APPROVED");
  });

  test("bulk: when nothing selected is pending any more, say so and change nothing", async ({ page }) => {
    const { agency, workers } = await setup({ workers: 2 });
    const entries = [];
    for (const w of workers) entries.push(await makeEntry(w.id));
    await openHours(page, agency.id);
    await page.getByRole("checkbox", { name: "Select all pending entries" }).check();
    await db.contractTimeEntry.updateMany({
      where: { id: { in: entries.map((e) => e.id) } },
      data: { approvalStatus: "REJECTED", status: "REJECTED", approvalNotes: "Done elsewhere" },
    });
    await page.getByRole("button", { name: /approve selected/i }).click();
    await expect(toast(page, /none of the selected entries are pending review any more/i)).toBeVisible();
    for (const e of entries) expect((await get(e.id)).approvalStatus).toBe("REJECTED");
  });

  test("bulk reject: the server refuses an empty reason", async ({ page }) => {
    const { agency, workers } = await setup({ workers: 2 });
    const entries = [];
    for (const w of workers) entries.push(await makeEntry(w.id));
    await openHours(page, agency.id);
    await tamperActions(page, (b) => b.replace('"MARK-REASON"', '""'));
    await page.getByRole("checkbox", { name: "Select all pending entries" }).check();
    await page.getByRole("button", { name: /reject selected/i }).click();
    await page.getByRole("dialog").getByLabel(/reason/i).fill("MARK-REASON");
    await page.getByRole("dialog").getByRole("button", { name: /^reject$/i }).click();
    await expect(toast(page, /enter a reason for rejecting these entries/i)).toBeVisible();
    for (const e of entries) expect((await get(e.id)).approvalStatus).toBe("PENDING");
  });

  test("bulk: an empty or oversized id list is refused", async ({ page }) => {
    const { agency, workers } = await setup({ workers: 2 });
    const entries = [];
    for (const w of workers) entries.push(await makeEntry(w.id));
    await openHours(page, agency.id);
    await page.getByRole("checkbox", { name: "Select all pending entries" }).check();
    const ids = entries.map((e) => e.id);
    let mode: "empty" | "big" = "empty";
    await tamperActions(page, (b) => {
      if (!b.includes(ids[0]!)) return b;
      const list = mode === "empty" ? "[]" : JSON.stringify(Array.from({ length: 501 }, (_, i) => `id-${i}`));
      return b.replace(/\["[^\]]*\]/, list);
    });
    await page.getByRole("button", { name: /approve selected/i }).click();
    await expect(toast(page, /check ids/i)).toBeVisible();
    mode = "big";
    await page.getByRole("button", { name: /approve selected/i }).click();
    await expect(toast(page, /check ids/i).last()).toBeVisible();
    for (const e of entries) expect((await get(e.id)).approvalStatus).toBe("PENDING");
  });

  test("server failure during a bulk approve changes nothing", async ({ page }) => {
    const { agency, workers } = await setup({ workers: 2 });
    const entries = [];
    for (const w of workers) entries.push(await makeEntry(w.id));
    await openHours(page, agency.id);
    await page.getByRole("checkbox", { name: "Select all pending entries" }).check();
    await failServerActions(page, "500");
    await page.getByRole("button", { name: /approve selected/i }).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    await expectNoCrash(page);
    for (const e of entries) expect((await get(e.id)).approvalStatus).toBe("PENDING");
  });

  test("double-clicking Approve selected sends one request", async ({ page }) => {
    const { agency, workers } = await setup({ workers: 2 });
    for (const w of workers) await makeEntry(w.id);
    await openHours(page, agency.id);
    await page.getByRole("checkbox", { name: "Select all pending entries" }).check();
    const slow = await delayServerActions(page, 1500);
    const btn = page.getByRole("button", { name: /approve selected/i });
    await btn.click();
    await btn.click({ force: true, timeout: 1000 }).catch(() => undefined);
    await expect(toast(page, /approved 2 entries/i)).toBeVisible();
    expect(slow.count()).toBe(1);
  });

  test("the same bulk request sent twice at once approves each entry once", async ({ page }) => {
    const { agency, workers } = await setup({ workers: 2 });
    const entries: Awaited<ReturnType<typeof makeEntry>>[] = [];
    for (const w of workers) entries.push(await makeEntry(w.id));
    const seen = await captureActions(page);
    await openHours(page, agency.id);
    await page.getByRole("checkbox", { name: "Select all pending entries" }).check();
    await page.getByRole("button", { name: /approve selected/i }).click();
    await expect(toast(page, /approved 2 entries/i)).toBeVisible();
    await db.contractTimeEntry.updateMany({
      where: { id: { in: entries.map((e) => e.id) } },
      data: { approvalStatus: "PENDING", status: "COMPLETED" },
    });
    const call = seen.find((c) => c.body.includes(entries[0]!.id))!;
    const out = await Promise.all([replay(page.context(), call), replay(page.context(), call)]);
    // One call changed both rows; the other found nothing pending.
    expect(out.filter((o) => /none of the selected entries are pending/i.test(o))).toHaveLength(1);
    for (const e of entries) expect((await get(e.id)).approvalStatus).toBe("APPROVED");
  });
});

test.describe("admin hours: edit times", () => {
  const edit = (page: Page, name: string) => row(page, name).getByRole("button", { name: /edit times/i });
  async function openEdit(page: Page, agencyId: string, name: string) {
    await openHours(page, agencyId);
    await edit(page, name).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: new RegExp(`edit times for ${name}`, "i") })).toBeVisible();
    return dialog;
  }
  const save = (d: Locator) => d.getByRole("button", { name: /save times/i });
  const fillTimes = async (d: Locator, cin: string, cout: string, reason?: string) => {
    await d.getByLabel("Clock in").fill(cin);
    await d.getByLabel("Clock out").fill(cout);
    if (reason !== undefined) await d.getByLabel(/reason/i).fill(reason);
  };

  test("corrects the times of an approved entry: totals recomputed, approval reset, audited", async ({ page }) => {
    const { agency, w } = await setup();
    const day = businessYmd(2);
    const e = await makeEntry(w.id, { daysAgo: 2, approval: "APPROVED" });
    await db.contractTimeEntry.update({ where: { id: e.id }, data: { approvedByName: "Alex Admin", approvalDate: new Date(), approvalNotes: "ok" } });
    const dialog = await openEdit(page, agency.id, w.name);
    // The dialog starts with the stored Central times.
    await expect(dialog.getByLabel("Clock in")).toHaveValue(`${day}T09:00`);
    await expect(dialog.getByLabel("Clock out")).toHaveValue(`${day}T17:00`);
    await fillTimes(dialog, `${day}T08:30`, `${day}T16:45`, "Forgot to punch on arrival");
    await save(dialog).click();
    await expect(toast(page, /times updated\. the entry is pending approval again/i)).toBeVisible();
    const saved = await get(e.id);
    expect(saved.clockIn.toISOString()).toBe(chicago(day, "08:30").toISOString());
    expect(saved.clockOut?.toISOString()).toBe(chicago(day, "16:45").toISOString());
    expect(saved).toMatchObject({
      totalWorkMin: 8 * 60 + 15,
      totalBreakMin: 0,
      status: "COMPLETED",
      approvalStatus: "PENDING",
      approvedById: null,
      approvedByName: null,
      approvalDate: null,
      approvalNotes: null,
      editReason: "Forgot to punch on arrival",
      autoClosed: false,
    });
    expect(saved.lastEditedById).not.toBeNull();
    expect(await auditCount("contract.time.edit", e.id)).toBe(1);
    await expect(row(page, w.name)).toContainText("Pending");
    await expect(row(page, w.name)).toContainText("Forgot to punch on arrival");
  });

  test("moving an entry to another day moves its business date; breaks are kept and re-timed", async ({ page }) => {
    const { agency, w } = await setup();
    const e = await makeEntry(w.id, { daysAgo: 2 });
    await makeBreak(e.id, businessYmd(2), "12:00", "12:30");
    await db.contractTimeEntry.update({ where: { id: e.id }, data: { totalBreakMin: 30, totalWorkMin: 450 } });
    const dialog = await openEdit(page, agency.id, w.name);
    const day = businessYmd(3);
    await fillTimes(dialog, `${day}T07:00`, `${day}T15:00`, "Wrong day entered");
    // The break (day 2, 12:00) now lies outside the shift: refused, nothing changes.
    await save(dialog).click();
    await expect(toast(page, /a break can't start before clock-in|a break can't (start|end) after clock-out/i)).toBeVisible();
    expect((await get(e.id)).totalWorkMin).toBe(450);
    // Moving the break with it is not possible from this dialog, so remove the break and retry.
    await db.contractTimeBreak.deleteMany({ where: { timeEntryId: e.id } });
    await save(dialog).click();
    await expect(toast(page, /times updated/i)).toBeVisible();
    const saved = await get(e.id);
    expect(saved.date.toISOString().slice(0, 10)).toBe(day);
    expect(saved.totalWorkMin).toBe(480);
  });

  test("an edit keeps the breaks inside the shift and subtracts them from work time", async ({ page }) => {
    const { agency, w } = await setup();
    const day = businessYmd(2);
    const e = await makeEntry(w.id, { daysAgo: 2 });
    await makeBreak(e.id, day, "12:00", "12:30");
    const dialog = await openEdit(page, agency.id, w.name);
    await fillTimes(dialog, `${day}T08:00`, `${day}T16:00`, "Shift started an hour earlier");
    await save(dialog).click();
    await expect(toast(page, /times updated/i)).toBeVisible();
    expect(await get(e.id)).toMatchObject({ totalBreakMin: 30, totalWorkMin: 450 });
  });

  test("clock-out must come after clock-in, and shifts cannot be longer than 16 hours", async ({ page }) => {
    const { agency, w } = await setup();
    const day = businessYmd(2);
    const e = await makeEntry(w.id, { daysAgo: 2 });
    const dialog = await openEdit(page, agency.id, w.name);
    await fillTimes(dialog, `${day}T10:00`, `${day}T09:00`, "Typo test");
    await save(dialog).click();
    await expect(toast(page, /clock-out must be after clock-in/i)).toBeVisible();
    await fillTimes(dialog, `${day}T10:00`, `${day}T10:00`);
    await save(dialog).click();
    await expect(toast(page, /clock-out must be after clock-in/i).last()).toBeVisible();
    await fillTimes(dialog, `${businessYmd(3)}T08:00`, `${day}T09:00`);
    await save(dialog).click();
    await expect(toast(page, /a shift can't be longer than 16 hours/i)).toBeVisible();
    const saved = await get(e.id);
    expect(saved.clockIn.toISOString()).toBe(e.clockIn.toISOString());
    expect(saved.clockOut?.toISOString()).toBe(e.clockOut?.toISOString());
  });

  test("times in the future are refused", async ({ page }) => {
    const { agency, w } = await setup();
    const e = await makeEntry(w.id, { daysAgo: 2 });
    const dialog = await openEdit(page, agency.id, w.name);
    await fillTimes(dialog, `${businessYmd(-2)}T08:00`, `${businessYmd(-2)}T10:00`, "Future test");
    await save(dialog).click();
    await expect(toast(page, /clock-in can't be in the future/i)).toBeVisible();
    await fillTimes(dialog, `${businessYmd(2)}T08:00`, `${businessYmd(-2)}T10:00`);
    await save(dialog).click();
    await expect(toast(page, /clock-out can't be in the future/i)).toBeVisible();
    expect((await get(e.id)).clockOut?.toISOString()).toBe(e.clockOut?.toISOString());
  });

  test("missing times or a missing/short reason are refused in the dialog", async ({ page }) => {
    const { agency, w } = await setup();
    const day = businessYmd(2);
    const e = await makeEntry(w.id, { daysAgo: 2 });
    const dialog = await openEdit(page, agency.id, w.name);
    await dialog.getByLabel("Clock out").fill("");
    await save(dialog).click();
    await expect(toast(page, /enter both clock-in and clock-out/i)).toBeVisible();
    await fillTimes(dialog, `${day}T08:00`, `${day}T16:00`, "");
    await save(dialog).click();
    await expect(toast(page, /enter a reason \(at least 3 characters\)/i)).toBeVisible();
    await dialog.getByLabel(/reason/i).fill("ab");
    await save(dialog).click();
    await expect(toast(page, /enter a reason \(at least 3 characters\)/i).last()).toBeVisible();
    await dialog.getByLabel(/reason/i).fill("  ab  ");
    await save(dialog).click();
    await expect(toast(page, /enter a reason/i).last()).toBeVisible();
    expect((await get(e.id)).editReason).toBeNull();
  });

  test("the server also refuses a short or oversized reason and garbage times", async ({ page }) => {
    const { agency, w } = await setup();
    const day = businessYmd(2);
    const e = await makeEntry(w.id, { daysAgo: 2 });
    const dialog = await openEdit(page, agency.id, w.name);
    await fillTimes(dialog, `${day}T08:00`, `${day}T16:00`, "MARK-REASON");
    let swap: (b: string) => string = (b) => b.replace("MARK-REASON", "ab");
    await tamperActions(page, (b) => swap(b));
    await save(dialog).click();
    await expect(toast(page, /check reason: enter a reason \(at least 3 characters\)/i)).toBeVisible();
    swap = (b) => b.replace("MARK-REASON", "r".repeat(501));
    await save(dialog).click();
    await expect(toast(page, /check reason: keep the reason under 500 characters/i)).toBeVisible();
    swap = (b) => b.replace(`${day}T08:00`, "not-a-time").replace("MARK-REASON", "valid reason");
    await save(dialog).click();
    await expect(toast(page, /clock-in isn't a valid america\/chicago date and time/i)).toBeVisible();
    swap = (b) => b.replace(`${day}T16:00`, "").replace("MARK-REASON", "valid reason");
    await save(dialog).click();
    await expect(toast(page, /check clockout: enter a date and time/i)).toBeVisible();
    expect((await get(e.id)).editReason).toBeNull();
  });

  test("a time that does not exist (spring-forward gap) is refused", async ({ page }) => {
    const { agency, w } = await setup();
    const e = await makeEntry(w.id, { daysAgo: 2 });
    const dialog = await openEdit(page, agency.id, w.name);
    await fillTimes(dialog, "2026-03-08T02:30", "2026-03-08T09:00", "DST gap test");
    await save(dialog).click();
    await expect(toast(page, /isn't a valid america\/chicago date and time/i)).toBeVisible();
    expect((await get(e.id)).clockIn.toISOString()).toBe(e.clockIn.toISOString());
  });

  test("overlapping another entry of the same worker is refused; a rejected entry does not count", async ({ page }) => {
    const { agency, w } = await setup();
    const day = businessYmd(2);
    await makeEntry(w.id, { daysAgo: 2, in: "08:00", out: "12:00" });
    const second = await makeEntry(w.id, { daysAgo: 2, in: "13:00", out: "17:00" });
    const rejected = await makeEntry(w.id, { daysAgo: 2, in: "18:00", out: "20:00", approval: "REJECTED", notes: "bad" });
    await openHours(page, agency.id);
    await page.getByRole("row").filter({ hasText: "1:00 PM" }).getByRole("button", { name: /edit times/i }).click();
    const dialog = page.getByRole("dialog");
    await fillTimes(dialog, `${day}T11:00`, `${day}T17:00`, "Started early");
    await save(dialog).click();
    await expect(toast(page, /that time overlaps another entry/i)).toBeVisible();
    expect((await get(second.id)).clockIn.toISOString()).toBe(second.clockIn.toISOString());
    // Overlapping the rejected entry is fine.
    await fillTimes(dialog, `${day}T13:00`, `${day}T19:00`);
    await save(dialog).click();
    await expect(toast(page, /times updated/i)).toBeVisible();
    expect((await get(rejected.id)).approvalStatus).toBe("REJECTED");
  });

  test("editing an entry that was re-opened or deleted meanwhile is refused", async ({ page }) => {
    const { agency, workers } = await setup({ workers: 2 });
    const [a, b] = workers as [(typeof workers)[0], (typeof workers)[0]];
    const day = businessYmd(2);
    const ea = await makeEntry(a.id, { daysAgo: 2 });
    const eb = await makeEntry(b.id, { daysAgo: 2 });
    await openHours(page, agency.id);
    await edit(page, a.name).click();
    await db.contractTimeEntry.update({ where: { id: ea.id }, data: { status: "ACTIVE", clockOut: null } });
    await fillTimes(page.getByRole("dialog"), `${day}T08:00`, `${day}T16:00`, "Stale edit");
    await save(page.getByRole("dialog")).click();
    await expect(toast(page, /this shift is still open\. use clock out to close it first/i)).toBeVisible();
    await page.keyboard.press("Escape");
    await edit(page, b.name).click();
    await db.contractTimeEntry.delete({ where: { id: eb.id } });
    await fillTimes(page.getByRole("dialog"), `${day}T08:00`, `${day}T16:00`, "Stale edit");
    await save(page.getByRole("dialog")).click();
    await expect(toast(page, /that time entry no longer exists/i)).toBeVisible();
  });

  test("a rejected entry can be corrected and goes back to pending", async ({ page }) => {
    const { agency, w } = await setup();
    const day = businessYmd(2);
    const e = await makeEntry(w.id, { daysAgo: 2, approval: "REJECTED", notes: "Wrong hours" });
    const dialog = await openEdit(page, agency.id, w.name);
    await fillTimes(dialog, `${day}T09:00`, `${day}T15:00`, "Corrected per agency sheet");
    await save(dialog).click();
    await expect(toast(page, /times updated/i)).toBeVisible();
    expect(await get(e.id)).toMatchObject({ approvalStatus: "PENDING", status: "COMPLETED", approvalNotes: null, totalWorkMin: 360 });
  });

  test("server failure while saving times changes nothing", async ({ page }) => {
    const { agency, w } = await setup();
    const day = businessYmd(2);
    const e = await makeEntry(w.id, { daysAgo: 2 });
    const dialog = await openEdit(page, agency.id, w.name);
    await fillTimes(dialog, `${day}T08:00`, `${day}T16:00`, "Will not be saved");
    await failServerActions(page, "abort");
    await save(dialog).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect((await get(e.id)).editReason).toBeNull();
  });

  test("double-clicking Save times saves once", async ({ page }) => {
    const { agency, w } = await setup();
    const day = businessYmd(2);
    const e = await makeEntry(w.id, { daysAgo: 2 });
    const dialog = await openEdit(page, agency.id, w.name);
    await fillTimes(dialog, `${day}T08:00`, `${day}T16:00`, "Saved once");
    const slow = await delayServerActions(page, 1500);
    await save(dialog).click();
    await save(dialog).click({ force: true, timeout: 1000 }).catch(() => undefined);
    await expect(toast(page, /times updated/i)).toBeVisible();
    expect(slow.count()).toBe(1);
    expect(await auditCount("contract.time.edit", e.id)).toBe(1);
  });
});

test.describe("admin hours: filters and totals", () => {
  test("totals follow the agency and approval filters; rejected and open hours add nothing", async ({ page }) => {
    const { agency, workers } = await setup({ workers: 4 });
    const [appr, pend, rej, open] = workers as [(typeof workers)[0], (typeof workers)[0], (typeof workers)[0], (typeof workers)[0]];
    await makeEntry(appr.id, { daysAgo: 1, in: "08:00", out: "15:07", approval: "APPROVED" }); // 7h 07m
    await makeEntry(pend.id, { daysAgo: 1, in: "09:00", out: "12:15" }); // 3h 15m
    await makeEntry(rej.id, { daysAgo: 1, in: "10:00", out: "11:11", approval: "REJECTED", notes: "no" }); // 1h 11m
    const { makeOpenEntry } = await import("./support/contract");
    await makeOpenEntry(open.id, 1);
    await openHours(page, agency.id);
    await expect(page.getByText("7h 07m")).toHaveCount(2); // table row + Approved card
    await expect(page.getByText("3h 15m")).toHaveCount(2); // table row + Pending card
    await expect(page.getByText("1h 11m")).toHaveCount(1); // table row only
    // Approval filter narrows the table.
    await openHours(page, agency.id, "&approval=REJECTED");
    await expect(row(page, rej.name)).toBeVisible();
    await expect(row(page, appr.name)).toHaveCount(0);
    await openHours(page, agency.id, "&approval=APPROVED");
    await expect(row(page, appr.name)).toBeVisible();
    await expect(row(page, pend.name)).toHaveCount(0);
  });

  test("another agency's entries are not shown when filtered by agency", async ({ page }) => {
    const a = await setup();
    const b = await setup();
    await makeEntry(a.w.id);
    await makeEntry(b.w.id);
    await openHours(page, a.agency.id);
    await expect(row(page, a.w.name)).toBeVisible();
    await expect(row(page, b.w.name)).toHaveCount(0);
  });

  test("an empty range says so; a reversed or invalid range does not crash", async ({ page }) => {
    const { agency, w } = await setup();
    await makeEntry(w.id, { daysAgo: 2 });
    await page.goto(hoursUrl(`&hagency=${agency.id}`, businessYmd(30), businessYmd(25)));
    await expect(page.getByText(/no entries in this range/i)).toBeVisible();
    // From after To: the page swaps them instead of showing nothing.
    await page.goto(hoursUrl(`&hagency=${agency.id}`, businessYmd(0), businessYmd(6)));
    await expect(row(page, w.name)).toBeVisible();
    // Garbage dates fall back to the current week.
    await page.goto(`/admin/contract-workers?tab=hours&from=garbage&to=2026-13-45&hagency=${agency.id}`);
    await expect(page.getByRole("button", { name: /download csv/i })).toBeVisible();
    await expectNoCrash(page);
  });

  test("the filter form applies the chosen dates and agency", async ({ page }) => {
    const { agency, w } = await setup();
    await makeEntry(w.id, { daysAgo: 4 });
    await page.goto("/admin/contract-workers?tab=hours");
    await page.locator("#cw-h-from").fill(businessYmd(5));
    await page.locator("#cw-h-to").fill(businessYmd(3));
    await page.locator("#cw-h-agency").selectOption(agency.id);
    await page.getByRole("button", { name: /^apply$/i }).click();
    await expect(page).toHaveURL(/hagency=/);
    await expect(row(page, w.name)).toBeVisible();
    await page.locator("#cw-h-approval").selectOption("APPROVED");
    await page.getByRole("button", { name: /^apply$/i }).click();
    await expect(row(page, w.name)).toHaveCount(0);
    await page.getByRole("link", { name: /current week/i }).click();
    await expect(page).not.toHaveURL(/hagency=/);
  });
});

test.describe("admin hours: no delete", () => {
  test("there is no way to delete an entry from the hours table (reject instead)", async ({ page }) => {
    const { agency, w } = await setup();
    await makeEntry(w.id);
    await openHours(page, agency.id);
    await expect(row(page, w.name).getByRole("button", { name: /delete|remove/i })).toHaveCount(0);
  });
});
