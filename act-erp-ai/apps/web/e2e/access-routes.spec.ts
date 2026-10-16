import { test, expect, request as pwRequest, type APIRequestContext, type APIResponse, type BrowserContext } from "@playwright/test";
import { db } from "./support/db";
import {
  ACC_IDS,
  ACC_USERS,
  loginContext,
  putAccessObjects,
} from "./support/access";
import { APIS, PAGES, WHO, pathnameOf, type Outcome, type RouteRow, type Who } from "./support/access-routes";
import {
  ADMIN_STATE,
  BASE_URL,
  EMPLOYEE,
  JOB_CODE,
  KIOSK_NEW_SLUG,
  PAYROLL_PERIOD_TITLE,
  env,
} from "./support/test-data";

/**
 * Access matrix: every page route and API route x {anonymous, employee,
 * employee in the 60-day grace window, employee whose access ended, admin}.
 * The expectations live in e2e/support/access-routes.ts (one line per route).
 */

const clients = {} as Record<Who, APIRequestContext>;
const contexts: BrowserContext[] = [];
let tokens: Record<string, string> = {};

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000); // the first visit to each route compiles it (dev server)
  await putAccessObjects();
  const erin = await db.employee.findFirstOrThrow({ where: { employeeId: EMPLOYEE.employeeId } });
  await putAccessObjects({ avatarFor: erin.id });
  const [cw, job, period, dept] = await Promise.all([
    db.contractWorker.findUniqueOrThrow({ where: { workerId: "CW-ACC1" } }),
    db.jobCode.findUniqueOrThrow({ where: { code: JOB_CODE.code } }),
    db.payrollCalendar.findFirstOrThrow({ where: { title: PAYROLL_PERIOD_TITLE } }),
    db.department.findUniqueOrThrow({ where: { id: ACC_IDS.dept } }),
  ]);
  tokens = {
    ...ACC_IDS,
    erin: erin.id,
    cw: cw.id,
    job: job.id,
    period: period.id,
    dept: dept.id,
    hire: ACC_IDS.hireImport,
    invite: ACC_IDS.inviteToken,
    inviteExpired: ACC_IDS.inviteExpiredToken,
    newKiosk: KIOSK_NEW_SLUG,
  };

  clients.anon = await pwRequest.newContext({ baseURL: BASE_URL });

  const employee = await loginContext(browser, env("E2E_EMPLOYEE_EMAIL"), env("E2E_EMPLOYEE_PASSWORD"));
  const grace = await loginContext(browser, ACC_USERS.grace.email);
  // "ended": a real session whose owner is terminated past the grace window afterwards.
  // (Reset first: a re-run in a fresh worker must still be able to sign in.)
  await db.employee.update({
    where: { employeeId: ACC_USERS.ended.employeeId },
    data: { employmentStatus: "ACTIVE", terminationDate: null },
  });
  const ended = await loginContext(browser, ACC_USERS.ended.email);
  await db.employee.update({
    where: { employeeId: ACC_USERS.ended.employeeId },
    data: { employmentStatus: "TERMINATED", terminationDate: new Date(Date.now() - 200 * 86_400_000) },
  });
  const admin = await browser.newContext({ baseURL: BASE_URL, storageState: ADMIN_STATE });
  contexts.push(employee, grace, ended, admin);
  clients.employee = employee.request;
  clients.grace = grace.request;
  clients.ended = ended.request;
  clients.admin = admin.request;
});

test.afterAll(async () => {
  await clients.anon?.dispose();
  for (const c of contexts) await c.close();
});

const resolve = (path: string) => path.replace(/\{(\w+)\}/g, (_, k: string) => tokens[k] ?? `MISSING-${k}`);

/** Turn a raw response (redirects NOT followed) into the Outcome vocabulary. */
async function classify(res: APIResponse, requestedPath: string, kind: RouteRow["kind"]): Promise<Outcome> {
  const status = res.status();
  if (status >= 300 && status < 400) {
    const loc = new URL(res.headers()["location"] ?? "", BASE_URL);
    if (loc.pathname === "/login") {
      return loc.searchParams.get("next") === pathnameOf(requestedPath) ? "login" : "login-plain";
    }
    if (loc.pathname === "/unauthorized") return "unauthorized";
    return `->${loc.pathname}`;
  }
  if (status === 200 && kind === "page" && /<meta name="robots" content="noindex/.test(await res.text())) return 404;
  return status === 200 ? "ok" : status;
}

async function call(row: RouteRow, who: Who) {
  const path = resolve(row.path);
  const res = await clients[who].fetch(path, {
    method: row.method ?? "GET",
    maxRedirects: 0,
    failOnStatusCode: false,
    ...(row.method === "POST" ? { data: "{}", headers: { "content-type": "application/json" } } : {}),
  });
  return { path, res, outcome: await classify(res, path, row.kind) };
}

for (const [title, rows] of [
  ["page routes", PAGES],
  ["API routes", APIS],
] as const) {
  test.describe(`access matrix: ${title}`, () => {
    for (const row of rows) {
      test(`${row.method ?? "GET"} ${row.path}`, async () => {
        for (const who of WHO) {
          const { path, res, outcome } = await call(row, who);
          expect.soft(outcome, `${who} -> ${row.method ?? "GET"} ${path}`).toBe(row.expect[who]);
          const needle = row.bodyContains?.[who];
          if (needle && outcome === "ok") {
            expect.soft(await res.text(), `${who} body of ${path}`).toContain(needle);
          }
        }
      });
    }
  });
}

test.describe("access matrix: what the denied person actually sees", () => {
  test("employee opening an admin page lands on the access denied page", async () => {
    const page = await contexts[0]!.newPage();
    await page.goto("/admin/employees");
    await expect(page).toHaveURL(/\/unauthorized$/);
    await expect(page.getByRole("heading", { name: /access denied/i })).toBeVisible();
    await page.close();
  });

  test("anonymous visitor opening a protected page gets the login page and returns after sign-in", async ({ page }) => {
    await page.goto("/dashboard/payroll");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard%2Fpayroll$/);
    await page.getByLabel(/email or username/i).fill(env("E2E_EMPLOYEE_EMAIL"));
    await page.getByLabel(/^password/i).fill(env("E2E_EMPLOYEE_PASSWORD"));
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard\/payroll$/);
  });

  test("employee whose access ended is sent to the login page, not shown data", async () => {
    // Edna's session cookie is still in her context; the page guard treats it as dead.
    const page = await contexts[2]!.newPage();
    await page.goto("/dashboard/payroll");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
    await page.close();
  });
});
