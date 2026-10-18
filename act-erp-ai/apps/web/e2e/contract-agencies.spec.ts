import { test, expect, type Page } from "@playwright/test";
import { db } from "./support/db";
import { delayServerActions, expectNoCrash, failServerActions, toast } from "./support/helpers";
import { ADMIN_STATE } from "./support/test-data";
import { CW_AGENCY } from "./support/contract-data";
import {
  auditCount,
  captureActions,
  makeAgency,
  makeWorker,
  openCrewKiosk,
  pickKioskWorker,
  replay,
  tamperActions,
  uniq,
} from "./support/contract";
import { NETWORK_ERROR, SERVER_ERROR, STALE_ERROR } from "./support/action-errors";

test.use({ storageState: ADMIN_STATE });

const AGENCIES_URL = "/admin/contract-workers?tab=agencies";

const agencyCount = () => db.staffingAgency.count();
const byName = (name: string) => db.staffingAgency.findFirst({ where: { name } });
const row = (page: Page, name: string) => page.getByRole("row").filter({ hasText: name });

async function openAgencies(page: Page) {
  await page.goto(AGENCIES_URL);
  await expect(page.getByRole("button", { name: /^add agency$/i }).first()).toBeVisible();
}

async function openAddDialog(page: Page) {
  await page.getByRole("button", { name: /^add agency$/i }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: /add agency/i })).toBeVisible();
  return dialog;
}

