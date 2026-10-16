import { test, expect } from "@playwright/test";
import { db, businessYmd } from "./support/db";
import { delayServerActions, expectNoCrash, failServerActions, toast } from "./support/helpers";
import {
  EMP,
  auditCount,
  backdate,
  breakBtn,
  cancelBtn,
  cardWithPin,
  clockInBtn,
  clockOutBtn,
  empRow,
  endBreakBtn,
  entriesOf,
  openCard,
  openEntry,
  openK,
  pinInput,
  resetEmployee,
  rosterButton,
  typePin,
} from "./support/kiosk";
import { ADMIN_STATE, WRONG_PIN, env } from "./support/test-data";

const PIN = env("E2E_EMPLOYEE_PIN");

test.describe("kiosk PIN flow: basic punching", () => {
  test.beforeEach(async () => {
    await resetEmployee(EMP.flow);
  });

  test("PIN field takes digits only (max 6) and actions wait for 4 digits", async ({ browser }) => {
    const page = await openK(browser, "flow-basic");
    await openCard(page, EMP.flow);
    await pinInput(page).pressSequentially("ab12");
    await expect(pinInput(page)).toHaveValue("12");
    await expect(clockInBtn(page)).toBeDisabled();
    await pinInput(page).fill("1234567");
    await expect(pinInput(page)).toHaveValue("123456");
    await expect(clockInBtn(page)).toBeEnabled();
    await pinInput(page).fill("123");
    await expect(clockInBtn(page)).toBeDisabled();
    // Cancel goes back to the roster and records nothing.
    await cancelBtn(page).click();
    await expect(page.getByPlaceholder(/search by name/i)).toBeVisible();
    expect(await entriesOf(EMP.flow)).toHaveLength(0);
    await page.context().close();
  });

  test("wrong PIN: clear message, PIN cleared, card stays open, then the right PIN works", async ({
    browser,
  }) => {
    const page = await openK(browser, "flow-basic");
    await cardWithPin(page, EMP.flow, WRONG_PIN);
    await clockInBtn(page).click();
    await expect(toast(page, /incorrect pin\. try again/i)).toBeVisible();
    await expect(pinInput(page)).toHaveValue("");
    expect(await entriesOf(EMP.flow)).toHaveLength(0);
    expect(await auditCount("kiosk.pin_failed", (await empRow(EMP.flow)).id)).toBeGreaterThan(0);
    await typePin(page, PIN);
    await clockInBtn(page).click();
    await expect(toast(page, /clocked in/i)).toBeVisible();
    expect(await entriesOf(EMP.flow)).toHaveLength(1);
    await page.context().close();
  });

  test("full day: clock in, break, end break, clock out are all saved", async ({ browser }) => {
    const page = await openK(browser, "flow-states");
    await cardWithPin(page, EMP.flow, PIN);
    await clockInBtn(page).click();
    await expect(toast(page, /clocked in/i)).toBeVisible();
    let [entry] = await entriesOf(EMP.flow);
    expect(entry).toMatchObject({ status: "ACTIVE", source: "KIOSK", kioskSlug: "k6-flow-states", kioskLabel: "K6 flow-states" });

    // Roster now shows "On shift".
    await expect(rosterButton(page, EMP.flow.name)).toContainText(/on shift/i);

    await cardWithPin(page, EMP.flow, PIN);
    await expect(clockInBtn(page)).toHaveCount(0); // already in: only Break / Clock out
    await expect(breakBtn(page)).toBeVisible();
    await expect(clockOutBtn(page)).toBeVisible();
    await breakBtn(page).click();
    await expect(toast(page, /break started/i)).toBeVisible();
    [entry] = await entriesOf(EMP.flow);
    expect(entry!.status).toBe("ON_BREAK");
    expect(entry!.breaks).toHaveLength(1);
    expect(entry!.breaks[0]!.endTime).toBeNull();
    await expect(rosterButton(page, EMP.flow.name)).toContainText(/on break/i);

    await cardWithPin(page, EMP.flow, PIN);
    await expect(breakBtn(page)).toHaveCount(0);
    await expect(clockOutBtn(page)).toHaveCount(0);
    await endBreakBtn(page).click();
    await expect(toast(page, /break ended/i)).toBeVisible();
    [entry] = await entriesOf(EMP.flow);
    expect(entry!.status).toBe("ACTIVE");
    expect(entry!.breaks[0]!.endTime).not.toBeNull();

    await cardWithPin(page, EMP.flow, PIN);
    await clockOutBtn(page).click();
    await expect(toast(page, /clocked out/i)).toBeVisible();
    [entry] = await entriesOf(EMP.flow);
    expect(entry!.status).toBe("COMPLETED");
    expect(entry!.clockOut).not.toBeNull();
    await expect(rosterButton(page, EMP.flow.name)).toContainText(/out/i);
    for (const a of ["kiosk.clock_in", "kiosk.start_break", "kiosk.end_break", "kiosk.clock_out"]) {
      expect(await auditCount(a, (await empRow(EMP.flow)).id)).toBe(1);
    }
    await page.context().close();
  });

  test("already clocked in: card offers Break and Clock out only", async ({ browser }) => {
    await openEntry(EMP.flow, 30);
    const page = await openK(browser, "flow-states2");
    await expect(rosterButton(page, EMP.flow.name)).toContainText(/on shift/i);
    await openCard(page, EMP.flow);
    await expect(page.getByText(/on shift/i).first()).toBeVisible();
    await expect(clockInBtn(page)).toHaveCount(0);
    await expect(breakBtn(page)).toBeVisible();
    await expect(clockOutBtn(page)).toBeVisible();
    await page.context().close();
  });

  test("on break: card offers End break only", async ({ browser }) => {
    await openEntry(EMP.flow, 60, { onBreak: true });
    const page = await openK(browser, "flow-states2");
    await expect(rosterButton(page, EMP.flow.name)).toContainText(/on break/i);
    await openCard(page, EMP.flow);
    await expect(endBreakBtn(page)).toBeVisible();
    await expect(clockInBtn(page)).toHaveCount(0);
    await expect(breakBtn(page)).toHaveCount(0);
    await expect(clockOutBtn(page)).toHaveCount(0);
    await page.context().close();
  });

  test("clocking out while on break closes the break", async ({ browser }) => {
    // The card only offers End break, so end it first, then clock out: both saved.
    await openEntry(EMP.flow, 60, { onBreak: true });
    const page = await openK(browser, "flow-states2");
    await cardWithPin(page, EMP.flow, PIN);
    await endBreakBtn(page).click();
    await expect(toast(page, /break ended/i)).toBeVisible();
    await cardWithPin(page, EMP.flow, PIN);
    await clockOutBtn(page).click();
    await expect(toast(page, /clocked out/i)).toBeVisible();
    const [entry] = await entriesOf(EMP.flow);
    expect(entry!.status).toBe("COMPLETED");
    expect(entry!.breaks.every((b) => b.endTime)).toBe(true);
    await page.context().close();
  });
});

