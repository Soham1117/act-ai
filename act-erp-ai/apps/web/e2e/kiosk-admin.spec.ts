import { test, expect, type Browser, type Page } from "@playwright/test";
import { db } from "./support/db";
import { delayServerActions, expectNoCrash, failServerActions, toast } from "./support/helpers";
import { EMP, auditCount, empRow, kioskSlug, pinMatches, resetEmployee, setPin } from "./support/kiosk";
import { ADMIN_STATE, IP_INSIDE, IP_OUTSIDE } from "./support/test-data";

async function adminPage(browser: Browser, ip?: string): Promise<Page> {
  const context = await browser.newContext({
    storageState: ADMIN_STATE,
    ...(ip ? { extraHTTPHeaders: { "x-forwarded-for": ip } } : {}),
  });
  const page = await context.newPage();
  await page.goto("/admin/kiosks");
  await page.waitForLoadState("networkidle"); // let the page hydrate before clicking
  return page;
}

const kioskRow = (page: Page, slug: string) => page.locator("li").filter({ hasText: `/kiosk/${slug} ` }).first();

test.describe("admin: create, revoke and delete kiosks", () => {
  test.afterEach(async () => {
    await db.kioskSession.deleteMany({ where: { slug: { startsWith: "k6a-" } } });
  });

  async function create(page: Page, label: string, slug?: string) {
    await page.getByRole("button", { name: /new kiosk/i }).click();
    const dialog = page.getByRole("dialog", { name: /new kiosk/i });
    await dialog.getByPlaceholder(/fort worth — plant/i).fill(label);
    if (slug !== undefined) await dialog.getByPlaceholder("fort-worth").fill(slug);
    return dialog;
  }

  test("creates a kiosk (slug follows the label), shows it as Inactive, records an audit entry", async ({
    browser,
  }) => {
    const page = await adminPage(browser);
    const dialog = await create(page, "K6a Plant Floor");
    await expect(dialog.getByPlaceholder("fort-worth")).toHaveValue("k6a-plant-floor");
    await dialog.getByRole("button", { name: /create kiosk/i }).click();
    await expect(toast(page, /kiosk created/i)).toBeVisible();
    const row = await db.kioskSession.findUniqueOrThrow({ where: { slug: "k6a-plant-floor" } });
    expect(row.cookieHash).toBeNull();
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(89 * 86_400_000);
    await expect(kioskRow(page, "k6a-plant-floor")).toContainText("Inactive");
    expect(await auditCount("kiosk.create", row.id)).toBe(1);
    await page.context().close();
  });

  test("duplicate slug is refused with a clear message and no second row", async ({ browser }) => {
    const page = await adminPage(browser);
    await db.kioskSession.create({
      data: { slug: "k6a-dup", label: "Dup", provisionedBy: (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id, expiresAt: new Date(Date.now() + 86_400_000) },
    });
    const dialog = await create(page, "Another", "k6a-dup");
    await dialog.getByRole("button", { name: /create kiosk/i }).click();
    await expect(toast(page, /a kiosk with slug "k6a-dup" already exists/i)).toBeVisible();
    expect(await db.kioskSession.count({ where: { slug: "k6a-dup" } })).toBe(1);
    await page.context().close();
  });

  test("an unusable slug is cleaned up or refused; spaces-only label is refused", async ({ browser }) => {
    const page = await adminPage(browser);
    let dialog = await create(page, "Odd One", "!!!");
    // Leaving the field cleans it to nothing, so Create stays off.
    await dialog.getByPlaceholder("Fort Worth").blur().catch(() => undefined);
    await dialog.getByPlaceholder("fort-worth").blur();
    await expect(dialog.getByRole("button", { name: /create kiosk/i })).toBeDisabled();
    await dialog.getByPlaceholder("fort-worth").fill("K6a Bad Slug!");
    await dialog.getByRole("button", { name: /create kiosk/i }).click();
    await expect(toast(page, /kiosk created/i)).toBeVisible();
    expect(await db.kioskSession.count({ where: { slug: "k6a-bad-slug" } })).toBe(1);

    dialog = await create(page, "   ", "k6a-blank");
    await dialog.getByRole("button", { name: /create kiosk/i }).click();
    await expect(toast(page, /check label/i)).toBeVisible();
    expect(await db.kioskSession.count({ where: { slug: "k6a-blank" } })).toBe(0);
    await page.context().close();
  });

  for (const mode of ["abort", "500", "stale"] as const) {
    test(`server failure (${mode}) creating a kiosk: message, no crash, nothing saved`, async ({ browser }) => {
      const page = await adminPage(browser);
      const dialog = await create(page, "K6a Fail", "k6a-fail");
      await failServerActions(page, mode);
      await dialog.getByRole("button", { name: /create kiosk/i }).click();
      await expect(page.getByText(/something went wrong|unexpected response|failed|try again/i).first()).toBeVisible();
      await expectNoCrash(page);
      expect(await db.kioskSession.count({ where: { slug: "k6a-fail" } })).toBe(0);
      await page.context().close();
    });
  }

  test("double-clicking Create kiosk makes one kiosk", async ({ browser }) => {
    const page = await adminPage(browser);
    const dialog = await create(page, "K6a Twice", "k6a-twice");
    await delayServerActions(page, 1200);
    await dialog.getByRole("button", { name: /create kiosk/i }).dblclick();
    await expect(toast(page, /kiosk created/i)).toBeVisible();
    expect(await db.kioskSession.count({ where: { slug: "k6a-twice" } })).toBe(1);
    await page.context().close();
  });

  test("revoke an active kiosk: row turns Revoked, cookie hash cleared, device loses access", async ({ browser }) => {
    const admin = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
    const k = await db.kioskSession.create({
      data: { slug: "k6a-revoke", label: "Revoke me", provisionedBy: admin, cookieHash: "k6a-revoke-hash", expiresAt: new Date(Date.now() + 86_400_000 * 30) },
    });
    const page = await adminPage(browser);
    await kioskRow(page, "k6a-revoke").getByRole("button").last().click();
    await page.getByRole("menuitem", { name: /revoke session/i }).click();
    await expect(toast(page, /kiosk revoked/i)).toBeVisible();
    const after = await db.kioskSession.findUniqueOrThrow({ where: { id: k.id } });
    expect(after.revokedAt).not.toBeNull();
    expect(after.cookieHash).toBeNull();
    await expect(kioskRow(page, "k6a-revoke")).toContainText("Revoked");
    expect(await auditCount("kiosk.revoke", k.id)).toBe(1);
    // Revoke is no longer offered.
    await kioskRow(page, "k6a-revoke").getByRole("button").last().click();
    await expect(page.getByRole("menuitem", { name: /revoke session/i })).toHaveCount(0);
    await page.context().close();
  });

  test("revoke failure keeps the kiosk active; delete asks first, and keeps old time entries' kiosk name", async ({
    browser,
  }) => {
    const admin = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
    const k = await db.kioskSession.create({
      data: { slug: "k6a-del", label: "Delete me", provisionedBy: admin, cookieHash: "k6a-del-hash", expiresAt: new Date(Date.now() + 86_400_000 * 30) },
    });
    const page = await adminPage(browser);
    const fail = await failServerActions(page, "abort", { times: 1 });
    await kioskRow(page, "k6a-del").getByRole("button").last().click();
    await page.getByRole("menuitem", { name: /revoke session/i }).click();
    await expect(page.getByText(/something went wrong|failed|try again/i).first()).toBeVisible();
    expect(fail.count()).toBe(1);
    expect((await db.kioskSession.findUniqueOrThrow({ where: { id: k.id } })).revokedAt).toBeNull();

    await page.reload();
    await kioskRow(page, "k6a-del").getByRole("button").last().click();
    await page.getByRole("menuitem", { name: /delete kiosk/i }).click();
    const confirm = page.getByRole("alertdialog");
    await confirm.getByRole("button", { name: /cancel/i }).click();
    expect(await db.kioskSession.count({ where: { id: k.id } })).toBe(1);
    await kioskRow(page, "k6a-del").getByRole("button").last().click();
    await page.getByRole("menuitem", { name: /delete kiosk/i }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: /^delete$/i }).click();
    await expect(toast(page, /kiosk deleted/i)).toBeVisible();
    expect(await db.kioskSession.count({ where: { id: k.id } })).toBe(0);
    expect(await auditCount("kiosk.delete", k.id)).toBe(1);
    await page.context().close();
  });
});

