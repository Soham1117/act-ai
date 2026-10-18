import { test, expect, type Locator, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { db } from "./support/db";
import { NETWORK_ERROR, STALE_ERROR } from "./support/action-errors";
import { delayServerActions, expectNoCrash, failServerActions, toast } from "./support/helpers";
import { ADMIN_STATE, env } from "./support/test-data";
import { SS, empDbId, labelled, loginState } from "./support/self-service";

// Employee settings: kiosk PIN, personal email, consents, password. Dedicated employees: Sam, Pam.
test.use({ storageState: "e2e/.auth/sam.json" });

let samId: string;
let samUserId: string;

test.beforeAll(async ({ browser }) => {
  await loginState(browser, SS.sam, "sam");
  samId = await empDbId(SS.sam);
  samUserId = (await db.employee.findUniqueOrThrow({ where: { id: samId } })).userId;
});

test.beforeEach(async () => {
  await db.employee.update({ where: { id: samId }, data: { personalEmail: null, w2ConsentAt: null, benefitsEConsentAt: null } });
});

const card = (page: Page, title: string): Locator =>
  page.getByText(title, { exact: true }).first().locator("xpath=ancestor::div[contains(@class,'rounded')][1]");
const pinHash = async () => (await db.employee.findUniqueOrThrow({ where: { id: samId } })).kioskPinHash;

async function setPin(page: Page, password: string, pin: string, confirm = pin) {
  await page.goto("/dashboard/settings");
  const c = card(page, "Kiosk PIN");
  await labelled(c, "Current password").fill(password);
  await labelled(c, "New PIN (4-6 digits)").fill(pin);
  await labelled(c, "Confirm PIN").fill(confirm);
  return c;
}

test.describe("settings: kiosk PIN", () => {
  test("sets a new PIN: stored as a hash, audited, and the form is cleared", async ({ page }) => {
    const c = await setPin(page, SS.sam.password, "7391");
    await c.getByRole("button", { name: "Set PIN" }).click();
    await expect(toast(page, "Kiosk PIN set")).toBeVisible();
    expect(await bcrypt.compare("7391", (await pinHash())!)).toBe(true);
    expect(await db.auditLog.count({ where: { action: "kiosk.pin_set", resource: `Employee:${samId}` } })).toBeGreaterThan(0);
    await expect(labelled(c, "Current password")).toHaveValue("");
  });

  test("the PIN field keeps digits only and at most 6", async ({ page }) => {
    const c = await setPin(page, "x", "");
    await labelled(c, "New PIN (4-6 digits)").fill("12ab34");
    await expect(labelled(c, "New PIN (4-6 digits)")).toHaveValue("1234");
    await labelled(c, "New PIN (4-6 digits)").fill("1234567");
    await expect(labelled(c, "New PIN (4-6 digits)")).toHaveValue("123456");
  });

  test("Set PIN is disabled until password and PIN are typed", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await expect(card(page, "Kiosk PIN").getByRole("button", { name: "Set PIN" })).toBeDisabled();
  });

  test("3 digits and mismatched confirmation are caught in the form", async ({ page }) => {
    const before = await pinHash();
    let c = await setPin(page, SS.sam.password, "123");
    await c.locator("form").evaluate((f) => ((f as HTMLFormElement).noValidate = true));
    await c.getByRole("button", { name: "Set PIN" }).click();
    await expect(toast(page, "PIN must be 4-6 digits")).toBeVisible();
    c = await setPin(page, SS.sam.password, "7391", "7392");
    await c.getByRole("button", { name: "Set PIN" }).click();
    await expect(toast(page, "PINs do not match")).toBeVisible();
    expect(await pinHash()).toBe(before);
  });

  const WEAK: [string, string, string][] = [
    ["3214", "the temporary PIN", "Choose a PIN different from the temporary one."],
    ["1111", "a repeated digit", "That PIN is too easy to guess (repeated digit)."],
    ["1234", "an ascending run", "That PIN is too easy to guess (simple sequence)."],
    ["4321", "a descending run", "That PIN is too easy to guess (simple sequence)."],
    ["1212", "a repeating pair", "That PIN is too easy to guess (repeating pattern)."],
    ["123123", "a repeated triple", "That PIN is too easy to guess (repeating pattern)."],
  ];
  for (const [pin, why, message] of WEAK) {
    test(`refuses ${pin} (${why}) and keeps the old PIN`, async ({ page }) => {
      const before = await pinHash();
      const c = await setPin(page, SS.sam.password, pin);
      await c.getByRole("button", { name: "Set PIN" }).click();
      await expect(toast(page, message)).toBeVisible();
      expect(await pinHash()).toBe(before);
    });
  }

  test("a wrong current password is refused and the PIN is unchanged", async ({ page }) => {
    const before = await pinHash();
    const c = await setPin(page, "not-my-password", "7391");
    await c.getByRole("button", { name: "Set PIN" }).click();
    await expect(toast(page, "Current password is incorrect. Re-enter your password and try again.")).toBeVisible();
    expect(await pinHash()).toBe(before);
  });

  test("the old PIN no longer matches after a change", async ({ page }) => {
    const c = await setPin(page, SS.sam.password, "7391");
    await c.getByRole("button", { name: "Set PIN" }).click();
    await expect(toast(page, "Kiosk PIN set")).toBeVisible();
    expect(await bcrypt.compare(env("E2E_EMPLOYEE_PIN"), (await pinHash())!)).toBe(false);
  });

  test("failures: dropped connection, 500, stale deployment, double click", async ({ page }) => {
    const before = await pinHash();
    let c = await setPin(page, SS.sam.password, "7391");
    await failServerActions(page, "abort", { match: "7391" });
    await c.getByRole("button", { name: "Set PIN" }).click();
    await expect(toast(page, NETWORK_ERROR)).toBeVisible();
    await expectNoCrash(page);
    // The form keeps what was typed.
    await expect(labelled(c, "Current password")).toHaveValue(SS.sam.password);
    expect(await pinHash()).toBe(before);

    await page.unroute("**/*");
    c = await setPin(page, SS.sam.password, "7391");
    await failServerActions(page, "stale", { match: "7391" });
    await c.getByRole("button", { name: "Set PIN" }).click();
    await expect(toast(page, STALE_ERROR)).toBeVisible();
    await expectNoCrash(page);
    expect(await pinHash()).toBe(before);

    await page.unroute("**/*");
    c = await setPin(page, SS.sam.password, "7391");
    const slow = await delayServerActions(page, 1500);
    await c.getByRole("button", { name: "Set PIN" }).dblclick();
    await expect(toast(page, "Kiosk PIN set")).toBeVisible();
    expect(slow.count()).toBe(1);
  });
});