test.describe("kiosk PIN flow: double tap and failures", () => {
  test.beforeEach(async () => {
    await resetEmployee(EMP.flow);
  });

  test("double-tapping Clock in and Clock out each saves exactly one punch", async ({ browser }) => {
    const page = await openK(browser, "flow-double");
    await delayServerActions(page, 1200);
    await cardWithPin(page, EMP.flow, PIN);
    await clockInBtn(page).dblclick();
    await expect(toast(page, /clocked in/i)).toBeVisible();
    expect(await entriesOf(EMP.flow)).toHaveLength(1);
    expect(await auditCount("kiosk.clock_in", (await empRow(EMP.flow)).id)).toBe(1);
    await expect(toast(page, /already clocked in/i)).toHaveCount(0);

    await cardWithPin(page, EMP.flow, PIN);
    await clockOutBtn(page).dblclick();
    await expect(toast(page, /clocked out/i)).toBeVisible();
    const entries = await entriesOf(EMP.flow);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.status).toBe("COMPLETED");
    expect(await auditCount("kiosk.clock_out", (await empRow(EMP.flow)).id)).toBe(1);
    await page.context().close();
  });

  test("double-tapping Break starts one break", async ({ browser }) => {
    await openEntry(EMP.flow, 40);
    const page = await openK(browser, "flow-double");
    await delayServerActions(page, 1200);
    await cardWithPin(page, EMP.flow, PIN);
    await breakBtn(page).dblclick();
    await expect(toast(page, /break started/i)).toBeVisible();
    const [entry] = await entriesOf(EMP.flow);
    expect(entry!.breaks).toHaveLength(1);
    await page.context().close();
  });

  for (const mode of ["abort", "500", "stale"] as const) {
    test(`server failure (${mode}) while punching: message, card stays, nothing saved, retry works`, async ({
      browser,
    }) => {
      const page = await openK(browser, "flow-fail");
      await cardWithPin(page, EMP.flow, PIN);
      const injected = await failServerActions(page, mode, { times: 1, match: "CLOCK_IN" });
      await clockInBtn(page).click();
      await expect(toast(page, /could not reach the server/i)).toBeVisible();
      expect(injected.count()).toBe(1);
      await expectNoCrash(page);
      expect(await entriesOf(EMP.flow)).toHaveLength(0);
      // The card is still there: type the PIN again and the retry goes through.
      await expect(pinInput(page)).toBeVisible();
      await typePin(page, PIN);
      await clockInBtn(page).click();
      await expect(toast(page, /clocked in/i)).toBeVisible();
      expect(await entriesOf(EMP.flow)).toHaveLength(1);
      await page.context().close();
    });
  }

  test("server failure while looking an employee up shows a message and keeps the roster", async ({
    browser,
  }) => {
    const page = await openK(browser, "flow-fail");
    await expect(rosterButton(page, EMP.flow.name)).toBeVisible();
    await failServerActions(page, "abort", { times: 1 });
    await rosterButton(page, EMP.flow.name).click();
    await expect(toast(page, /could not reach the server/i)).toBeVisible();
    await expectNoCrash(page);
    await expect(rosterButton(page, EMP.flow.name)).toBeVisible();
    await expect(pinInput(page)).toHaveCount(0);
    await page.context().close();
  });
});

