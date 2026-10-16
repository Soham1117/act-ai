import { test, expect } from "@playwright/test";
import { expectNoCrash, failServerActions } from "./support/helpers";
import { env } from "./support/test-data";

async function submitLogin(page: import("@playwright/test").Page, id: string, password: string) {
  await page.goto("/login");
  await page.getByLabel(/email or username/i).fill(id);
  await page.getByLabel(/^password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
}

test.describe("login", () => {
  test("employee signs in with the right password", async ({ page }) => {
    await submitLogin(page, env("E2E_EMPLOYEE_EMAIL"), env("E2E_EMPLOYEE_PASSWORD"));
    await expect(page).not.toHaveURL(/\/login/);
    await expectNoCrash(page);
  });

  test("anonymous visitor is sent to the login page", async ({ page }) => {
    await page.goto("/admin/schedules");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fschedules/);
  });

  test("wrong password shows a clear error and stays on the login page", async ({ page }) => {
    await submitLogin(page, env("E2E_EMPLOYEE_EMAIL"), "definitely-wrong");
    await expect(page.getByText(/invalid email\/username or password/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("unknown user gets the same generic error", async ({ page }) => {
    await submitLogin(page, "nobody@e2e.test", "whatever-123");
    await expect(page.getByText(/invalid email\/username or password/i)).toBeVisible();
  });

  test("ex-employee with the right password is told access ended", async ({ page }) => {
    await submitLogin(page, env("E2E_INACTIVE_EMAIL"), env("E2E_INACTIVE_PASSWORD"));
    await expect(page.getByText(/no longer has access/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("too many wrong attempts locks the account out for a while", async ({ page }) => {
    // Limit is 8 attempts per identifier; use a throwaway identifier so the
    // real test users stay usable.
    await page.goto("/login");
    for (let i = 0; i < 9; i++) {
      await page.getByLabel(/email or username/i).fill("lockout@e2e.test");
      await page.getByLabel(/^password/i).fill(`wrong-${i}`);
      await page.getByRole("button", { name: /sign in/i }).click();
      await expect(page.getByText(/invalid email\/username or password|too many attempts/i)).toBeVisible();
    }
    await expect(page.getByText(/too many attempts/i)).toBeVisible();
  });

  test("server failure during login shows an error instead of crashing", async ({ page }) => {
    await page.goto("/login");
    await failServerActions(page, "abort");
    await page.getByLabel(/email or username/i).fill(env("E2E_EMPLOYEE_EMAIL"));
    await page.getByLabel(/^password/i).fill(env("E2E_EMPLOYEE_PASSWORD"));
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByText(/something went wrong|try again|connection|network/i).first()).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    await expectNoCrash(page);
  });
});
