import { test, expect, type Page } from "@playwright/test";
import { db } from "./support/db";
import { ACC_NEW_PASSWORD, ACC_PASSWORD, ACC_USERS, loginContext, submitLoginForm } from "./support/access";
import { expectNoCrash, failServerActions, toast } from "./support/helpers";
import { BASE_URL } from "./support/test-data";

/**
 * Forced password change (User.mustChangePassword): the user can reach ONLY
 * /change-password (and sign out) until they pick a new password.
 */

const pwFields = (page: Page) => page.locator('input[type="password"]');
const heading = (page: Page) => page.getByRole("heading", { name: /choose a new password/i });

async function fillForm(page: Page, current: string, next: string, confirm = next) {
  await pwFields(page).nth(0).fill(current);
  await pwFields(page).nth(1).fill(next);
  await pwFields(page).nth(2).fill(confirm);
  await page.getByRole("button", { name: /update password/i }).click();
}

const userRow = (email: string) =>
  db.user.findUniqueOrThrow({
    where: { email },
    select: { passwordHash: true, mustChangePassword: true, tokenVersion: true },
  });

test.describe("forced password change: the gate", () => {
  test("signing in lands on the change-password page and nothing else is reachable", async ({ browser }) => {
    const ctx = await loginContext(browser, ACC_USERS.mustGate.email);
    const page = await ctx.newPage();

    await page.goto("/");
    await expect(page).toHaveURL(/\/change-password$/);
    await expect(heading(page)).toBeVisible();

    for (const path of ["/dashboard", "/dashboard/settings", "/dashboard/payroll", "/dashboard/documents"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/change-password$/);
    }
    // Not an admin, but even the admin pages must not leak anything on the way.
    await page.goto("/admin");
    await expect(page).not.toHaveURL(/\/admin$/);

    // Route handlers answer with a navigation response, never data.
    for (const path of ["/api/notifications/unread", `/api/documents/acc-doc-erin/file`]) {
      const res = await ctx.request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(307);
      expect(new URL(res.headers()["location"]!, BASE_URL).pathname, path).toBe("/change-password");
    }
    await ctx.close();
  });

  test("temporary-password admin is held on the page too", async ({ browser }) => {
    const ctx = await loginContext(browser, ACC_USERS.mustAdmin.email);
    const page = await ctx.newPage();
    for (const path of ["/admin", "/admin/employees", "/admin/payroll"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/change-password$/);
    }
    await expect(heading(page)).toBeVisible();
    await ctx.close();
  });

  test("validation: mismatch, too short, wrong current, same password; failures save nothing", async ({ browser }) => {
    const ctx = await loginContext(browser, ACC_USERS.mustGate.email);
    const page = await ctx.newPage();
    await page.goto("/change-password");
    const before = await userRow(ACC_USERS.mustGate.email);

    // Confirmation differs: message, no server call.
    await fillForm(page, ACC_PASSWORD, "Brand-New-Pass-1!", "Brand-New-Pass-2!");
    await expect(toast(page, /do not match/i)).toBeVisible();

    // Shorter than 8: the browser blocks the submit (minLength).
    await pwFields(page).nth(0).fill(ACC_PASSWORD);
    await pwFields(page).nth(1).fill("short");
    await pwFields(page).nth(2).fill("short");
    expect(await pwFields(page).nth(1).evaluate((el: HTMLInputElement) => el.validity.tooShort)).toBe(true);

    // Wrong current password.
    await fillForm(page, "not-the-password", "Brand-New-Pass-1!");
    await expect(toast(page, /current password is incorrect/i)).toBeVisible();

    // New password equals the current one.
    await fillForm(page, ACC_PASSWORD, ACC_PASSWORD);
    await expect(toast(page, /different from your current/i)).toBeVisible();

    // Still gated; nothing changed in the database.
    await expect(heading(page)).toBeVisible();
    const after = await userRow(ACC_USERS.mustGate.email);
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.mustChangePassword).toBe(true);
    expect(after.tokenVersion).toBe(before.tokenVersion);
    await ctx.close();
  });

  test("server failure while saving shows an error and changes nothing", async ({ browser }) => {
    const ctx = await loginContext(browser, ACC_USERS.mustGate.email);
    const page = await ctx.newPage();
    await page.goto("/change-password");
    const before = await userRow(ACC_USERS.mustGate.email);

    for (const mode of ["abort", "500"] as const) {
      const injected = await failServerActions(page, mode);
      await fillForm(page, ACC_PASSWORD, "Brand-New-Pass-1!");
      await expect.poll(injected.count).toBeGreaterThan(0);
      await expect(page.locator("[data-sonner-toast]").first()).toBeVisible();
      await expectNoCrash(page);
      // A toast, not the route error boundary: the form must still be usable.
      await expect(page.getByRole("heading", { name: /something went wrong/i })).toHaveCount(0);
      await expect(heading(page)).toBeVisible();
      await page.unroute("**/*");
    }
    await expect(heading(page)).toBeVisible();
    const after = await userRow(ACC_USERS.mustGate.email);
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.mustChangePassword).toBe(true);
    await ctx.close();
  });
});

test.describe("forced password change: success", () => {
  test("new password works, old one and old sessions do not, access is normal afterwards", async ({ browser, page }) => {
    const email = ACC_USERS.mustOk.email;
    const ctx = await loginContext(browser, email);
    const old = await ctx.newPage();
    await old.goto("/change-password");
    const before = await userRow(email);

    await fillForm(old, ACC_PASSWORD, ACC_NEW_PASSWORD);
    await expect(toast(old, /password updated/i)).toBeVisible();
    await expect(old).toHaveURL(/\/login$/);

    const after = await userRow(email);
    expect(after.mustChangePassword).toBe(false);
    expect(after.passwordHash).not.toBe(before.passwordHash);
    expect(after.tokenVersion).toBe(before.tokenVersion + 1);
    expect(await db.auditLog.count({ where: { action: "auth.password_change", resource: { contains: "User:" } } })).toBeGreaterThan(0);

    // The session that made the change is dead (tokenVersion bumped).
    await old.goto("/dashboard");
    await expect(old).toHaveURL(/\/login/);
    await ctx.close();

    // Old password is refused, new one signs in and the dashboard opens normally.
    await page.goto("/login");
    await submitLoginForm(page, email, ACC_PASSWORD);
    await expect(page.getByText(/invalid email\/username or password/i)).toBeVisible();
    await submitLoginForm(page, email, ACC_NEW_PASSWORD);
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/dashboard/settings");
    await expect(page).toHaveURL(/\/dashboard\/settings$/);
    // The forced page now bounces a user who has nothing to change.
    await page.goto("/change-password");
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});

test.describe("self-service password change (Settings)", () => {
  test("server failure shows an error and keeps the old password", async ({ browser }) => {
    const email = ACC_USERS.settingsPw.email;
    const ctx = await loginContext(browser, email);
    const page = await ctx.newPage();
    await page.goto("/dashboard/settings");
    const before = await userRow(email);
    await failServerActions(page, "abort");
    await pwFields(page).nth(0).fill(ACC_PASSWORD);
    // The settings page has several password inputs; the change-password card is the first group.
    await pwFields(page).nth(1).fill("Brand-New-Pass-1!");
    await pwFields(page).nth(2).fill("Brand-New-Pass-1!");
    await page.getByRole("button", { name: /update password/i }).click();
    await expect(page.locator("[data-sonner-toast]").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /something went wrong/i })).toHaveCount(0);
    await expectNoCrash(page);
    expect((await userRow(email)).passwordHash).toBe(before.passwordHash);
    await ctx.close();
  });
});