test.describe("settings: personal email and consents", () => {
  async function emailForm(page: Page, email: string, password: string) {
    await page.goto("/dashboard/settings");
    const c = card(page, "Two-factor authentication");
    await labelled(c, /Personal email/).fill(email);
    await labelled(c, "Current password").fill(password);
    return c;
  }

  test("saves a personal email; a wrong password changes nothing", async ({ page }) => {
    let c = await emailForm(page, "sam.personal@example.com", "wrong-password");
    await c.getByRole("button", { name: "Update" }).click();
    await expect(toast(page, "Current password is incorrect. Re-enter it and try again.")).toBeVisible();
    expect((await db.employee.findUniqueOrThrow({ where: { id: samId } })).personalEmail).toBeNull();
    c = await emailForm(page, "sam.personal@example.com", SS.sam.password);
    await c.getByRole("button", { name: "Update" }).click();
    await expect(toast(page, "Personal email updated")).toBeVisible();
    expect((await db.employee.findUniqueOrThrow({ where: { id: samId } })).personalEmail).toBe("sam.personal@example.com");
    expect(await db.auditLog.count({ where: { action: "employee.personal_email_update", resource: `Employee:${samId}` } })).toBeGreaterThan(0);
  });

  test("an invalid address is refused by the server; clearing the email is allowed while 2FA is off", async ({ page }) => {
    const c = await emailForm(page, "not-an-email", SS.sam.password);
    await c.locator("form").evaluate((f) => ((f as HTMLFormElement).noValidate = true));
    await c.getByRole("button", { name: "Update" }).click();
    await expect(toast(page, "Enter a valid personal email address (codes are sent here for sign-in).")).toBeVisible();
    expect((await db.employee.findUniqueOrThrow({ where: { id: samId } })).personalEmail).toBeNull();

    await db.employee.update({ where: { id: samId }, data: { personalEmail: "old@example.com" } });
    const c2 = await emailForm(page, "", SS.sam.password);
    await c2.getByRole("button", { name: "Update" }).click();
    await expect(toast(page, "Personal email updated")).toBeVisible();
    expect((await db.employee.findUniqueOrThrow({ where: { id: samId } })).personalEmail).toBeNull();
  });

  test("Update is disabled while the email is unchanged", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await expect(card(page, "Two-factor authentication").getByRole("button", { name: "Update" })).toBeDisabled();
  });

  test("W-2 electronic delivery: consent and withdraw", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await page.getByRole("button", { name: "I consent to electronic W-2 delivery" }).click();
    await expect(toast(page, "Electronic W-2 delivery enabled")).toBeVisible();
    await expect(page.getByText("Consented — electronic delivery on").first()).toBeVisible();
    expect((await db.employee.findUniqueOrThrow({ where: { id: samId } })).w2ConsentAt).not.toBeNull();
    expect(await db.auditLog.count({ where: { action: "employee.w2_consent_given", resource: `Employee:${samId}` } })).toBeGreaterThan(0);
    await page.getByRole("button", { name: /Withdraw consent/ }).click();
    await expect(toast(page, "Reverted to paper W-2 delivery")).toBeVisible();
    expect((await db.employee.findUniqueOrThrow({ where: { id: samId } })).w2ConsentAt).toBeNull();
  });

  test("benefits document delivery: consent and withdraw", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await page.getByRole("button", { name: "I consent to electronic benefits document delivery" }).click();
    await expect(toast(page, "Electronic benefits document delivery enabled")).toBeVisible();
    expect((await db.employee.findUniqueOrThrow({ where: { id: samId } })).benefitsEConsentAt).not.toBeNull();
    await page.getByRole("button", { name: /Withdraw consent/ }).click();
    await expect(toast(page, "Reverted to paper delivery for benefits documents")).toBeVisible();
    expect((await db.employee.findUniqueOrThrow({ where: { id: samId } })).benefitsEConsentAt).toBeNull();
  });

  test("consent: dropped connection leaves it off; double click records once", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await failServerActions(page, "abort", { times: 1 });
    await page.getByRole("button", { name: "I consent to electronic W-2 delivery" }).click();
    await expect(toast(page, NETWORK_ERROR)).toBeVisible();
    await expectNoCrash(page);
    expect((await db.employee.findUniqueOrThrow({ where: { id: samId } })).w2ConsentAt).toBeNull();
    await page.unroute("**/*");
    await page.goto("/dashboard/settings");
    const slow = await delayServerActions(page, 1500);
    await page.getByRole("button", { name: "I consent to electronic W-2 delivery" }).dblclick();
    await expect(toast(page, "Electronic W-2 delivery enabled")).toBeVisible();
    expect(slow.count()).toBe(1);
  });

  test("the settings page shows the account details and the kiosk PIN hint", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await expect(page.getByText(SS.sam.email)).toBeVisible();
    await expect(page.getByText(SS.sam.name, { exact: true })).toBeVisible();
    await expect(page.getByText("Your temporary PIN is 3214.")).toBeVisible();
  });
});

