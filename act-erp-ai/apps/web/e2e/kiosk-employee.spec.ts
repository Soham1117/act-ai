import { test, expect, type Page } from "@playwright/test";
import { db } from "./support/db";
import { expectNoCrash, failServerActions, openKiosk, toast } from "./support/helpers";
import {
  EMPLOYEE,
  INACTIVE_EMPLOYEE,
  KIOSK_ACTIVE_SLUG,
  PIN_EMPLOYEE,
  WRONG_PIN,
  env,
} from "./support/test-data";

const pinInput = (page: Page) => page.getByPlaceholder("••••");

/** Pick the employee card, type the PIN, and press the named action button. */
async function selectAndEnterPin(page: Page, name: string, pin: string) {
  await page.getByRole("button", { name: new RegExp(name) }).first().click();
  await expect(pinInput(page)).toBeVisible();
  await pinInput(page).fill(pin);
}

async function punchCount() {
  return db.timeEntry.count({ where: { employee: { employeeId: EMPLOYEE.employeeId } } });
}

test.describe("kiosk: employee clock in/out with PIN", () => {
  test("employee clocks in, takes a break, and clocks out; photos are sent", async ({
    browser,
  }) => {
    const page = await openKiosk(browser, KIOSK_ACTIVE_SLUG);
    const pin = env("E2E_EMPLOYEE_PIN");

    // Clock in. The fake camera must produce a JPEG that goes to the server.
    await selectAndEnterPin(page, EMPLOYEE.name, pin);
    await expect(page.locator("video")).toBeVisible();
    const photoRequest = page.waitForRequest(
      (r) => r.method() === "POST" && (r.postData() ?? "").includes("data:image/jpeg"),
      { timeout: 20_000 },
    );
    await page.getByRole("button", { name: /^clock in$/i }).click();
    await photoRequest;
    await expect(toast(page, /clocked in/i)).toBeVisible();
    const open = await db.timeEntry.findFirstOrThrow({
      where: { employee: { employeeId: EMPLOYEE.employeeId }, status: "ACTIVE" },
    });
    expect(open.source).toBe("KIOSK");
    expect(open.jobCode).toBe("E2E100");

    // Break.
    await selectAndEnterPin(page, EMPLOYEE.name, pin);
    await page.getByRole("button", { name: /^break$/i }).click();
    await expect(toast(page, /break started/i)).toBeVisible();

    // End break.
    await selectAndEnterPin(page, EMPLOYEE.name, pin);
    await page.getByRole("button", { name: /end break/i }).click();
    await expect(toast(page, /break ended/i)).toBeVisible();

    // Clock out.
    await selectAndEnterPin(page, EMPLOYEE.name, pin);
    await page.getByRole("button", { name: /^clock out$/i }).click();
    await expect(toast(page, /clocked out/i)).toBeVisible();
    const done = await db.timeEntry.findUniqueOrThrow({ where: { id: open.id } });
    expect(done.clockOut).not.toBeNull();
    expect(done.status).not.toBe("ACTIVE");
    await page.context().close();
  });

  test("wrong PIN is refused with a clear message and nothing is recorded", async ({ browser }) => {
    const page = await openKiosk(browser, KIOSK_ACTIVE_SLUG);
    const before = await punchCount();
    await selectAndEnterPin(page, EMPLOYEE.name, WRONG_PIN);
    await page.getByRole("button", { name: /^clock in$/i }).click();
    await expect(toast(page, /incorrect pin/i)).toBeVisible();
    expect(await punchCount()).toBe(before);
    await page.context().close();
  });

  test("inactive employee typing their ID is told to see an admin", async ({ browser }) => {
    const page = await openKiosk(browser, KIOSK_ACTIVE_SLUG);
    // Inactive people are not on the roster, so they can only get in by ID.
    await expect(page.getByText(INACTIVE_EMPLOYEE.name)).toHaveCount(0);
    await page.getByRole("button", { name: /enter id/i }).click();
    await page.getByPlaceholder("Full ID or last digits").fill(INACTIVE_EMPLOYEE.employeeId);
    await page.getByPlaceholder("Full ID or last digits").press("Enter");
    await expect(toast(page, /isn.t active for kiosk use/i)).toBeVisible();
    await expect(pinInput(page)).toHaveCount(0);
    await page.context().close();
  });

  test("unknown employee ID is rejected", async ({ browser }) => {
    const page = await openKiosk(browser, KIOSK_ACTIVE_SLUG);
    await page.getByRole("button", { name: /enter id/i }).click();
    await page.getByPlaceholder("Full ID or last digits").fill("EMP-2026-9999");
    await page.getByPlaceholder("Full ID or last digits").press("Enter");
    await expect(toast(page, /unknown employee id/i)).toBeVisible();
    await page.context().close();
  });

  test("employee with no kiosk PIN is told to ask an admin", async ({ browser }) => {
    const page = await openKiosk(browser, KIOSK_ACTIVE_SLUG);
    await page.getByRole("button", { name: new RegExp(PIN_EMPLOYEE.name) }).first().click();
    await expect(page.getByText(/no kiosk pin set/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^clock in$/i })).toBeDisabled();
    await page.context().close();
  });

  test("network failure while punching shows an error and records nothing", async ({
    browser,
  }) => {
    const page = await openKiosk(browser, KIOSK_ACTIVE_SLUG);
    const before = await punchCount();
    await selectAndEnterPin(page, EMPLOYEE.name, env("E2E_EMPLOYEE_PIN"));
    await failServerActions(page, "abort");
    await page.getByRole("button", { name: /^clock in$/i }).click();
    await expect(page.getByText(/something went wrong|try again/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect(await punchCount()).toBe(before);
    await page.context().close();
  });

  test("a device without the kiosk cookie cannot punch", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/kiosk/${KIOSK_ACTIVE_SLUG}`);
    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });
});
