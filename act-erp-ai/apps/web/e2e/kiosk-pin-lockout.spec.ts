import { test, expect, type Page } from "@playwright/test";
import {
  EMP,
  IP_LOCK_EMPS,
  auditCount,
  cardWithPin,
  clockInBtn,
  clockOutBtn,
  empRow,
  entriesOf,
  openCard,
  openK,
  pinInput,
  resetEmployee,
  typePin,
  type Emp,
} from "./support/kiosk";
import { WRONG_PIN, env } from "./support/test-data";

const PIN = env("E2E_EMPLOYEE_PIN");
const LOCKED = /too many incorrect pin attempts\. try again in about [1-5] minutes?/i;

/** One wrong PIN on the open card; waits until the server has counted it. */
async function wrongAttempt(page: Page, e: Emp, nth: number, out = false) {
  await typePin(page, WRONG_PIN);
  await (out ? clockOutBtn(page) : clockInBtn(page)).click();
  const id = (await empRow(e)).id;
  await expect.poll(() => auditCount("kiosk.pin_failed", id)).toBe(nth);
  await expect(pinInput(page)).toHaveValue(""); // the field is cleared after a failure
}

test.describe("kiosk PIN lockout", () => {
  test.beforeEach(async () => {
    for (const e of [EMP.lockA, EMP.lockB, ...IP_LOCK_EMPS]) await resetEmployee(e);
  });

  test("5 wrong PINs lock the employee: the right PIN is refused too, others are not affected", async ({
    browser,
  }) => {
    const page = await openK(browser, "lock-emp");
    await openCard(page, EMP.lockA);
    for (let n = 1; n <= 5; n++) await wrongAttempt(page, EMP.lockA, n);

    // 6th try with the CORRECT PIN: still refused, with the wait time.
    await typePin(page, PIN);
    await clockInBtn(page).click();
    await expect(page.getByText(LOCKED).first()).toBeVisible();
    expect(await entriesOf(EMP.lockA)).toHaveLength(0);
    // Refused attempts while locked are not extra "failures".
    expect(await auditCount("kiosk.pin_failed", (await empRow(EMP.lockA)).id)).toBe(5);

    // Another person on the same kiosk can still clock in.
    await page.getByRole("button", { name: /^cancel$/i }).click();
    await cardWithPin(page, EMP.lockB, PIN);
    await clockInBtn(page).click();
    await expect(page.getByText(/clocked in/i).first()).toBeVisible();
    expect(await entriesOf(EMP.lockB)).toHaveLength(1);
    await page.context().close();
  });

  test("the lockout belongs to one kiosk: the same person is fine at another kiosk", async ({ browser }) => {
    const page = await openK(browser, "lock-emp2");
    await openCard(page, EMP.lockA);
    for (let n = 1; n <= 5; n++) await wrongAttempt(page, EMP.lockA, n);
    await typePin(page, PIN);
    await clockInBtn(page).click();
    await expect(page.getByText(LOCKED).first()).toBeVisible();
    await page.context().close();

    const other = await openK(browser, "lock-reset");
    await cardWithPin(other, EMP.lockA, PIN);
    await clockInBtn(other).click();
    await expect(other.getByText(/clocked in/i).first()).toBeVisible();
    expect(await entriesOf(EMP.lockA)).toHaveLength(1);
    await other.context().close();
  });

  test("a successful punch clears earlier wrong attempts", async ({ browser }) => {
    const page = await openK(browser, "lock-reset");
    await openCard(page, EMP.lockB);
    for (let n = 1; n <= 4; n++) await wrongAttempt(page, EMP.lockB, n);
    await typePin(page, PIN);
    await clockInBtn(page).click();
    await expect(page.getByText(/clocked in/i).first()).toBeVisible();

    // Four more wrong tries would be 8 in total if the counter were not cleared.
    await openCard(page, EMP.lockB);
    for (let n = 5; n <= 8; n++) await wrongAttempt(page, EMP.lockB, n, true);
    await typePin(page, PIN);
    await clockOutBtn(page).click();
    await expect(page.getByText(/clocked out/i).first()).toBeVisible();
    expect(await entriesOf(EMP.lockB)).toHaveLength(1);
    await page.context().close();
  });

  test("20 wrong PINs from one device lock the whole kiosk for that device; another device still works", async ({
    browser,
  }) => {
    const page = await openK(browser, "lock-ip", { ip: "10.99.1.40" });
    let n = 0;
    for (const e of IP_LOCK_EMPS.slice(0, 4)) {
      await openCard(page, e);
      for (let i = 1; i <= 5; i++) {
        await typePin(page, WRONG_PIN);
        await clockInBtn(page).click();
        n += 1;
        await expect(pinInput(page)).toHaveValue("");
      }
      await page.getByRole("button", { name: /^cancel$/i }).click();
    }
    expect(n).toBe(20);

    // A fifth person with a fresh counter is refused anyway: the device is locked.
    const fifth = IP_LOCK_EMPS[4]!;
    await cardWithPin(page, fifth, PIN);
    await clockInBtn(page).click();
    await expect(page.getByText(LOCKED).first()).toBeVisible();
    expect(await entriesOf(fifth)).toHaveLength(0);
    await page.context().close();

    // The same kiosk used from a different device address is not locked.
    const other = await openK(browser, "lock-ip", { ip: "10.99.1.41" });
    await cardWithPin(other, fifth, PIN);
    await clockInBtn(other).click();
    await expect(other.getByText(/clocked in/i).first()).toBeVisible();
    expect(await entriesOf(fifth)).toHaveLength(1);
    await other.context().close();
  });
});
