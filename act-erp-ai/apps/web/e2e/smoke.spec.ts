import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { loadRouteTokens, loginContext, putAccessObjects, resolveTokens } from "./support/access";
import { PAGES } from "./support/access-routes";
import { collectConsoleErrors, expectNoCrash } from "./support/helpers";
import {
  ADMIN_STATE,
  BASE_URL,
  IP_INSIDE,
  KIOSK_ACTIVE_SLUG,
  KIOSK_CREW_SLUG,
  env,
} from "./support/test-data";

/**
 * Smoke: open every page the right role can reach (list = e2e/support/access-routes.ts,
 * rows with `smoke`) and check it renders: HTTP < 400, no uncaught errors,
 * no Next error screen, a heading or main region present.
 */

/**
 * Console noise we accept. Anything else fails the test.
 *  - "Failed to load resource ... 404": the not-found pages (AI-off chat/knowledge)
 *    and optional avatar images legitimately 404.
 *  - dev-server HMR / Fast Refresh chatter is logged at info/log level, not error, so it needs no entry.
 */
const HARMLESS = [/Failed to load resource: the server responded with a status of 404/];
const real = (errors: string[]) => errors.filter((e) => !HARMLESS.some((re) => re.test(e)));

let tokens: Record<string, string> = {};
const contexts: Partial<Record<"admin" | "employee" | "anon", BrowserContext>> = {};

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  await putAccessObjects();
  tokens = await loadRouteTokens();
  contexts.admin = await browser.newContext({ baseURL: BASE_URL, storageState: ADMIN_STATE });
  contexts.employee = await loginContext(browser, env("E2E_EMPLOYEE_EMAIL"), env("E2E_EMPLOYEE_PASSWORD"));
  contexts.anon = await browser.newContext({ baseURL: BASE_URL });
});

test.afterAll(async () => {
  for (const c of Object.values(contexts)) await c?.close();
});

async function visit(page: Page, path: string, opts: { notFound?: boolean; content?: (page: Page) => import("@playwright/test").Locator } = {}) {
  const errors = collectConsoleErrors(page);
  const res = await page.goto(path);
  if (opts.notFound) {
    // Feature switched off: a clear "Page not found", not a crash or a blank page.
    expect(res?.status()).toBeLessThan(500);
    await expect(page.getByRole("heading", { name: /page not found/i })).toBeVisible();
  } else {
    expect(res?.status(), `HTTP status of ${path}`).toBeLessThan(400);
    await expect((opts.content?.(page) ?? page.getByRole("heading").or(page.locator("main"))).first()).toBeVisible();
    // Route error boundaries show "Something went wrong"; Next shows "Application error".
    await expect(page.getByRole("heading", { name: /something went wrong|application error/i })).toHaveCount(0);
  }
  await expectNoCrash(page);
  // Let client effects (realtime badge poll, charts) run before judging the console.
  await page.waitForLoadState("load");
  expect(real(errors), `console/page errors on ${path}`).toEqual([]);
}

for (const role of ["admin", "employee", "anon"] as const) {
  test.describe(`smoke: ${role} pages`, () => {
    for (const row of PAGES.filter((r) => r.smoke === role)) {
      test(row.path, async () => {
        const page = await contexts[role]!.newPage();
        try {
          await visit(page, resolveTokens(row.path, tokens), { notFound: row.smokeNotFound });
        } finally {
          await page.close();
        }
      });
    }
  });
}

test.describe("smoke: kiosk terminals (device cookie)", () => {
  for (const slug of [KIOSK_ACTIVE_SLUG, KIOSK_CREW_SLUG]) {
    test(`/kiosk/${slug}`, async ({ browser }) => {
      const cookie = env("E2E_KIOSK_COOKIE") + (slug === KIOSK_CREW_SLUG ? "-crew" : "");
      const context = await browser.newContext({
        baseURL: BASE_URL,
        permissions: ["camera"],
        extraHTTPHeaders: { "x-forwarded-for": IP_INSIDE },
      });
      await context.addCookies([{ name: "act_kiosk", value: cookie, url: BASE_URL }]);
      const page = await context.newPage();
      // The kiosk screen is fullscreen and has no heading: its employee buttons are the content.
      await visit(page, `/kiosk/${slug}`, { content: (p) => p.getByRole("button").first() });
      await context.close();
    });
  }
});

test.describe("smoke: AI assistant is off", () => {
  test("chat API says the assistant is not enabled instead of failing", async () => {
    const res = await contexts.employee!.request.post("/api/chat", { data: { messages: [] } });
    expect(res.status()).toBe(503);
    expect(await res.text()).toMatch(/not enabled/i);
  });
});