test.describe("settings: password", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  async function change(c: Locator, current: string, next: string, confirm = next) {
    await labelled(c, "Current password").fill(current);
    await labelled(c, "New password").fill(next);
    await labelled(c, "Confirm password").fill(confirm);
    await c.getByRole("button", { name: "Update password" }).click();
  }
  const passwordHash = async () => (await db.user.findUniqueOrThrow({ where: { id: samUserId } })).passwordHash;

  test("validation messages and nothing changes", async ({ browser }) => {
    const state = await loginState(browser, SS.pam, "pam");
    const ctx = await browser.newContext({ storageState: state });
    const page = await ctx.newPage();
    await page.goto("/dashboard/settings");
    const c = card(page, "Password");
    await c.locator("form").evaluate((f) => ((f as HTMLFormElement).noValidate = true));
    const pam = await db.user.findFirstOrThrow({ where: { email: SS.pam.email } });
    await change(c, SS.pam.password, "Another-Pass-1!", "Different-Pass-1!");
    await expect(toast(page, "Passwords do not match")).toBeVisible();
    await change(c, SS.pam.password, "short", "short");
    await expect(toast(page, "Min 8 characters")).toBeVisible();
    await change(c, SS.pam.password, SS.pam.password);
    await expect(toast(page, "Choose a new password that is different from your current one.")).toBeVisible();
    await change(c, SS.pam.password, "p".repeat(73));
    await expect(toast(page, "New password is too long (max 72 characters).")).toBeVisible();
    await change(c, "wrong-current-pass", "Another-Pass-1!");
    await expect(toast(page, "Current password is incorrect. Re-enter it and try again.")).toBeVisible();
    expect((await db.user.findUniqueOrThrow({ where: { id: pam.id } })).passwordHash).toBe(pam.passwordHash);
    await ctx.close();
  });

  test("changing the password signs everyone out; the new one works and the old one does not", async ({ browser }) => {
    const state = await loginState(browser, SS.pam, "pam");
    const ctx = await browser.newContext({ storageState: state });
    const page = await ctx.newPage();
    await page.goto("/dashboard/settings");
    const c = card(page, "Password");
    const newPassword = "Brand-New-Pass-9!";
    await change(c, SS.pam.password, newPassword);
    await expect(toast(page, "Password updated — please sign in again")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    const pam = await db.user.findFirstOrThrow({ where: { email: SS.pam.email } });
    expect(await bcrypt.compare(newPassword, pam.passwordHash!)).toBe(true);
    expect(pam.mustChangePassword).toBe(false);
    expect(await db.auditLog.count({ where: { action: "auth.password_change", resource: `User:${pam.id}` } })).toBeGreaterThan(0);
    // The old session is dead.
    await page.goto("/dashboard/settings");
    await expect(page).toHaveURL(/\/login/);
    await ctx.close();
    // New password signs in; old one is refused.
    const fresh = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const lp = await fresh.newPage();
    await lp.goto("/login");
    await lp.getByLabel(/email or username/i).fill(SS.pam.email);
    await lp.getByLabel(/^password/i).fill(SS.pam.password);
    await lp.getByRole("button", { name: /sign in/i }).click();
    await expect(lp.getByText(/invalid email\/username or password/i)).toBeVisible();
    await lp.getByLabel(/^password/i).fill(newPassword);
    await lp.getByRole("button", { name: /sign in/i }).click();
    await expect(lp).not.toHaveURL(/\/login/);
    await fresh.close();
    // Put the original password back for any re-run.
    await db.user.update({ where: { id: pam.id }, data: { passwordHash: await bcrypt.hash(SS.pam.password, 4), mustChangePassword: false } });
  });

  test("failure: dropped connection while updating the password", async ({ browser }) => {
    const state = await loginState(browser, SS.pam, "pam");
    const ctx = await browser.newContext({ storageState: state });
    const page = await ctx.newPage();
    await page.goto("/dashboard/settings");
    const c = card(page, "Password");
    const pam = await db.user.findFirstOrThrow({ where: { email: SS.pam.email } });
    // Match on the new password so an unrelated background server action cannot use up the injected failure.
    await failServerActions(page, "abort", { match: "Another-Pass-1!" });
    await change(c, SS.pam.password, "Another-Pass-1!");
    // The form catches the dropped connection and shows a plain message (not the raw "Failed to fetch").
    await expect(toast(page, "Could not reach the server. Check the connection and try again.")).toBeVisible();
    await expectNoCrash(page);
    expect((await db.user.findUniqueOrThrow({ where: { id: pam.id } })).passwordHash).toBe(pam.passwordHash);
    await ctx.close();
  });

  test("too many wrong current passwords locks the form for a while", async ({ page }) => {
    // Use Sam (his own session file) so Pam's tests above are not affected.
    await page.context().addCookies(JSON.parse(await (await import("node:fs/promises")).readFile("e2e/.auth/sam.json", "utf8")).cookies);
    await page.goto("/dashboard/settings");
    const c = card(page, "Password");
    const before = await passwordHash();
    for (let i = 0; i < 8; i++) {
      await change(c, "wrong-current-pass", "Another-Pass-1!");
      await expect(toast(page, "Current password is incorrect. Re-enter it and try again.")).toBeVisible();
      await page.locator("[data-sonner-toast]").first().waitFor({ state: "detached", timeout: 10_000 }).catch(() => null);
    }
    await change(c, "wrong-current-pass", "Another-Pass-1!");
    await expect(toast(page, "Too many attempts. Try again in a few minutes.")).toBeVisible();
    expect(await passwordHash()).toBe(before);
  });
});

test.describe("settings: admin password form", () => {
  test.use({ storageState: ADMIN_STATE });
  test("a wrong current password is refused for the admin too (admin password stays unchanged)", async ({ page }) => {
    await page.goto("/admin/settings");
    const c = card(page, "Change password");
    await labelled(c, "Current password").fill("wrong-current-pass");
    await labelled(c, "New password").fill("Another-Pass-1!");
    await labelled(c, "Confirm password").fill("Another-Pass-1!");
    await c.getByRole("button", { name: "Update password" }).click();
    await expect(toast(page, "Current password is incorrect. Re-enter it and try again.")).toBeVisible();
  });
});
