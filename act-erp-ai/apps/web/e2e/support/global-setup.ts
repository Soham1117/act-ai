import { execSync } from "node:child_process";
import { chromium } from "@playwright/test";
import { ADMIN_STATE, BASE_URL, env } from "./test-data";

/**
 * Runs once before all tests (the web server is already up):
 * 1. Reset the test database to the known seed state.
 * 2. Sign in as the admin once and save the session for admin specs.
 */
export default async function globalSetup() {
  try {
    execSync("pnpm e2e:db", { stdio: "pipe" });
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    console.error(String(e.stdout ?? ""), String(e.stderr ?? ""));
    throw err;
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL: BASE_URL });
  await page.goto("/login");
  await page.getByLabel(/email or username/i).fill(env("E2E_ADMIN_EMAIL"));
  await page.getByLabel(/^password/i).fill(env("E2E_ADMIN_PASSWORD"));
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.context().storageState({ path: ADMIN_STATE });
  await browser.close();
}
