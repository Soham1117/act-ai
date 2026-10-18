import { test, expect } from "@playwright/test";
import { db } from "./support/db";
import { failServerActions, toast } from "./support/helpers";
import {
  EMP,
  auditCount,
  kioskCookie,
  kioskSlug,
  openCard,
  openK,
  pinInput,
  resetEmployee,
  rosterButton,
} from "./support/kiosk";

const NOT_ACTIVE = /kiosk session is not active on this device/i;
const row = (name: string) => db.kioskSession.findUniqueOrThrow({ where: { slug: kioskSlug(name) } });

test.beforeEach(async () => {
  await resetEmployee(EMP.flow);
});

test.describe("kiosk session: device cookie", () => {
  test("kiosk revoked while open: next tap says it is not active; a reload goes to login", async ({
    browser,
  }) => {
    const page = await openK(browser, "sess-revoked");
    await expect(rosterButton(page, EMP.flow.name)).toBeVisible();
    await db.kioskSession.update({
      where: { slug: kioskSlug("sess-revoked") },
      data: { revokedAt: new Date(), cookieHash: null },
    });
    await rosterButton(page, EMP.flow.name).click();
    await expect(toast(page, NOT_ACTIVE)).toBeVisible();
    await expect(pinInput(page)).toHaveCount(0);
    await page.reload();
    await expect(page).toHaveURL(/\/login/);
    await page.context().close();
  });

  test("kiosk expired while open: same clear message", async ({ browser }) => {
    const page = await openK(browser, "sess-expired");
    await expect(rosterButton(page, EMP.flow.name)).toBeVisible();
    await db.kioskSession.update({
      where: { slug: kioskSlug("sess-expired") },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await rosterButton(page, EMP.flow.name).click();
    await expect(toast(page, NOT_ACTIVE)).toBeVisible();
    await page.context().close();
  });

  test("revoked after the PIN was typed: the punch is refused and nothing is saved", async ({ browser }) => {
    const page = await openK(browser, "sess-wrongcookie");
    await openCard(page, EMP.flow);
    await pinInput(page).fill("4826");
    await db.kioskSession.update({
      where: { slug: kioskSlug("sess-wrongcookie") },
      data: { revokedAt: new Date(), cookieHash: null },
    });
    await page.getByRole("button", { name: /^clock in$/i }).click();
    await expect(toast(page, NOT_ACTIVE)).toBeVisible();
    expect(await db.timeEntry.count({ where: { employee: { employeeId: EMP.flow.employeeId } } })).toBe(0);
    await page.context().close();
  });

  test("another kiosk's cookie does not open this kiosk (sent to login)", async ({ browser }) => {
    const page = await openK(browser, "sess-other-a", { cookie: kioskCookie("sess-other-b"), noGoto: true });
    await page.goto(`/kiosk/${kioskSlug("sess-other-a")}`);
    await expect(page).toHaveURL(/\/login/);
    await page.context().close();
  });

  test("a made-up cookie value does not open the kiosk", async ({ browser }) => {
    const page = await openK(browser, "sess-other-a", { cookie: "not-the-cookie", noGoto: true });
    await page.goto(`/kiosk/${kioskSlug("sess-other-a")}`);
    await expect(page).toHaveURL(/\/login/);
    await page.context().close();
  });

  test("using the kiosk slides the 90-day expiry forward", async ({ browser }) => {
    const before = await row("sess-slide");
    expect(before.expiresAt.getTime() - Date.now()).toBeLessThan(11 * 86_400_000);
    const page = await openK(browser, "sess-slide");
    await expect(rosterButton(page, EMP.flow.name)).toBeVisible();
    await expect
      .poll(async () => ((await row("sess-slide")).expiresAt.getTime() - Date.now()) / 86_400_000)
      .toBeGreaterThan(89);
    expect((await row("sess-slide")).lastUsedAt).not.toBeNull();
    await page.context().close();
  });

  test("End kiosk session removes the cookie and returns to login", async ({ browser }) => {
    const page = await openK(browser, "sess-end");
    await page.getByRole("button", { name: /end kiosk session/i }).click();
    await expect(page).toHaveURL(/\/login/);
    expect((await page.context().cookies()).some((c) => c.name === "act_kiosk")).toBe(false);
    expect(await auditCount("kiosk.end", kioskSlug("sess-end"))).toBe(1);
    await page.context().close();
  });
});

test.describe("kiosk session: limits and refresh", () => {
  test("30 lookups a minute per kiosk, then a wait message", async ({ browser }) => {
    const page = await openK(browser, "sess-lookup");
    await page.getByRole("button", { name: /enter id/i }).click();
    const input = page.getByPlaceholder("Full ID or last digits");
    for (let i = 0; i < 31; i++) {
      await input.fill(`EMP-2026-9${String(i).padStart(3, "0")}`);
      await input.press("Enter");
      await expect(input).toBeEnabled();
    }
    await expect(toast(page, /too many lookups/i)).toBeVisible();
    await page.context().close();
  });

  test("roster refresh: 20 a minute per kiosk, then a wait message", async ({ browser }) => {
    const page = await openK(browser, "sess-roster", { clock: true });
    await expect(rosterButton(page, EMP.flow.name)).toBeVisible();
    for (let i = 0; i < 20; i++) await page.clock.fastForward(60_000);
    await expect(toast(page, /too many refreshes/i)).toBeVisible();
    await expect(rosterButton(page, EMP.flow.name)).toBeVisible(); // old roster stays
    await page.context().close();
  });

  test("roster refresh fails (connection dropped): message, roster stays", async ({
    browser,
  }) => {
    const page = await openK(browser, "sess-refresh-fail", { clock: true });
    await expect(rosterButton(page, EMP.flow.name)).toBeVisible();
    await failServerActions(page, "abort", { times: 1 });
    await page.clock.fastForward(60_000);
    await expect(toast(page, /could not reach the server/i)).toBeVisible();
    await expect(rosterButton(page, EMP.flow.name)).toBeVisible();
    await page.context().close();
  });

  test("unknown kiosk slug is a 404 even with a cookie", async ({ browser }) => {
    const page = await openK(browser, "sess-idle", { noGoto: true });
    const res = await page.goto("/kiosk/k6-does-not-exist");
    expect(res?.status()).toBe(404);
    await page.context().close();
  });
});