test.describe("admin: agencies - create", () => {
  test("creates an agency with all fields and writes an audit entry", async ({ page }) => {
    const name = `  ${uniq("CW New Agency")}  `; // surrounding spaces are trimmed
    await openAgencies(page);
    const dialog = await openAddDialog(page);
    await dialog.getByLabel("Name", { exact: true }).fill(name);
    await dialog.getByLabel("Contact name").fill("Pat Contact");
    await dialog.getByLabel("Phone").fill("555-0100");
    await dialog.getByLabel("Email").fill("pat@agency.test");
    await dialog.getByLabel("Notes").fill("Net 30");
    await dialog.getByRole("button", { name: /^add agency$/i }).click();
    await expect(toast(page, /agency added/i)).toBeVisible();

    const saved = await byName(name.trim());
    expect(saved).toMatchObject({
      contactName: "Pat Contact",
      phone: "555-0100",
      email: "pat@agency.test",
      notes: "Net 30",
      isActive: true,
    });
    expect(await auditCount("contract.agency.create", saved!.id)).toBe(1);
    await expect(row(page, name.trim())).toBeVisible();
    // Optional fields left empty are stored as null, not "".
    const dialog2 = await openAddDialog(page);
    const bare = uniq("CW Bare Agency");
    await dialog2.getByLabel("Name", { exact: true }).fill(bare);
    await dialog2.getByRole("button", { name: /^add agency$/i }).click();
    await expect.poll(() => byName(bare)).not.toBeNull();
    expect(await byName(bare)).toMatchObject({ contactName: null, phone: null, email: null, notes: null });
  });

  test("an empty or blank name is refused and nothing is saved", async ({ page }) => {
    await openAgencies(page);
    const before = await agencyCount();
    const dialog = await openAddDialog(page);
    await dialog.getByRole("button", { name: /^add agency$/i }).click();
    await expect(toast(page, /enter the agency name/i)).toBeVisible();
    await dialog.getByLabel("Name", { exact: true }).fill("    ");
    await dialog.getByRole("button", { name: /^add agency$/i }).click();
    await expect(toast(page, /enter the agency name/i)).toBeVisible();
    await expect(dialog).toBeVisible(); // stays open so nothing typed is lost
    expect(await agencyCount()).toBe(before);
  });

  test("a duplicate name is refused with a clear message", async ({ page }) => {
    await openAgencies(page);
    const before = await agencyCount();
    const dialog = await openAddDialog(page);
    await dialog.getByLabel("Name", { exact: true }).fill(CW_AGENCY.existing);
    await dialog.getByRole("button", { name: /^add agency$/i }).click();
    await expect(toast(page, /an agency with that name already exists/i)).toBeVisible();
    await expect(dialog).toBeVisible();
    expect(await agencyCount()).toBe(before);
  });

  test("an invalid email is refused", async ({ page }) => {
    await openAgencies(page);
    const before = await agencyCount();
    const dialog = await openAddDialog(page);
    await dialog.getByLabel("Name", { exact: true }).fill(uniq("CW Bad Email"));
    // type=email is not enforced by the browser here (the button is not a form submit).
    await dialog.getByLabel("Email").fill("not-an-email");
    await dialog.getByRole("button", { name: /^add agency$/i }).click();
    await expect(toast(page, /enter a valid email/i)).toBeVisible();
    expect(await agencyCount()).toBe(before);
  });

  test("over-long text is refused on the server", async ({ page }) => {
    // The inputs stop typing at the limit, so craft the request: swap a marker for too-long text.
    await openAgencies(page);
    const before = await agencyCount();
    const dialog = await openAddDialog(page);
    const long = (n: number) => "x".repeat(n);
    const cases: [string, number, RegExp][] = [
      ["MARK-NAME", 121, /check name/i],
      ["MARK-CONTACT", 121, /keep this under 120 characters/i],
      ["MARK-PHONE", 41, /keep this under 40 characters/i],
      ["MARK-NOTES", 2001, /keep this under 2000 characters/i],
    ];
    let current = cases[0]!;
    await tamperActions(page, (b) => b.replace(current[0], long(current[1])));
    for (const c of cases) {
      current = c;
      await dialog.getByLabel("Name", { exact: true }).fill(c[0] === "MARK-NAME" ? c[0] : uniq("CW Long Fields"));
      await dialog.getByLabel("Contact name").fill(c[0] === "MARK-CONTACT" ? c[0] : "");
      await dialog.getByLabel("Phone").fill(c[0] === "MARK-PHONE" ? c[0] : "");
      await dialog.getByLabel("Notes").fill(c[0] === "MARK-NOTES" ? c[0] : "");
      await dialog.getByRole("button", { name: /^add agency$/i }).click();
      await expect(toast(page, c[2])).toBeVisible();
    }
    expect(await agencyCount()).toBe(before);
  });

  test("server failure while creating shows an error and saves nothing", async ({ page }) => {
    await openAgencies(page);
    const before = await agencyCount();
    const dialog = await openAddDialog(page);
    await dialog.getByLabel("Name", { exact: true }).fill(uniq("CW Fail Create"));
    await failServerActions(page, "abort");
    await dialog.getByRole("button", { name: /^add agency$/i }).click();
    await expect(toast(page, NETWORK_ERROR)).toBeVisible();
    // The dialog stays open (nothing was lost).
    await expect(dialog).toBeVisible();
    await expectNoCrash(page);
    expect(await agencyCount()).toBe(before);
  });

  test("server 500 while creating shows an error and saves nothing", async ({ page }) => {
    await openAgencies(page);
    const before = await agencyCount();
    const dialog = await openAddDialog(page);
    await dialog.getByLabel("Name", { exact: true }).fill(uniq("CW 500 Create"));
    await failServerActions(page, "500");
    await dialog.getByRole("button", { name: /^add agency$/i }).click();
    await expect(toast(page, SERVER_ERROR)).toBeVisible();
    // The dialog stays open (nothing was lost).
    await expect(dialog).toBeVisible();
    await expectNoCrash(page);
    expect(await agencyCount()).toBe(before);
  });

  test("a stale page (old deployment) fails cleanly and saves nothing", async ({ page }) => {
    await openAgencies(page);
    const before = await agencyCount();
    const dialog = await openAddDialog(page);
    await dialog.getByLabel("Name", { exact: true }).fill(uniq("CW Stale Create"));
    await failServerActions(page, "stale");
    await dialog.getByRole("button", { name: /^add agency$/i }).click();
    await expect(toast(page, STALE_ERROR)).toBeVisible();
    // The dialog stays open (nothing was lost).
    await expect(dialog).toBeVisible();
    await expectNoCrash(page);
    expect(await agencyCount()).toBe(before);
  });

  test("double-clicking Add agency creates one agency", async ({ page }) => {
    await openAgencies(page);
    const name = uniq("CW Double Click");
    const dialog = await openAddDialog(page);
    await dialog.getByLabel("Name", { exact: true }).fill(name);
    const slow = await delayServerActions(page, 1500);
    const save = dialog.getByRole("button", { name: /^add agency$/i });
    await save.click();
    await save.click({ force: true, timeout: 1000 }).catch(() => undefined);
    await expect(toast(page, /agency added/i)).toBeVisible();
    expect(slow.count()).toBe(1);
    expect(await db.staffingAgency.count({ where: { name } })).toBe(1);
  });

  test("two identical create requests at the same time save one agency", async ({ page }) => {
    await openAgencies(page);
    const name = uniq("CW Race");
    const seen = await captureActions(page);
    const dialog = await openAddDialog(page);
    await dialog.getByLabel("Name", { exact: true }).fill(name);
    await dialog.getByRole("button", { name: /^add agency$/i }).click();
    await expect(toast(page, /agency added/i)).toBeVisible();
    const create = seen.find((c) => c.body.includes(name));
    expect(create).toBeTruthy();
    const second = await replay(page.context(), create!);
    expect(second).toMatch(/already exists/i);
    expect(await db.staffingAgency.count({ where: { name } })).toBe(1);
  });
});

