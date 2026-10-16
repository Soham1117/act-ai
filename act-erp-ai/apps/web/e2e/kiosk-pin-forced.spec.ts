import { test, expect, type Page } from "@playwright/test";
import { delayServerActions, expectNoCrash, failServerActions, toast } from "./support/helpers";
import {
  EMP,
  NEW_PIN,
  TEMP_PIN,
  auditCount,
  cancelBtn,
  cardWithPin,
  clockInBtn,
  clockOutBtn,
  empRow,
  entriesOf,
  openCard,
  openEntry,
  openK,
  pinInput,
  pinMatches,
  resetEmployee,
  setPin,
  typePin,
} from "./support/kiosk";

const newPinInput = (p: Page) => p.getByPlaceholder("New PIN");
const confirmInput = (p: Page) => p.getByPlaceholder("Confirm PIN");
const saveBtn = (p: Page) => p.getByRole("button", { name: /save pin and continue/i });

async function fillNew(p: Page, pin: string, confirm = pin) {
  await newPinInput(p).fill(pin);
  await confirmInput(p).fill(confirm);
}

/** Open the card on the temporary PIN and press Clock in to reach the "new PIN" step. */
async function toNewPinStep(p: Page) {
  await cardWithPin(p, EMP.temp, TEMP_PIN);
  await clockInBtn(p).click();
  await expect(p.getByText("Choose your new PIN")).toBeVisible();
}