test.describe("kiosk PIN flow: search and ID entry", () => {
  test("search by name, ID and job title; empty result; clear; list view", async ({ browser }) => {
    const page = await openK(browser, "flow-search");
    const search = page.getByPlaceholder(/search by name/i);
    await expect(rosterButton(page, EMP.search.name)).toBeVisible();

    await search.fill("searchab"); // part of the name, any case
    await expect(rosterButton(page, EMP.search.name)).toBeVisible();
    await expect(rosterButton(page, EMP.flow.name)).toHaveCount(0);

    await search.fill("6021"); // last digits of the ID
    await expect(rosterButton(page, EMP.search.name)).toBeVisible();
    await expect(rosterButton(page, EMP.flow.name)).toHaveCount(0);

    await search.fill("emp-2026-6021"); // full ID, other case
    await expect(rosterButton(page, EMP.search.name)).toBeVisible();

    await search.fill("rigger"); // job title
    await expect(rosterButton(page, EMP.search.name)).toBeVisible();
    await expect(rosterButton(page, EMP.brk.name)).toHaveCount(0);

    await search.fill("zzzz-nobody");
    await expect(page.getByText("No employees match that search.")).toBeVisible();

    await search.fill("");
    await expect(rosterButton(page, EMP.flow.name)).toBeVisible();

    // Terminated people are not on the roster.
    await expect(page.getByText(EMP.twinGone.name)).toHaveCount(0);

    await search.fill("rigger");
    await page.getByRole("button", { name: /list/i }).click();
    await expect(page.getByText("Rigger · EMP-2026-6021")).toBeVisible();
    await page.getByRole("button", { name: /grid/i }).click();
    await expect(page.getByText("Rigger · EMP-2026-6021")).toHaveCount(0);
    await page.context().close();
  });

  async function enterId(page: import("@playwright/test").Page, value: string) {
    if (await page.getByPlaceholder("Full ID or last digits").count() === 0) {
      await page.getByRole("button", { name: /enter id/i }).click();
    }
    const input = page.getByPlaceholder("Full ID or last digits");
    await input.fill(value);
    await input.press("Enter");
  }

  test("ID entry: Continue is disabled when empty; full ID in any case opens the card", async ({
    browser,
  }) => {
    const page = await openK(browser, "flow-ids");
    await page.getByRole("button", { name: /enter id/i }).click();
    await expect(page.getByRole("button", { name: /^continue$/i })).toBeDisabled();
    await enterId(page, "emp-2026-6021"); // typed in lower case; the field upper-cases it
    await expect(page.getByText("EMP-2026-6021")).toBeVisible();
    await expect(page.getByText(EMP.search.name)).toBeVisible();
    await expect(pinInput(page)).toBeVisible();
    await page.context().close();
  });

  test("ID entry: last digits, padded digits and the Continue button", async ({ browser }) => {
    const page = await openK(browser, "flow-ids");
    await enterId(page, "6021");
    await expect(page.getByText(EMP.search.name)).toBeVisible();
    await cancelBtn(page).click();
    // "1" is padded to 0001 and finds the base employee Erin.
    await page.getByRole("button", { name: /enter id/i }).click();
    await page.getByPlaceholder("Full ID or last digits").fill("1");
    await page.getByRole("button", { name: /^continue$/i }).click();
    await expect(page.getByText("EMP-2026-0001")).toBeVisible();
    await page.context().close();
  });

  test("ID entry: ambiguous digits ask for the full ID, and the full ID works", async ({ browser }) => {
    const page = await openK(browser, "flow-ids");
    await enterId(page, "6101"); // EMP-2026-6101 and EMP-2027-6101
    await expect(toast(page, /more than one employee matches those digits/i)).toBeVisible();
    await expect(pinInput(page)).toHaveCount(0);
    await enterId(page, EMP.twinB.employeeId);
    await expect(page.getByText(EMP.twinB.name)).toBeVisible();
    await page.context().close();
  });

  test("ID entry: digits that match an active and a departed person pick the active one", async ({
    browser,
  }) => {
    const page = await openK(browser, "flow-ids");
    await enterId(page, "6103");
    await expect(page.getByText(EMP.twinActive.name)).toBeVisible();
    await page.context().close();
  });

  test("ID entry: digits of an inactive person, an unknown ID and a bare prefix are refused", async ({
    browser,
  }) => {
    const page = await openK(browser, "flow-ids");
    await enterId(page, "2"); // Ivan (terminated) is the only match
    await expect(toast(page, /isn.t active for kiosk use/i)).toBeVisible();
    await enterId(page, "9999");
    await expect(toast(page, /unknown employee id/i)).toBeVisible();
    await enterId(page, "EMP-2020-6103"); // the departed twin, full ID
    await expect(toast(page, /isn.t active for kiosk use/i).nth(0)).toBeVisible();
    await enterId(page, "EMP-"); // nothing but a prefix
    await expect(toast(page, /enter your employee id or the digits at the end of it/i)).toBeVisible();
    await expect(pinInput(page)).toHaveCount(0);
    await page.context().close();
  });
});