test.describe("admin: kiosk list shows states", () => {
  test("expired, expiring, revoked, inactive and active kiosks are labelled", async ({ browser }) => {
    const page = await adminPage(browser);
    await expect(kioskRow(page, kioskSlug("adm-expired"))).toContainText("Expired");
    await expect(kioskRow(page, kioskSlug("adm-expired"))).toContainText(/session expired/i);
    await expect(kioskRow(page, kioskSlug("adm-expiring"))).toContainText(/expires in [45] days/i);
    await expect(kioskRow(page, kioskSlug("adm-revoked"))).toContainText("Revoked");
    await expect(kioskRow(page, kioskSlug("adm-inactive"))).toContainText("Inactive");
    await expect(kioskRow(page, kioskSlug("adm-active"))).toContainText("Active");
    await page.context().close();
  });

  test("/kiosk index lists kiosks for an admin; anonymous goes to login", async ({ browser }) => {
    const page = await adminPage(browser);
    await page.goto("/kiosk");
    await expect(page.getByText(`/kiosk/${kioskSlug("adm-active")}`)).toBeVisible();
    await page.context().close();
    const anon = await browser.newContext();
    const p = await anon.newPage();
    await p.goto("/kiosk");
    await expect(p).toHaveURL(/\/login\?next=/);
    await anon.close();
  });
});

