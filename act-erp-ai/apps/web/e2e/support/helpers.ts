import { expect, type Browser, type Page, type Route } from "@playwright/test";
import { BASE_URL, IP_INSIDE, env } from "./test-data";

/** True for Next.js server-action calls (POST with a `next-action` header). */
export function isServerAction(route: Route) {
  const req = route.request();
  return req.method() === "POST" && "next-action" in req.headers();
}

/**
 * Make server actions fail. Modes:
 *  - "abort": connection dropped (fetch throws)
 *  - "500":   server crashed
 *  - "stale": page is from an older deployment ("Failed to find Server Action")
 * Options: `times` fails only the first N calls then lets the rest through (for
 * retry tests); `match` limits it to calls whose request body includes the text.
 * Returns how many calls were intercepted.
 */
export async function failServerActions(
  page: Page,
  mode: "abort" | "500" | "stale" = "abort",
  opts: { times?: number; match?: string | RegExp } = {},
): Promise<{ count: () => number }> {
  let n = 0;
  await page.route("**/*", async (route) => {
    if (!isServerAction(route)) return route.continue();
    const body = route.request().postData() ?? "";
    const matches =
      !opts.match || (typeof opts.match === "string" ? body.includes(opts.match) : opts.match.test(body));
    if (!matches || (opts.times !== undefined && n >= opts.times)) return route.continue();
    n += 1;
    if (mode === "abort") return route.abort("failed");
    if (mode === "stale") {
      return route.fulfill({
        status: 404,
        contentType: "text/plain",
        headers: { "x-nextjs-action-not-found": "1" },
        body: "Server action not found.",
      });
    }
    return route.fulfill({ status: 500, contentType: "text/plain", body: "Internal Server Error" });
  });
  return { count: () => n };
}

/**
 * Slow every server action down (and count them) so a test can double-click
 * or double-submit while the first call is still in flight.
 */
export async function delayServerActions(page: Page, ms = 1500): Promise<{ count: () => number }> {
  let n = 0;
  await page.route("**/*", async (route) => {
    if (!isServerAction(route)) return route.continue();
    n += 1;
    await new Promise((r) => setTimeout(r, ms));
    return route.continue();
  });
  return { count: () => n };
}

/** Collects browser console errors and uncaught page errors (for smoke tests). */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
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