test.describe("kiosk PIN flow: state changes between lookup and punch", () => {
  test.beforeEach(async () => {
    await resetEmployee(EMP.race);
  });

  test("clocked in elsewhere after the card opened: clock in is refused, nothing doubled", async ({
    browser,
  }) => {
    const page = await openK(browser, "flow-races");
    await cardWithPin(page, EMP.race, PIN);
    await openEntry(EMP.race, 10); // someone else clocked them in
    await clockInBtn(page).click();
    await expect(toast(page, /you are already clocked in/i)).toBeVisible();
    expect(await entriesOf(EMP.race)).toHaveLength(1);
    await page.context().close();
  });

  test("entry vanished after the card opened: clock out and break are refused", async ({ browser }) => {
    const entry = await openEntry(EMP.race, 20);
    const page = await openK(browser, "flow-races");
    await cardWithPin(page, EMP.race, PIN);
    await db.timeEntry.delete({ where: { id: entry.id } });
    await clockOutBtn(page).click();
    await expect(toast(page, /you are not clocked in\. refresh the kiosk/i)).toBeVisible();
    await typePin(page, PIN);
    await breakBtn(page).click();
    await expect(toast(page, /not currently clocked in/i)).toBeVisible();
    expect(await entriesOf(EMP.race)).toHaveLength(0);
    await page.context().close();
  });

  test("break ended elsewhere after the card opened: End break is refused", async ({ browser }) => {
    const entry = await openEntry(EMP.race, 60, { onBreak: true });
    const page = await openK(browser, "flow-races");
    await cardWithPin(page, EMP.race, PIN);
    await db.timeEntry.update({ where: { id: entry.id }, data: { status: "ACTIVE" } });
    await endBreakBtn(page).click();
    await expect(toast(page, /you are not on break/i)).toBeVisible();
    await page.context().close();
  });

  test("break row missing: End break says so and changes nothing", async ({ browser }) => {
    const entry = await openEntry(EMP.race, 60, { onBreak: true });
    const page = await openK(browser, "flow-races");
    await cardWithPin(page, EMP.race, PIN);
    await db.timeBreak.deleteMany({ where: { timeEntryId: entry.id } });
    await endBreakBtn(page).click();
    await expect(toast(page, /no open break was found/i)).toBeVisible();
    expect((await entriesOf(EMP.race))[0]!.status).toBe("ON_BREAK");
    await page.context().close();
  });

  test("employee ended after the card opened: punch refused with the see-an-admin message", async ({
    browser,
  }) => {
    const page = await openK(browser, "flow-races");
    await cardWithPin(page, EMP.race, PIN);
    await db.employee.update({
      where: { employeeId: EMP.race.employeeId },
      data: { employmentStatus: "TERMINATED", terminationDate: new Date() },
    });
    await clockInBtn(page).click();
    await expect(toast(page, /isn.t active for kiosk use/i)).toBeVisible();
    expect(await entriesOf(EMP.race)).toHaveLength(0);
    await page.context().close();
  });

  test("employee record deleted after the card opened: punch says unknown employee", async ({
    browser,
  }) => {
    const user = await db.user.create({
      data: { email: "k6-temp-delete@e2e.test", name: "Temp Deleted", role: "EMPLOYEE" },
    });
    const temp = await db.employee.create({
      data: {
        employeeId: "EMP-2026-6999",
        userId: user.id,
        name: "Temp Deleted",
        email: user.email,
        gender: "OTHER",
        employmentType: "FULL_PART_TIME",
        compensationType: "HOURLY_RATE",
        compensationValue: 20,
        jobTitle: "Temp",
        dateOfHire: new Date(),
        kioskPinHash: (await empRow(EMP.race)).kioskPinHash,
      },
    });
    try {
      const page = await openK(browser, "flow-races");
      await cardWithPin(page, { employeeId: temp.employeeId, name: temp.name }, PIN);
      await db.employee.delete({ where: { id: temp.id } });
      await clockInBtn(page).click();
      await expect(toast(page, /unknown employee id/i)).toBeVisible();
      await page.context().close();
    } finally {
      await db.employee.deleteMany({ where: { id: temp.id } });
      await db.user.deleteMany({ where: { id: user.id } });
    }
  });
});

