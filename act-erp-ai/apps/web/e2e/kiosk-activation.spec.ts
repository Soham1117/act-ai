import { test, expect, type Browser } from "@playwright/test";
import { db } from "./support/db";
import { expectNoCrash, failServerActions, toast } from "./support/helpers";
import { ADMIN_STATE, IP_INSIDE, IP_OUTSIDE, KIOSK_NEW_SLUG } from "./support/test-data";

/** An admin browsing from the kiosk device, connecting from `ip`. */
async function adminAt(browser: Browser, ip: string) {
  const context = await browser.newContext({
    storageState: ADMIN_STATE,
    extraHTTPHeaders: { "x-forwarded-for": ip },
  });
  const page = await context.newPage();
  await page.goto(`/kiosk/${KIOSK_NEW_SLUG}`);
  return { context, page };
}

const activate = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: /activate kiosk on this device/i });
const endSession = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: /end kiosk session/i });

test.afterEach(async () => {
  await db.kioskTrustedNetwork.deleteMany({});
});

test.describe("kiosk activation (admin)", () => {
  test("admin activates a kiosk from an allowed network", async ({ browser }) => {
    const { context, page } = await adminAt(browser, IP_INSIDE);
    await activate(page).click();
    await expect(endSession(page)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/kiosk/${KIOSK_NEW_SLUG}$`));
    await context.close();
  });

  test("activation from an unapproved network is denied and offers Trust this network", async ({
    browser,
  }) => {
    const { context, page } = await adminAt(browser, IP_OUTSIDE);
    await activate(page).click();

    await expect(toast(page, /approved facility network/i)).toBeVisible();
    await expect(page.getByText(IP_OUTSIDE).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /trust this network and activate/i })).toBeVisible();
    await expect(endSession(page)).toHaveCount(0);
    expect(await db.kioskTrustedNetwork.count()).toBe(0);
    await context.close();
  });

  test("Trust this network and activate works, and the network is remembered", async ({
    browser,
  }) => {
    const { context, page } = await adminAt(browser, IP_OUTSIDE);
    await activate(page).click();
    await page.getByRole("button", { name: /trust this network and activate/i }).click();

    await expect(endSession(page)).toBeVisible();
    const trusted = await db.kioskTrustedNetwork.findMany();
    expect(trusted.map((t) => t.cidr)).toEqual([`${IP_OUTSIDE}/32`]);
    await context.close();
  });

  test("unknown kiosk address shows not-found, not a crash", async ({ page }) => {
    const res = await page.goto("/kiosk/does-not-exist");
    expect(res?.status()).toBe(404);
  });

  test("a device that is not signed in is sent to log in before it can activate", async ({
    browser,
  }) => {
    const context = await browser.newContext(); // no admin session, no kiosk cookie
    const page = await context.newPage();
    await page.goto(`/kiosk/${KIOSK_NEW_SLUG}`);
    await expect(page).toHaveURL(/\/login\?next=(%2F|\/)kiosk/);
    await context.close();
  });

  test("server failure during activation shows an error and does not crash", async ({
    browser,
  }) => {
    const { context, page } = await adminAt(browser, IP_INSIDE);
    await failServerActions(page, "abort");
    await activate(page).click();
    await expect(toast(page, /something went wrong|try again|failed/i)).toBeVisible();
    await expectNoCrash(page);
    await context.close();
  });
});
