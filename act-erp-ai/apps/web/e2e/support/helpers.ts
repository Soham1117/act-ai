import { expect, type Browser, type Page, type Route } from "@playwright/test";
import { BASE_URL, IP_INSIDE, env } from "./test-data";

/** True for Next.js server-action calls (POST with a `next-action` header). */
export function isServerAction(route: Route) {
  const req = route.request();
  return req.method() === "POST" && "next-action" in req.headers();
}

/**
 * Make every server action fail the way a dropped connection (`abort`) or a
 * crashing server (`500`) would. Returns how many calls were intercepted.
 */
export async function failServerActions(
  page: Page,
  mode: "abort" | "500" = "abort",
): Promise<{ count: () => number }> {
  let n = 0;
  await page.route("**/*", async (route) => {
    if (!isServerAction(route)) return route.continue();
    n += 1;
    if (mode === "abort") return route.abort("failed");
    return route.fulfill({ status: 500, contentType: "text/plain", body: "Internal Server Error" });
  });
  return { count: () => n };
}

/** The app must never fall back to Next's error screen or a blank page. */
export async function expectNoCrash(page: Page) {
  await expect(page.getByText(/application error|this page couldn.t load/i)).toHaveCount(0);
  await expect(page.locator("body")).not.toBeEmpty();
}

/** A visible toast (sonner) containing the text. */
export function toast(page: Page, text: string | RegExp) {
  return page.locator("[data-sonner-toast]").filter({ hasText: text }).first();
}

/**
 * Opens a kiosk page in a fresh browser context that already holds the
 * kiosk's device cookie and pretends to connect from the facility network.
 */
export async function openKiosk(
  browser: Browser,
  slug: string,
  opts: { cookieSuffix?: string; ip?: string } = {},
): Promise<Page> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    permissions: ["camera"],
    extraHTTPHeaders: { "x-forwarded-for": opts.ip ?? IP_INSIDE },
  });
  await context.addCookies([
    {
      name: "act_kiosk",
      value: env("E2E_KIOSK_COOKIE") + (opts.cookieSuffix ?? ""),
      url: BASE_URL,
    },
  ]);
  const page = await context.newPage();
  await page.goto(`/kiosk/${slug}`);
  return page;
}