test.describe("kiosk PIN flow: forgotten clock-outs (16 hour cap)", () => {
  test.beforeEach(async () => {
    await resetEmployee(EMP.stale);
    await db.notification.deleteMany({ where: { title: { in: ["Shift auto-closed for review", "A previous shift was left open"] } } });
  });

  test("a shift left open over 16 hours shows as Out, warns, and is auto-closed on clock in", async ({
    browser,
  }) => {
    const old = await openEntry(EMP.stale, 20 * 60);
    const page = await openK(browser, "flow-stale");
    await expect(rosterButton(page, EMP.stale.name)).toContainText(/out/i);
    await openCard(page, EMP.stale);
    await expect(page.getByText(/your last shift was never clocked out/i)).toBeVisible();
    await expect(clockInBtn(page)).toBeVisible();
    await typePin(page, PIN);
    await clockInBtn(page).click();
    await expect(toast(page, /clocked in/i)).toBeVisible();
    await expect(toast(page, /left open more than 16 hours/i)).toBeVisible();

    const closed = await db.timeEntry.findUniqueOrThrow({ where: { id: old.id } });
    expect(closed.status).toBe("COMPLETED");
    expect(closed.autoClosed).toBe(true);
    expect(closed.editReason).toBeTruthy();
    expect(closed.approvalStatus).toBe("PENDING");
    expect(closed.clockOut!.getTime() - closed.clockIn.getTime()).toBe(16 * 60 * 60_000);
    const entries = await entriesOf(EMP.stale);
    expect(entries).toHaveLength(2);
    expect(entries.filter((e) => e.status === "ACTIVE")).toHaveLength(1);
    expect(await auditCount("time.auto_close", old.id)).toBe(1);
    expect(await db.notification.count({ where: { title: "A previous shift was left open" } })).toBe(1);

    // The admin sees it flagged.
    const adminCtx = await browser.newContext({ storageState: ADMIN_STATE });
    const admin = await adminCtx.newPage();
    await admin.goto(
      `/admin/time-tracking?from=${businessYmd(3)}&to=${businessYmd(0)}&q=${encodeURIComponent(EMP.stale.name)}`,
    );
    await expect(admin.getByText("Auto-closed").first()).toBeVisible();
    await adminCtx.close();
    await page.context().close();
  });

  test("a stale shift that was on break is closed together with its break", async ({ browser }) => {
    const old = await openEntry(EMP.stale, 18 * 60, { onBreak: true });
    const page = await openK(browser, "flow-stale");
    await cardWithPin(page, EMP.stale, PIN);
    await clockInBtn(page).click();
    await expect(toast(page, /left open more than 16 hours/i)).toBeVisible();
    const closed = await db.timeEntry.findUniqueOrThrow({ where: { id: old.id }, include: { breaks: true } });
    expect(closed.status).toBe("COMPLETED");
    expect(closed.breaks.every((b) => b.endTime !== null)).toBe(true);
    await page.context().close();
  });

  test("a shift that is 15 hours old is still open: no warning, normal Break / Clock out", async ({
    browser,
  }) => {
    await openEntry(EMP.stale, 15 * 60);
    const page = await openK(browser, "flow-stale");
    await openCard(page, EMP.stale);
    await expect(page.getByText(/never clocked out/i)).toHaveCount(0);
    await expect(clockOutBtn(page)).toBeVisible();
    await page.context().close();
  });

  test("shift crosses 16 hours before Clock out is pressed: hours are capped and flagged", async ({
    browser,
  }) => {
    const entry = await openEntry(EMP.stale, 15 * 60);
    const page = await openK(browser, "flow-stale");
    await cardWithPin(page, EMP.stale, PIN);
    await backdate(entry.id, 17 * 60);
    await clockOutBtn(page).click();
    await expect(toast(page, /clocked out/i)).toBeVisible();
    await expect(toast(page, /left open more than 16 hours/i)).toBeVisible();
    const done = await db.timeEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(done.autoClosed).toBe(true);
    expect(done.totalWorkMin).toBeLessThanOrEqual(16 * 60);
    expect(done.clockOut!.getTime() - done.clockIn.getTime()).toBe(16 * 60 * 60_000);
    await page.context().close();
  });

  test("shift crosses 16 hours before Break / End break: told to clock out first", async ({ browser }) => {
    const entry = await openEntry(EMP.stale, 15 * 60);
    const page = await openK(browser, "flow-stale");
    await cardWithPin(page, EMP.stale, PIN);
    await backdate(entry.id, 17 * 60);
    await breakBtn(page).click();
    await expect(toast(page, /open more than 16 hours\. clock out to close it/i)).toBeVisible();
    expect((await entriesOf(EMP.stale))[0]!.breaks).toHaveLength(0);
    await page.context().close();

    await resetEmployee(EMP.stale);
    const onBreak = await openEntry(EMP.stale, 15 * 60, { onBreak: true });
    const page2 = await openK(browser, "flow-stale");
    await cardWithPin(page2, EMP.stale, PIN);
    await backdate(onBreak.id, 17 * 60);
    await endBreakBtn(page2).click();
    await expect(toast(page2, /open more than 16 hours\. clock out to close it/i)).toBeVisible();
    expect((await entriesOf(EMP.stale))[0]!.status).toBe("ON_BREAK");
    await page2.context().close();
  });
});
