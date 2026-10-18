import { test, expect } from "@playwright/test";
import { db } from "./support/db";
import { ACC_USERS, loginContext, putAccessObjects, submitLoginForm } from "./support/access";
import { expectNoCrash, failServerActions, toast } from "./support/helpers";
import { BASE_URL } from "./support/test-data";

/** Sessions: logout, back button, revocation, ended access, role change, login `next=`, read-only accounts. */

test.beforeAll(async () => {
  await putAccessObjects();
});

const signOutButton = (page: import("@playwright/test").Page) => page.getByRole("button", { name: /sign out/i });

async function openMenuAndSignOut(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Account menu" }).click();
  await signOutButton(page).click();
}

test.describe("logout", () => {
  test("sign out ends the session and the back button shows no protected data", async ({ browser }) => {
    const ctx = await loginContext(browser, ACC_USERS.logout.email);
    const page = await ctx.newPage();
    await page.goto("/dashboard/settings");
    await expect(page.getByText(ACC_USERS.logout.name).first()).toBeVisible();

    await openMenuAndSignOut(page);
    await expect(page).toHaveURL(/\/login$/);

    // Back to the protected page: a reload must hit the server, which refuses.
    await page.goBack();
    await page.reload();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(ACC_USERS.logout.name)).toHaveCount(0);

    // The cookie is really gone: protected routes and APIs refuse.
    await page.goto("/dashboard/payroll");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard%2Fpayroll$/);
    const res = await ctx.request.get("/api/documents/acc-doc-erin/file", { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    await ctx.close();
  });

  test("server failure during sign out does not crash and keeps the session consistent", async ({ browser }) => {
    const ctx = await loginContext(browser, ACC_USERS.logout.email);
    const page = await ctx.newPage();
    await page.goto("/dashboard/settings");
    const injected = await failServerActions(page, "abort");
    await openMenuAndSignOut(page);
    await expect.poll(injected.count).toBeGreaterThan(0);
    await expectNoCrash(page);
    // The sign-out did not happen, so the user is still signed in (and can try again).
    await page.unroute("**/*");
    await page.goto("/dashboard/settings");
    await expect(page).toHaveURL(/\/dashboard\/settings$/);
    await openMenuAndSignOut(page);
    await expect(page).toHaveURL(/\/login$/);
    await ctx.close();
  });
});