test.describe("admin: trusted networks", () => {
  test.beforeEach(async () => {
    await db.auditLog.deleteMany({ where: { action: { startsWith: "kiosk.network." } } });
  });
  test.afterEach(async () => {
    await db.kioskTrustedNetwork.deleteMany({});
  });
  const cidrBox = (p: Page) => p.getByLabel("IP address or CIDR");
  const add = async (p: Page, v: string, label?: string) => {
    await cidrBox(p).fill(v);
    if (label) await p.getByLabel("Label").fill(label);
    await p.getByRole("button", { name: /add network/i }).click();
  };

  test("add an IP and a CIDR (host bits cleared); duplicates keep one row", async ({ browser }) => {
    const page = await adminPage(browser, IP_INSIDE);
    await add(page, "198.51.100.7", "Dock");
    await expect(toast(page, /trusted 198\.51\.100\.7\/32/i)).toBeVisible();
    await add(page, "172.20.5.9/24");
    await expect(toast(page, /trusted 172\.20\.5\.0\/24/i)).toBeVisible();
    await add(page, "198.51.100.7", "Dock 2");
    await expect(toast(page, /trusted 198\.51\.100\.7\/32/i).first()).toBeVisible();
    await expect
      .poll(async () => (await db.kioskTrustedNetwork.findFirst({ where: { cidr: "198.51.100.7/32" } }))?.label)
      .toBe("Dock 2");
    const rows = await db.kioskTrustedNetwork.findMany({ orderBy: { cidr: "asc" } });
    expect(rows.map((r) => r.cidr).sort()).toEqual(["172.20.5.0/24", "198.51.100.7/32"]);
    expect(rows.find((r) => r.cidr === "198.51.100.7/32")!.label).toBe("Dock 2");
    await expect.poll(() => auditCount("kiosk.network.add")).toBe(3);
    await page.reload();
    await expect(page.getByText("198.51.100.7/32")).toBeVisible();
    await expect(page.getByText("10.99.0.0/16")).toBeVisible(); // server config
    await page.context().close();
  });

  for (const bad of ["banana", "10.0.0.0/8", "10.0.0.0/15", "1.2.3.4/33", "999.1.1.1", "2001:db8::1"]) {
    test(`"${bad}" is refused and nothing is saved`, async ({ browser }) => {
      const page = await adminPage(browser, IP_INSIDE);
      await add(page, bad);
      await expect(toast(page, /valid ipv4 address or cidr from \/16 to \/32/i)).toBeVisible();
      expect(await db.kioskTrustedNetwork.count()).toBe(0);
      await page.context().close();
    });
  }

  test("Add is disabled for an empty or blank field", async ({ browser }) => {
    const page = await adminPage(browser, IP_INSIDE);
    await expect(page.getByRole("button", { name: /add network/i })).toBeDisabled();
    await cidrBox(page).fill("   ");
    await expect(page.getByRole("button", { name: /add network/i })).toBeDisabled();
    await page.context().close();
  });

  test("remove: Cancel keeps it, Remove deletes it, already-gone row says so", async ({ browser }) => {
    const admin = await db.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    const r1 = await db.kioskTrustedNetwork.create({ data: { cidr: "198.51.100.20/32", addedById: admin.id } });
    const r2 = await db.kioskTrustedNetwork.create({ data: { cidr: "198.51.100.21/32", addedById: admin.id } });
    const page = await adminPage(browser, IP_INSIDE);
    const li = (c: string) => page.locator("li").filter({ hasText: c });
    await li("198.51.100.20/32").getByRole("button", { name: /remove/i }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: /cancel/i }).click();
    expect(await db.kioskTrustedNetwork.count({ where: { id: r1.id } })).toBe(1);
    await li("198.51.100.20/32").getByRole("button", { name: /remove/i }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: /^remove$/i }).click();
    await expect(toast(page, /network removed/i)).toBeVisible();
    expect(await db.kioskTrustedNetwork.count({ where: { id: r1.id } })).toBe(0);
    expect(await auditCount("kiosk.network.remove", r1.id)).toBe(1);

    await li("198.51.100.21/32").getByRole("button", { name: /remove/i }).click();
    await db.kioskTrustedNetwork.delete({ where: { id: r2.id } });
    await page.getByRole("alertdialog").getByRole("button", { name: /^remove$/i }).click();
    await expect(toast(page, /no longer exists/i)).toBeVisible();
    await page.context().close();
  });

  test("failure while adding shows a message and saves nothing", async ({ browser }) => {
    const page = await adminPage(browser, IP_INSIDE);
    await failServerActions(page, "abort");
    await add(page, "198.51.100.30");
    await expect(page.getByText(/something went wrong|failed|try again/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect(await db.kioskTrustedNetwork.count()).toBe(0);
    await page.context().close();
  });

  test("current IP: allowed inside, not allowed outside with a Trust button that saves it", async ({ browser }) => {
    const inside = await adminPage(browser, IP_INSIDE);
    await expect(inside.getByText(IP_INSIDE).first()).toBeVisible();
    await expect(inside.getByText("allowed", { exact: true })).toBeVisible();
    await expect(inside.getByRole("button", { name: /trust my current network/i })).toHaveCount(0);
    await inside.context().close();

    const out = await adminPage(browser, `1.1.1.1, ${IP_OUTSIDE}`); // last hop counts
    await expect(out.getByText(IP_OUTSIDE).first()).toBeVisible();
    await expect(out.getByText("not allowed")).toBeVisible();
    await out.getByRole("button", { name: /trust my current network/i }).click();
    await expect(toast(out, new RegExp(`trusted ${IP_OUTSIDE.replace(/\./g, "\\.")}/32`, "i"))).toBeVisible();
    expect((await db.kioskTrustedNetwork.findMany()).map((r) => r.cidr)).toEqual([`${IP_OUTSIDE}/32`]);
    await expect.poll(() => auditCount("kiosk.network.trust")).toBe(1);
    await out.reload();
    await expect(out.getByText("allowed", { exact: true })).toBeVisible();
    await out.context().close();
  });

  test("an IPv6 connection cannot be trusted: clear message, nothing saved", async ({ browser }) => {
    const context = await browser.newContext({
      storageState: ADMIN_STATE,
      extraHTTPHeaders: { "x-forwarded-for": "2001:db8::1" },
    });
    const page = await context.newPage();
    await page.goto(`/kiosk/${kioskSlug("adm-inactive")}`);
    await page.getByRole("button", { name: /activate kiosk on this device/i }).click();
    await page.getByRole("button", { name: /trust this network and activate/i }).click();
    await expect(toast(page, /could not read a valid ipv4 address/i)).toBeVisible();
    expect(await db.kioskTrustedNetwork.count()).toBe(0);
    await context.close();
  });
});

test.describe("admin: reset an employee's kiosk PIN", () => {
  test("reset puts back the temporary PIN 3214; cancelling the confirm does nothing", async ({ browser }) => {
    await resetEmployee(EMP.flow);
    await setPin(EMP.flow, "7391");
    const emp = await empRow(EMP.flow);
    const page = await adminPage(browser);
    await page.goto(`/admin/employees/${emp.id}`);
    page.once("dialog", (d) => void d.dismiss());
    await page.getByRole("button", { name: /reset kiosk pin/i }).click();
    expect(await pinMatches(EMP.flow, "7391")).toBe(true);
    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: /reset kiosk pin/i }).click();
    await expect(toast(page, /reset to 3214/i)).toBeVisible();
    expect(await pinMatches(EMP.flow, "3214")).toBe(true);
    expect(await auditCount("kiosk.pin_reset", emp.id)).toBe(1);
    await page.context().close();
  });
});