test.describe("kiosk: forced PIN change on the temporary PIN", () => {
  test.beforeEach(async () => {
    await resetEmployee(EMP.temp, TEMP_PIN);
  });

  test("temporary PIN: card asks for it, the next step asks for a new one, Cancel changes nothing", async ({
    browser,
  }) => {
    const page = await openK(browser, "temp-mismatch");
    await openCard(page, EMP.temp);
    await expect(page.getByText("Enter the temporary PIN from your admin")).toBeVisible();
    await typePin(page, TEMP_PIN);
    await clockInBtn(page).click();
    await expect(page.getByText("Choose your new PIN")).toBeVisible();
    await expect(page.getByText(/no 1234 or 0000/i)).toBeVisible();
    await expect(clockInBtn(page)).toBeHidden(); // punch buttons are hidden on this step
    await expect(saveBtn(page)).toBeDisabled();

    // Digits only, at most 6; fewer than 4 keeps the button off.
    await newPinInput(page).pressSequentially("a1b2");
    await expect(newPinInput(page)).toHaveValue("12");
    await newPinInput(page).fill("12345678");
    await expect(newPinInput(page)).toHaveValue("123456");
    await fillNew(page, "739", "739");
    await expect(saveBtn(page)).toBeDisabled();

    await cancelBtn(page).click();
    await expect(page.getByPlaceholder(/search by name/i)).toBeVisible();
    expect(await pinMatches(EMP.temp, TEMP_PIN)).toBe(true);
    expect(await entriesOf(EMP.temp)).toHaveLength(0);
    await page.context().close();
  });

  test("the two new PINs must match (no request is sent)", async ({ browser }) => {
    const page = await openK(browser, "temp-mismatch");
    await toNewPinStep(page);
    let actions = 0;
    page.on("request", (r) => {
      if (r.method() === "POST" && "next-action" in r.headers()) actions += 1;
    });
    await fillNew(page, NEW_PIN, "7392");
    await saveBtn(page).click();
    await expect(toast(page, /the two pins do not match\. re-enter them/i)).toBeVisible();
    expect(actions).toBe(0);
    expect(await pinMatches(EMP.temp, TEMP_PIN)).toBe(true);
    expect(await entriesOf(EMP.temp)).toHaveLength(0);
    await page.context().close();
  });

  const weak: [string, RegExp][] = [
    ["1234", /simple sequence/i],
    ["4321", /simple sequence/i],
    ["456789", /simple sequence/i],
    ["1111", /repeated digit/i],
    ["000000", /repeated digit/i],
    ["1212", /repeating pattern/i],
    ["123123", /repeating pattern/i],
    ["3214", /different from the temporary one/i],
  ];
  test("weak new PINs are refused with a reason; the temporary PIN stays and nothing is punched", async ({
    browser,
  }) => {
    const page = await openK(browser, "temp-weak");
    await toNewPinStep(page);
    for (const [pin, message] of weak) {
      await fillNew(page, pin);
      await saveBtn(page).click();
      await expect(toast(page, message)).toBeVisible();
      await expect(page.getByText("Choose your new PIN")).toBeVisible(); // still on this step
    }
    expect(await pinMatches(EMP.temp, TEMP_PIN)).toBe(true);
    expect(await entriesOf(EMP.temp)).toHaveLength(0);
    expect(await auditCount("kiosk.pin_changed", (await empRow(EMP.temp)).id)).toBe(0);
    await page.context().close();
  });

  test("a good new PIN is saved, the punch goes through, and only the new PIN works afterwards", async ({
    browser,
  }) => {
    const page = await openK(browser, "temp-ok");
    await toNewPinStep(page);
    await fillNew(page, NEW_PIN);
    await saveBtn(page).click();
    await expect(toast(page, /pin updated/i)).toBeVisible();
    await expect(toast(page, /clocked in/i)).toBeVisible();

    expect(await pinMatches(EMP.temp, NEW_PIN)).toBe(true);
    expect(await pinMatches(EMP.temp, TEMP_PIN)).toBe(false);
    const entries = await entriesOf(EMP.temp);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ status: "ACTIVE", source: "KIOSK" });
    expect(await auditCount("kiosk.pin_changed", (await empRow(EMP.temp)).id)).toBe(1);

    // Next visit: no "temporary" wording, the old PIN is refused, the new one works.
    await openCard(page, EMP.temp);
    await expect(page.getByText("Enter your PIN to confirm")).toBeVisible();
    await typePin(page, TEMP_PIN);
    await clockOutBtn(page).click();
    await expect(toast(page, /incorrect pin/i)).toBeVisible();
    await typePin(page, NEW_PIN);
    await clockOutBtn(page).click();
    await expect(toast(page, /clocked out/i)).toBeVisible();
    expect((await entriesOf(EMP.temp))[0]!.status).toBe("COMPLETED");
    await page.context().close();
  });

  test("temporary PIN while clocked in: Clock out also asks for a new PIN first", async ({ browser }) => {
    await openEntry(EMP.temp, 90);
    const page = await openK(browser, "temp-ok");
    await cardWithPin(page, EMP.temp, TEMP_PIN);
    await clockOutBtn(page).click();
    await expect(page.getByText("Choose your new PIN")).toBeVisible();
    expect((await entriesOf(EMP.temp))[0]!.status).toBe("ACTIVE"); // not yet
    await fillNew(page, NEW_PIN);
    await saveBtn(page).click();
    await expect(toast(page, /clocked out/i)).toBeVisible();
    expect((await entriesOf(EMP.temp))[0]!.status).toBe("COMPLETED");
    await page.context().close();
  });

  test("a wrong temporary PIN is caught at the save step and sends the person back to the PIN field", async ({
    browser,
  }) => {
    const page = await openK(browser, "temp-wrong");
    await cardWithPin(page, EMP.temp, "9999");
    await clockInBtn(page).click();
    await expect(page.getByText("Choose your new PIN")).toBeVisible(); // not verified yet
    await fillNew(page, NEW_PIN);
    await saveBtn(page).click();
    await expect(toast(page, /incorrect pin/i)).toBeVisible();
    await expect(pinInput(page)).toBeVisible();
    await expect(pinInput(page)).toHaveValue("");
    expect(await pinMatches(EMP.temp, TEMP_PIN)).toBe(true);
    expect(await entriesOf(EMP.temp)).toHaveLength(0);
    await page.context().close();
  });

  test("PIN reset to the temporary one after the card opened: punching with it is refused", async ({
    browser,
  }) => {
    await setPin(EMP.temp, NEW_PIN);
    const page = await openK(browser, "temp-stale");
    await cardWithPin(page, EMP.temp, TEMP_PIN);
    await setPin(EMP.temp, TEMP_PIN); // an admin resets the PIN while the card is open
    await clockInBtn(page).click();
    await expect(toast(page, /you must set a new pin before you can clock in or out/i)).toBeVisible();
    expect(await entriesOf(EMP.temp)).toHaveLength(0);
    await page.context().close();
  });

  test("PIN already changed after the card opened: the change is refused with an explanation", async ({
    browser,
  }) => {
    const page = await openK(browser, "temp-stale");
    await openCard(page, EMP.temp);
    await setPin(EMP.temp, NEW_PIN); // changed from another place (portal settings)
    await typePin(page, NEW_PIN);
    await clockInBtn(page).click();
    await expect(page.getByText("Choose your new PIN")).toBeVisible(); // card still thinks it is temporary
    await fillNew(page, "8264");
    await saveBtn(page).click();
    await expect(toast(page, /your pin has already been changed/i)).toBeVisible();
    expect(await pinMatches(EMP.temp, NEW_PIN)).toBe(true);
    expect(await entriesOf(EMP.temp)).toHaveLength(0);
    await page.context().close();
  });

  for (const mode of ["abort", "500", "stale"] as const) {
    test(`server failure (${mode}) while saving the new PIN: message, PIN unchanged, retry works`, async ({
      browser,
    }) => {
      const page = await openK(browser, "temp-fail");
      await toNewPinStep(page);
      await fillNew(page, NEW_PIN);
      const injected = await failServerActions(page, mode, { times: 1, match: "newPin" });
      await saveBtn(page).click();
      await expect(toast(page, /could not reach the server/i)).toBeVisible();
      expect(injected.count()).toBe(1);
      await expectNoCrash(page);
      expect(await pinMatches(EMP.temp, TEMP_PIN)).toBe(true);
      expect(await entriesOf(EMP.temp)).toHaveLength(0);
      await expect(saveBtn(page)).toBeEnabled();
      await saveBtn(page).click(); // same card, same values: retry
      await expect(toast(page, /clocked in/i)).toBeVisible();
      expect(await pinMatches(EMP.temp, NEW_PIN)).toBe(true);
      await page.context().close();
    });
  }

  test("PIN saved but the punch request fails: PIN stays changed and the card asks for the NEW PIN", async ({
    browser,
  }) => {
    const page = await openK(browser, "temp-fail");
    await toNewPinStep(page);
    await fillNew(page, NEW_PIN);
    await failServerActions(page, "abort", { times: 1, match: "CLOCK_IN" });
    await saveBtn(page).click();
    await expect(toast(page, /pin updated/i)).toBeVisible();
    await expect(toast(page, /could not reach the server/i)).toBeVisible();
    expect(await pinMatches(EMP.temp, NEW_PIN)).toBe(true);
    expect(await entriesOf(EMP.temp)).toHaveLength(0);
    // Back on the normal PIN step (not the temporary-PIN wording).
    await expect(page.getByText("Enter your PIN to confirm")).toBeVisible();
    await typePin(page, NEW_PIN);
    await clockInBtn(page).click();
    await expect(toast(page, /clocked in/i)).toBeVisible();
    expect(await entriesOf(EMP.temp)).toHaveLength(1);
    await page.context().close();
  });

  test("double-submitting Save PIN changes the PIN once and clocks in once", async ({ browser }) => {
    const page = await openK(browser, "temp-fail");
    await toNewPinStep(page);
    await fillNew(page, NEW_PIN);
    await delayServerActions(page, 1200);
    await saveBtn(page).dblclick();
    await expect(toast(page, /clocked in/i)).toBeVisible();
    await expect(toast(page, /already been changed/i)).toHaveCount(0);
    expect(await entriesOf(EMP.temp)).toHaveLength(1);
    expect(await auditCount("kiosk.pin_changed", (await empRow(EMP.temp)).id)).toBe(1);
    await page.context().close();
  });
});