test.describe("session revocation and role changes", () => {
  test("bumping tokenVersion kills an existing session on pages and APIs", async ({ browser }) => {
    const ctx = await loginContext(browser, ACC_USERS.tokenVer.email);
    const page = await ctx.newPage();
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard$/);

    await db.user.update({ where: { email: ACC_USERS.tokenVer.email }, data: { tokenVersion: { increment: 1 } } });

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    const api = await ctx.request.get("/api/documents/acc-doc-erin/file", { maxRedirects: 0 });
    expect(api.status()).toBe(401);
    // The bell poller route says "no session" too, not a quiet 0.
    const bell = await ctx.request.get("/api/notifications/unread", { maxRedirects: 0 });
    expect(bell.status()).toBe(401);
    await ctx.close();
  });

  test("access that ends mid-session (terminated past the grace window) kills the session", async ({ browser }) => {
    const ctx = await loginContext(browser, ACC_USERS.dying.email);
    const page = await ctx.newPage();
    await page.goto("/dashboard/payroll");
    await expect(page).toHaveURL(/\/dashboard\/payroll$/);

    await db.employee.update({
      where: { employeeId: ACC_USERS.dying.employeeId },
      data: { employmentStatus: "TERMINATED", terminationDate: new Date(Date.now() - 200 * 86_400_000) },
    });

    await page.goto("/dashboard/payroll");
    await expect(page).toHaveURL(/\/login/);
    // And a fresh sign-in is refused with a clear reason.
    await page.goto("/login");
    // (signed-out view is already shown: the session is dead)
    await submitLoginForm(page, ACC_USERS.dying.email);
    await expect(page.getByText(/no longer has access/i)).toBeVisible();
    await ctx.close();
  });

  test("a role change takes effect on the next request (promote, then demote)", async ({ browser }) => {
    const ctx = await loginContext(browser, ACC_USERS.promo.email);
    const page = await ctx.newPage();
    const setRole = (role: "ADMIN" | "EMPLOYEE") =>
      db.user.update({ where: { email: ACC_USERS.promo.email }, data: { role } });

    await setRole("EMPLOYEE");
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/unauthorized$/);

    await setRole("ADMIN");
    await page.goto("/admin/employees");
    await expect(page).toHaveURL(/\/admin\/employees$/);
    const punch = await ctx.request.get("/api/punch-photo?type=employee&id=acc-entry-photo&side=in", { maxRedirects: 0 });
    expect(punch.status()).toBe(200);

    await setRole("EMPLOYEE");
    await page.goto("/admin/employees");
    await expect(page).toHaveURL(/\/unauthorized$/);
    const denied = await ctx.request.get("/api/punch-photo?type=employee&id=acc-entry-photo&side=in", { maxRedirects: 0 });
    expect(denied.status()).toBe(403);
    await ctx.close();
  });

  test("an admin linked to an employee record that ended long ago cannot sign in", async ({ page }) => {
    await page.goto("/login");
    await submitLoginForm(page, ACC_USERS.endedAdmin.email);
    await expect(page.getByText(/no longer has access/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("login next= redirect safety", () => {
  async function loginWithNext(browser: import("@playwright/test").Browser, next: string) {
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const page = await ctx.newPage();
    await page.goto(`/login?next=${encodeURIComponent(next)}`);
    await submitLoginForm(page, ACC_USERS.other.email);
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
    // The root path then sends a signed-in employee to the dashboard.
    await expect(page).toHaveURL(/\/dashboard$/);
    expect(new URL(page.url()).origin).toBe(BASE_URL);
    await ctx.close();
  }

  for (const evil of ["https://evil.example/steal", "//evil.example/steal", "/\\evil.example/steal", "javascript:alert(1)"]) {
    test(`external next ${evil} is ignored`, async ({ browser }) => {
      await loginWithNext(browser, evil);
    });
  }

  test("a same-site next is honoured", async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const page = await ctx.newPage();
    await page.goto(`/login?next=${encodeURIComponent("/dashboard/settings")}`);
    await submitLoginForm(page, ACC_USERS.other.email);
    await expect(page).toHaveURL(/\/dashboard\/settings$/);
    await ctx.close();
  });
});

test.describe("read-only accounts", () => {
  test("employee in the 60-day grace window sees a banner, can read own pay, cannot change settings", async ({ browser }) => {
    const ctx = await loginContext(browser, ACC_USERS.grace.email);
    const page = await ctx.newPage();
    await page.goto("/dashboard/payroll");
    await expect(page.getByRole("status").filter({ hasText: /your employment has ended/i })).toBeVisible();
    await expect(page.getByText("ACC Gina stub").first()).toBeVisible();

    await page.goto("/dashboard/settings");
    await expect(page.getByRole("status").filter({ hasText: /employment has ended/i })).toBeVisible();
    await expect(page.getByText(/read-only, so this can.t be changed/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^update$/i })).toHaveCount(0);
    await ctx.close();
  });

  test("a new hire awaiting approval sees the approval banner", async ({ browser }) => {
    const ctx = await loginContext(browser, ACC_USERS.pending.email);
    const page = await ctx.newPage();
    await page.goto("/dashboard");
    await expect(page.getByRole("status").filter({ hasText: /awaiting approval/i })).toBeVisible();
    await ctx.close();
  });

  test("write attempted after access turned read-only is refused and saves nothing", async ({ browser }) => {
    const email = ACC_USERS.flip.email;
    await db.employee.update({
      where: { employeeId: ACC_USERS.flip.employeeId },
      data: { employmentStatus: "ACTIVE", terminationDate: null, personalEmail: null },
    });
    const ctx = await loginContext(browser, email);
    const page = await ctx.newPage();
    await page.goto("/dashboard/settings");
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: /^update$/i }) });
    await form.locator('input[type="email"]').fill("fay.personal@example.com");
    await form.locator('input[type="password"]').fill("E2e-Access-Pass-1!");

    // Meanwhile her employment ends (inside the grace window): the open form is now stale.
    await db.employee.update({
      where: { employeeId: ACC_USERS.flip.employeeId },
      data: { employmentStatus: "TERMINATED", terminationDate: new Date(Date.now() - 10 * 86_400_000) },
    });
    await form.getByRole("button", { name: /^update$/i }).click();
    await expect(toast(page, /account is read-only/i)).toBeVisible();
    const row = await db.employee.findUniqueOrThrow({ where: { employeeId: ACC_USERS.flip.employeeId } });
    expect(row.personalEmail).toBeNull();
    await ctx.close();
  });
});
