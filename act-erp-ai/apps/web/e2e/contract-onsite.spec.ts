import { test, expect, type Page } from "@playwright/test";
import { db } from "./support/db";
import { delayServerActions, expectNoCrash, failServerActions, toast } from "./support/helpers";
import { ADMIN_STATE } from "./support/test-data";
import {
  auditCount,
  captureActions,
  entriesOf,
  makeAgency,
  makeOpenEntry,
  makeWorker,
  replay,
  uniq,
} from "./support/contract";

test.use({ storageState: ADMIN_STATE });

const ON_SITE_URL = "/admin/contract-workers?tab=on-site";
const item = (page: Page, name: string) => page.getByRole("listitem").filter({ hasText: name });

async function openOnSite(page: Page) {
  await page.goto(ON_SITE_URL);
  await expect(page.getByRole("tab", { name: /^on site \(/i })).toBeVisible();
}
const clockOutBtn = (page: Page, name: string) => item(page, name).getByRole("button", { name: /^clock out$/i });
const confirmBtn = (page: Page) => page.getByRole("dialog").getByRole("button", { name: /^clock out$/i });

test.describe("admin: on site tab", () => {
  test("lists clocked-in workers with agency, project and start time", async ({ page }) => {
    const agency = await makeAgency();
    const w = await makeWorker({ agencyId: agency.id, project: "Plant 2 shutdown" });
    await makeOpenEntry(w.id, 1);
    await openOnSite(page);
    const li = item(page, w.name);
    await expect(li).toBeVisible();
    await expect(li).toContainText(w.workerId);
    await expect(li).toContainText(agency.name);
    await expect(li).toContainText("Plant 2 shutdown");
    await expect(li).toContainText(/in at \d{1,2}:\d{2} (AM|PM)/);
    await expect(li).toContainText("Working");
    await expect(li.getByRole("link", { name: w.name })).toHaveAttribute("href", `/admin/contract-workers/${w.id}`);
  });

  test("a stale open shift (over 16 hours) is shown flagged, with a Clock out button, but is not counted as working", async ({ page }) => {
    const w = await makeWorker();
    const open = await makeOpenEntry(w.id, 20);
    await openOnSite(page);
    const li = item(page, w.name);
    await expect(li).toBeVisible();
    await expect(li).toContainText("Open more than 16 hours");
    await expect(li).not.toContainText("Working");
    // The workers tab still shows the worker as off site.
    await page.goto(`/admin/contract-workers?tab=workers&q=${encodeURIComponent(w.name)}`);
    await expect(page.getByRole("row").filter({ hasText: w.name })).toContainText(/off site/i);
    // Closing it from On site caps it at 16 hours and keeps the auto-close note.
    await openOnSite(page);
    await clockOutBtn(page, w.name).click();
    await confirmBtn(page).click();
    await expect(toast(page, /clocked out/i)).toBeVisible();
    const closed = await db.contractTimeEntry.findUniqueOrThrow({ where: { id: open.id } });
    expect(closed).toMatchObject({ status: "COMPLETED", autoClosed: true, totalWorkMin: 16 * 60 });
    await expect(item(page, w.name)).toHaveCount(0);
  });

  test("an empty on-site list says nobody is clocked in", async ({ page }) => {
    // Park every open shift for a moment so the page is empty, then put them back.
    const open = await db.contractTimeEntry.findMany({ where: { status: { in: ["ACTIVE", "ON_BREAK"] } } });
    await db.contractTimeEntry.updateMany({
      where: { id: { in: open.map((e) => e.id) } },
      data: { status: "COMPLETED" },
    });
    try {
      await openOnSite(page);
      await expect(page.getByText(/nobody is clocked in right now/i)).toBeVisible();
      await expect(page.getByRole("tab", { name: /^on site \(0\)/i })).toBeVisible();
    } finally {
      for (const e of open)
        await db.contractTimeEntry.update({ where: { id: e.id }, data: { status: e.status } });
    }
  });

  test("admin clocks a worker out: entry closes, goes to approval, audited", async ({ page }) => {
    const w = await makeWorker();
    const open = await makeOpenEntry(w.id, 3);
    await openOnSite(page);
    await clockOutBtn(page, w.name).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: new RegExp(`clock out ${w.name}\\?`, "i") })).toBeVisible();
    await confirmBtn(page).click();
    await expect(toast(page, new RegExp(`${w.name} clocked out\\. the entry needs approval`, "i"))).toBeVisible();
    const [saved] = await entriesOf(w.id);
    expect(saved).toMatchObject({
      id: open.id,
      status: "COMPLETED",
      approvalStatus: "PENDING",
      editReason: "Clocked out by an admin.",
      autoClosed: false,
    });
    expect(saved!.clockOut).not.toBeNull();
    expect(saved!.totalWorkMin).toBeGreaterThanOrEqual(179);
    expect(saved!.totalWorkMin).toBeLessThanOrEqual(185);
    expect(saved!.lastEditedById).not.toBeNull();
    expect(await auditCount("contract.time.force_clock_out", open.id)).toBe(1);
    await expect(item(page, w.name)).toHaveCount(0);
  });

  test("cancelling the clock-out dialog leaves the worker on site", async ({ page }) => {
    const w = await makeWorker();
    const open = await makeOpenEntry(w.id, 1);
    await openOnSite(page);
    await clockOutBtn(page, w.name).click();
    await page.getByRole("dialog").getByRole("button", { name: /cancel/i }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    expect((await db.contractTimeEntry.findUniqueOrThrow({ where: { id: open.id } })).status).toBe("ACTIVE");
  });

  test("clocking out someone who already left says so", async ({ page }) => {
    const w = await makeWorker();
    const open = await makeOpenEntry(w.id, 1);
    await openOnSite(page);
    await clockOutBtn(page, w.name).click();
    await db.contractTimeEntry.update({
      where: { id: open.id },
      data: { status: "COMPLETED", clockOut: new Date() },
    });
    await confirmBtn(page).click();
    await expect(toast(page, /that worker is not clocked in\. refresh the page/i)).toBeVisible();
  });

  test("a worker who is on a break record is also clocked out (legacy ON_BREAK status)", async ({ page }) => {
    const w = await makeWorker();
    const open = await makeOpenEntry(w.id, 2);
    await db.contractTimeEntry.update({ where: { id: open.id }, data: { status: "ON_BREAK" } });
    await db.contractTimeBreak.create({
      data: { timeEntryId: open.id, startTime: new Date(Date.now() - 20 * 60_000) },
    });
    await openOnSite(page);
    await expect(item(page, w.name)).toContainText("On break");
    await clockOutBtn(page, w.name).click();
    await confirmBtn(page).click();
    await expect(toast(page, /clocked out/i)).toBeVisible();
    const saved = await db.contractTimeEntry.findUniqueOrThrow({
      where: { id: open.id },
      include: { breaks: true },
    });
    expect(saved.status).toBe("COMPLETED");
    expect(saved.breaks[0]!.endTime).not.toBeNull(); // the open break was closed with the shift
  });

  test("server failure while clocking out changes nothing", async ({ page }) => {
    const w = await makeWorker();
    const open = await makeOpenEntry(w.id, 1);
    await openOnSite(page);
    await clockOutBtn(page, w.name).click();
    await failServerActions(page, "abort");
    await confirmBtn(page).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect((await db.contractTimeEntry.findUniqueOrThrow({ where: { id: open.id } })).status).toBe("ACTIVE");
  });

  test("a stale page (old deployment) fails cleanly", async ({ page }) => {
    const w = await makeWorker();
    const open = await makeOpenEntry(w.id, 1);
    await openOnSite(page);
    await clockOutBtn(page, w.name).click();
    await failServerActions(page, "stale");
    await confirmBtn(page).click();
    await expect(page.getByText(/something went wrong|refresh|reload/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect((await db.contractTimeEntry.findUniqueOrThrow({ where: { id: open.id } })).status).toBe("ACTIVE");
  });

  test("double-clicking the confirm button clocks out once", async ({ page }) => {
    const w = await makeWorker();
    const open = await makeOpenEntry(w.id, 1);
    await openOnSite(page);
    await clockOutBtn(page, w.name).click();
    const slow = await delayServerActions(page, 1500);
    await confirmBtn(page).click();
    await confirmBtn(page).click({ force: true, timeout: 1000 }).catch(() => undefined);
    await expect(toast(page, /clocked out/i)).toBeVisible();
    expect(slow.count()).toBe(1);
    expect(await auditCount("contract.time.force_clock_out", open.id)).toBe(1);
  });

  test("two clock-out requests at the same instant close the shift once", async ({ page }) => {
    const w = await makeWorker();
    const open = await makeOpenEntry(w.id, 1);
    // Capture the real request but stop it from reaching the server, then replay it twice at once.
    const seen = await captureActions(page, { block: true });
    await openOnSite(page);
    await clockOutBtn(page, w.name).click();
    await confirmBtn(page).click();
    await expect.poll(() => seen.length).toBeGreaterThan(0);
    const call = seen.find((c) => c.body.includes(w.id))!;
    const out = await Promise.all([replay(page.context(), call), replay(page.context(), call)]);
    expect(out.filter((o) => /not clocked in/i.test(o))).toHaveLength(1);
    expect(await auditCount("contract.time.force_clock_out", open.id)).toBe(1);
    expect((await db.contractTimeEntry.findUniqueOrThrow({ where: { id: open.id } })).status).toBe("COMPLETED");
  });

  test("a clock-out for a shift that ran past 16 hours is capped and flagged for review", async ({ page }) => {
    // Re-aim a real request at the stale worker (same action the On site button sends).
    // Capture a real request for another worker and re-aim it at the stale one.
    const live = await makeWorker();
    await makeOpenEntry(live.id, 1);
    const stale = await makeWorker();
    const staleEntry = await makeOpenEntry(stale.id, 20);
    const seen = await captureActions(page);
    await openOnSite(page);
    await clockOutBtn(page, live.name).click();
    await confirmBtn(page).click();
    await expect(toast(page, /clocked out/i)).toBeVisible();
    const call = seen.find((c) => c.body.includes(live.id))!;
    const out = await replay(page.context(), call, call.body.replace(live.id, stale.id));
    expect(out).not.toMatch(/something went wrong/i);
    const closed = await db.contractTimeEntry.findUniqueOrThrow({ where: { id: staleEntry.id } });
    expect(closed).toMatchObject({ status: "COMPLETED", autoClosed: true, approvalStatus: "PENDING", totalWorkMin: 16 * 60 });
    expect(closed.clockOut!.getTime() - closed.clockIn.getTime()).toBe(16 * 3_600_000);
    // The admin clock-out keeps the auto-close note and adds its own reason after it.
    expect(closed.editReason).toContain("Auto-closed: shift ran longer than 16 hours");
    expect(closed.editReason).toContain("Clocked out by an admin.");
    expect(await db.auditLog.count({ where: { action: "contract.time.auto_close", resource: `ContractTimeEntry:${staleEntry.id}` } })).toBe(0); // admin clock-out audits as force_clock_out
    expect(await auditCount("contract.time.force_clock_out", staleEntry.id)).toBe(1);
  });

  test("the On site count in the tab and the summary card follows reality", async ({ page }) => {
    const before = await db.contractTimeEntry.count({ where: { status: { in: ["ACTIVE", "ON_BREAK"] } } });
    const w = await makeWorker({ name: uniq("Counted") });
    await makeOpenEntry(w.id, 1);
    await openOnSite(page);
    await expect(page.getByRole("tab", { name: new RegExp(`^on site \\(${before + 1}\\)`, "i") })).toBeVisible();
  });
});