test.describe("admin: agencies - edit", () => {
  test("edits an agency; changes are saved and audited", async ({ page }) => {
    const ag = await makeAgency();
    await openAgencies(page);
    await row(page, ag.name).getByRole("button", { name: /^edit$/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(ag.name);
    const renamed = uniq("CW Renamed");
    await dialog.getByLabel("Name", { exact: true }).fill(renamed);
    await dialog.getByLabel("Contact name").fill("New Contact");
    await dialog.getByRole("button", { name: /save changes/i }).click();
    await expect(toast(page, /agency updated/i)).toBeVisible();
    expect(await db.staffingAgency.findUniqueOrThrow({ where: { id: ag.id } })).toMatchObject({
      name: renamed,
      contactName: "New Contact",
    });
    expect(await auditCount("contract.agency.update", ag.id)).toBe(1);
  });

  test("rename to an existing name, or to nothing, is refused", async ({ page }) => {
    const ag = await makeAgency();
    await openAgencies(page);
    await row(page, ag.name).getByRole("button", { name: /^edit$/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill(CW_AGENCY.existing);
    await dialog.getByRole("button", { name: /save changes/i }).click();
    await expect(toast(page, /an agency with that name already exists/i)).toBeVisible();
    await dialog.getByLabel("Name", { exact: true }).fill("");
    await dialog.getByRole("button", { name: /save changes/i }).click();
    await expect(toast(page, /enter the agency name/i)).toBeVisible();
    expect((await db.staffingAgency.findUniqueOrThrow({ where: { id: ag.id } })).name).toBe(ag.name);
  });

  test("editing an agency that was deleted in the meantime says so", async ({ page }) => {
    const ag = await makeAgency();
    await openAgencies(page);
    await row(page, ag.name).getByRole("button", { name: /^edit$/i }).click();
    await db.staffingAgency.delete({ where: { id: ag.id } });
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Contact name").fill("Too late");
    await dialog.getByRole("button", { name: /save changes/i }).click();
    await expect(toast(page, /that agency no longer exists/i)).toBeVisible();
  });

  test("server failure while editing shows an error and changes nothing", async ({ page }) => {
    const ag = await makeAgency();
    await openAgencies(page);
    await row(page, ag.name).getByRole("button", { name: /^edit$/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill(uniq("CW Never Saved"));
    await failServerActions(page, "abort");
    await dialog.getByRole("button", { name: /save changes/i }).click();
    await expect(toast(page, NETWORK_ERROR)).toBeVisible();
    // The dialog stays open (nothing was lost).
    await expect(dialog).toBeVisible();
    await expectNoCrash(page);
    expect((await db.staffingAgency.findUniqueOrThrow({ where: { id: ag.id } })).name).toBe(ag.name);
  });
});

test.describe("admin: agencies - deactivate / activate", () => {
  test("deactivating an agency with workers keeps its workers", async ({ page }) => {
    const ag = await makeAgency();
    const w = await makeWorker({ agencyId: ag.id });
    await openAgencies(page);
    await expect(row(page, ag.name)).toContainText("1"); // worker count
    await row(page, ag.name).getByRole("button", { name: /^deactivate$/i }).click();
    await expect(toast(page, /agency deactivated/i)).toBeVisible();
    await expect(row(page, ag.name)).toContainText(/inactive/i);
    expect((await db.staffingAgency.findUniqueOrThrow({ where: { id: ag.id } })).isActive).toBe(false);
    // Workers are untouched.
    expect(await db.contractWorker.findUniqueOrThrow({ where: { id: w.id } })).toMatchObject({
      status: "ACTIVE",
      agencyId: ag.id,
    });
    expect(await auditCount("contract.agency.deactivate", ag.id)).toBe(1);

    // And it can be activated again.
    await row(page, ag.name).getByRole("button", { name: /^activate$/i }).click();
    await expect(toast(page, /agency activated/i)).toBeVisible();
    expect((await db.staffingAgency.findUniqueOrThrow({ where: { id: ag.id } })).isActive).toBe(true);
    expect(await auditCount("contract.agency.activate", ag.id)).toBe(1);
  });

  test("an inactive agency is not offered when adding a worker", async ({ page }) => {
    const inactive = await makeAgency({ isActive: false });
    const active = await makeAgency();
    await page.goto("/admin/contract-workers?tab=workers");
    await page.getByRole("button", { name: /add contract worker/i }).click();
    const select = page.getByRole("dialog").getByLabel("Agency");
    await expect(select.locator("option", { hasText: active.name })).toHaveCount(1);
    await expect(select.locator("option", { hasText: inactive.name })).toHaveCount(0);
  });

  test("a worker of an inactive agency keeps that agency (marked inactive) when edited", async ({
    page,
  }) => {
    const inactive = await makeAgency({ isActive: false });
    const w = await makeWorker({ agencyId: inactive.id });
    await page.goto(`/admin/contract-workers?tab=workers&q=${encodeURIComponent(w.name)}`);
    await page.getByRole("button", { name: `Edit ${w.name}` }).click();
    const select = page.getByRole("dialog").getByLabel("Agency");
    await expect(select).toHaveValue(inactive.id);
    await expect(select.locator("option", { hasText: `${inactive.name} (inactive)` })).toHaveCount(1);
  });

  test("a worker of a deactivated agency can still clock in at the kiosk", async ({ browser }) => {
    const inactive = await makeAgency({ isActive: false });
    const w = await makeWorker({ agencyId: inactive.id });
    const page = await openCrewKiosk(browser, 1);
    await pickKioskWorker(page, w.name);
    await page.getByRole("button", { name: /^clock in$/i }).click();
    await expect(toast(page, /clocked in at/i)).toBeVisible();
    expect(await db.contractTimeEntry.count({ where: { contractWorkerId: w.id, status: "ACTIVE" } })).toBe(1);
    await page.context().close();
  });

  test("activating an agency that was deleted in the meantime says so", async ({ page }) => {
    const ag = await makeAgency();
    await openAgencies(page);
    await db.staffingAgency.delete({ where: { id: ag.id } });
    await row(page, ag.name).getByRole("button", { name: /^deactivate$/i }).click();
    await expect(toast(page, /that record no longer exists/i)).toBeVisible();
  });

  test("server failure while deactivating changes nothing", async ({ page }) => {
    const ag = await makeAgency();
    await openAgencies(page);
    await failServerActions(page, "500");
    await row(page, ag.name).getByRole("button", { name: /^deactivate$/i }).click();
    await expect(toast(page, SERVER_ERROR)).toBeVisible();
    await expectNoCrash(page);
    expect((await db.staffingAgency.findUniqueOrThrow({ where: { id: ag.id } })).isActive).toBe(true);
  });

  test("double-clicking Deactivate sends one request", async ({ page }) => {
    const ag = await makeAgency();
    await openAgencies(page);
    const slow = await delayServerActions(page, 1500);
    const btn = row(page, ag.name).getByRole("button", { name: /^deactivate$/i });
    await btn.click();
    await btn.click({ force: true, timeout: 1000 }).catch(() => undefined);
    await expect(toast(page, /agency deactivated/i)).toBeVisible();
    expect(slow.count()).toBe(1);
    expect(await auditCount("contract.agency.deactivate", ag.id)).toBe(1);
  });
});
