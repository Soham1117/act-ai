import { test, expect, type Page } from "@playwright/test";
import { db } from "./support/db";
import { delayServerActions, expectNoCrash, failServerActions, toast } from "./support/helpers";
import { fakeS3Keys } from "./support/fake-s3";
import { JOB_CODE, KIOSK_NEW_SLUG } from "./support/test-data";
import { CW_JOB, cwKioskSlug } from "./support/contract-data";
import {
  auditCount,
  captureActions,
  entriesOf,
  kioskList,
  makeAgency,
  makeOpenEntry,
  makeWorker,
  openCrewKiosk,
  pickKioskWorker,
  replay,
  tamperActions,
} from "./support/contract";
import { SERVER_ERROR, STALE_ERROR } from "./support/action-errors";

const clockIn = (p: Page) => p.getByRole("button", { name: /^clock in$/i });
const clockOut = (p: Page) => p.getByRole("button", { name: /^clock out$/i });
const anyToast = (p: Page) => p.locator("[data-sonner-toast]").first();

test.describe("kiosk contract crew: who is listed", () => {
  test("only workers eligible today are listed", async ({ browser }) => {
    const page = await openCrewKiosk(browser, 2);
    const ok = await makeWorker({ name: "Kl Current" });
    const endsToday = await makeWorker({ name: "Kl EndsToday", endDaysAgo: 0 });
    const startsToday = await makeWorker({ name: "Kl StartsToday", startDaysAgo: 0 });
    const ended = await makeWorker({ name: "Kl Ended", status: "ENDED", endDaysAgo: 1 });
    const future = await makeWorker({ name: "Kl Future", startDaysAgo: -3 });
    const pastEnd = await makeWorker({ name: "Kl PastEnd", endDaysAgo: 1 }); // ACTIVE but end date passed
    await page.reload();
    await page.getByRole("button", { name: /contract crew/i }).click();
    await expect(kioskList(page, ok.name)).toBeVisible();
    for (const w of [endsToday, startsToday]) await expect(kioskList(page, w.name)).toBeVisible();
    for (const w of [ended, future, pastEnd]) await expect(kioskList(page, w.name)).toHaveCount(0);
    // Search by CW id works too.
    await page.getByPlaceholder(/search by name or cw id/i).fill(ok.workerId.toLowerCase());
    await expect(kioskList(page, ok.name)).toBeVisible();
    await page.getByPlaceholder(/search by name or cw id/i).fill(ended.name);
    await expect(page.getByText(/no contract workers match that search/i)).toBeVisible();
    await page.context().close();
  });

  test("workers are grouped under their agency name", async ({ browser }) => {
    const ag = await makeAgency();
    await makeWorker({ agencyId: ag.id, name: "Kg Grouped" });
    const page = await openCrewKiosk(browser, 3);
    await expect(page.getByRole("heading", { name: ag.name })).toBeVisible();
    await page.getByPlaceholder(/search by name or cw id/i).fill(ag.name.toUpperCase());
    await expect(kioskList(page, "Kg Grouped")).toBeVisible();
    await page.context().close();
  });
});

test.describe("kiosk contract crew: eligibility at punch time", () => {
  test("a worker whose contract ended after they were picked cannot clock in", async ({ browser }) => {
    const w = await makeWorker({ name: "Ke EndedLater" });
    const page = await openCrewKiosk(browser, 4);
    await pickKioskWorker(page, w.name);
    await db.contractWorker.update({ where: { id: w.id }, data: { status: "ENDED" } });
    await clockIn(page).click();
    await expect(toast(page, /this contract has ended\. please see an admin/i)).toBeVisible();
    expect(await entriesOf(w.id)).toHaveLength(0);
    await page.context().close();
  });

  test("a contract that has not started cannot clock in; a passed end date cannot either", async ({ browser }) => {
    const w = await makeWorker({ name: "Ke NotStarted" });
    const page = await openCrewKiosk(browser, 5);
    await pickKioskWorker(page, w.name);
    const future = new Date(Date.now() + 3 * 86_400_000);
    await db.contractWorker.update({ where: { id: w.id }, data: { startDate: future } });
    await clockIn(page).click();
    await expect(toast(page, /this contract has not started yet/i)).toBeVisible();
    await db.contractWorker.update({
      where: { id: w.id },
      data: { startDate: new Date(Date.now() - 9 * 86_400_000), endDate: new Date(Date.now() - 2 * 86_400_000) },
    });
    await clockIn(page).click();
    await expect(toast(page, /this contract has ended/i)).toBeVisible();
    expect(await entriesOf(w.id)).toHaveLength(0);
    await page.context().close();
  });

  test("clock-out is still allowed after the contract end date", async ({ browser }) => {
    const w = await makeWorker({ name: "Ke OutAfterEnd" });
    const open = await makeOpenEntry(w.id, 2);
    const page = await openCrewKiosk(browser, 6);
    await pickKioskWorker(page, w.name);
    await db.contractWorker.update({
      where: { id: w.id },
      data: { status: "ENDED", endDate: new Date(Date.now() - 2 * 86_400_000) },
    });
    await clockOut(page).click();
    await expect(toast(page, /clocked out at/i)).toBeVisible();
    const done = await db.contractTimeEntry.findUniqueOrThrow({ where: { id: open.id } });
    expect(done.status).toBe("COMPLETED");
    expect(done.clockOut).not.toBeNull();
    await page.context().close();
  });
});

test.describe("kiosk contract crew: punch rules", () => {
  test("already clocked in: a second clock-in is refused and keeps one open entry", async ({ browser }) => {
    const w = await makeWorker({ name: "Kp AlreadyIn" });
    const page = await openCrewKiosk(browser, 7);
    await pickKioskWorker(page, w.name);
    await makeOpenEntry(w.id, 1); // punched in on another device meanwhile
    await clockIn(page).click();
    await expect(toast(page, /you are already clocked in/i)).toBeVisible();
    expect(await entriesOf(w.id)).toHaveLength(1);
    await page.context().close();
  });

  test("a worker who is shown as In only gets Clock out; clocking out when already out is refused", async ({ browser }) => {
    const w = await makeWorker({ name: "Kp ShownIn" });
    const open = await makeOpenEntry(w.id, 1);
    const page = await openCrewKiosk(browser, 8);
    await pickKioskWorker(page, w.name);
    await expect(clockIn(page)).toHaveCount(0);
    await db.contractTimeEntry.update({ where: { id: open.id }, data: { status: "COMPLETED", clockOut: new Date() } });
    await clockOut(page).click();
    await expect(toast(page, /you are not clocked in/i)).toBeVisible();
    await page.context().close();
  });

  test("double-tapping Clock in makes one entry", async ({ browser }) => {
    const w = await makeWorker({ name: "Kp DoubleTap" });
    const page = await openCrewKiosk(browser, 9);
    await pickKioskWorker(page, w.name);
    const slow = await delayServerActions(page, 1500);
    await clockIn(page).click();
    await clockIn(page).click({ force: true, timeout: 1000 }).catch(() => undefined);
    await expect(toast(page, /clocked in at/i)).toBeVisible();
    expect(slow.count()).toBeLessThanOrEqual(2); // 1 punch (+ roster reload after)
    expect(await entriesOf(w.id)).toHaveLength(1);
    await page.context().close();
  });

  test("two clock-in requests at the same instant make one entry", async ({ browser }) => {
    const w = await makeWorker({ name: "Kp Race" });
    const page = await openCrewKiosk(browser, 10);
    const seen = await captureActions(page, { block: true });
    await pickKioskWorker(page, w.name);
    await clockIn(page).click();
    await expect.poll(() => seen.some((c) => c.body.includes("CLOCK_IN"))).toBe(true);
    const call = seen.find((c) => c.body.includes("CLOCK_IN"))!;
    const out = await Promise.all([replay(page.context(), call), replay(page.context(), call)]);
    expect(out.filter((o) => /already clocked in/i.test(o))).toHaveLength(1);
    expect(await entriesOf(w.id)).toHaveLength(1);
    await page.context().close();
  });

  test("a forgotten shift (over 16 hours) is closed, capped and flagged when the worker clocks in again", async ({ browser }) => {
    const w = await makeWorker({ name: "Kp Stale" });
    const stale = await makeOpenEntry(w.id, 20);
    const page = await openCrewKiosk(browser, 11);
    // The stale shift counts as Out on the roster.
    await expect(kioskList(page, w.name)).toContainText("Out");
    await pickKioskWorker(page, w.name);
    await clockIn(page).click();
    await expect(toast(page, /clocked in at/i)).toBeVisible();
    await expect(toast(page, /left open more than 16 hours/i)).toBeVisible();
    const [old, fresh] = await entriesOf(w.id);
    expect(old!.id).toBe(stale.id);
    expect(old).toMatchObject({ status: "COMPLETED", autoClosed: true, approvalStatus: "PENDING", totalWorkMin: 960 });
    expect(old!.clockOut!.getTime() - old!.clockIn.getTime()).toBe(16 * 3_600_000);
    expect(old!.editReason).toMatch(/auto-closed/i);
    expect(fresh).toMatchObject({ status: "ACTIVE", autoClosed: false });
    expect(await auditCount("contract.time.auto_close", stale.id)).toBe(1);
    // Admin notifications go to admins with an Employee record; the e2e admin has none, so none is created.
    await page.context().close();
  });

  test("clocking out of a shift that passed 16 hours while the card was open caps and flags it", async ({ browser }) => {
    const w = await makeWorker({ name: "Kp StaleOut" });
    const open = await makeOpenEntry(w.id, 1);
    const page = await openCrewKiosk(browser, 12);
    await pickKioskWorker(page, w.name);
    await db.contractTimeEntry.update({ where: { id: open.id }, data: { clockIn: new Date(Date.now() - 20 * 3_600_000) } });
    await clockOut(page).click();
    await expect(toast(page, /left open more than 16 hours/i)).toBeVisible();
    expect(await db.contractTimeEntry.findUniqueOrThrow({ where: { id: open.id } })).toMatchObject({
      autoClosed: true,
      totalWorkMin: 960,
      status: "COMPLETED",
    });
    await page.context().close();
  });

  test("an ON_BREAK entry (legacy data) shows 'On break' and can only clock out", async ({ browser }) => {
    const w = await makeWorker({ name: "Kp LegacyBreak" });
    const open = await makeOpenEntry(w.id, 2);
    await db.contractTimeEntry.update({ where: { id: open.id }, data: { status: "ON_BREAK" } });
    const page = await openCrewKiosk(browser, 13);
    await expect(kioskList(page, w.name)).toContainText("On break");
    await pickKioskWorker(page, w.name);
    await expect(page.getByRole("button", { name: /break|lunch/i })).toHaveCount(0);
    await clockOut(page).click();
    await expect(toast(page, /clocked out at/i)).toBeVisible();
    await page.context().close();
  });

  test("the server rejects break actions: contract workers have no breaks", async ({ browser }) => {
    const w = await makeWorker({ name: "Kp NoBreaks" });
    const page = await openCrewKiosk(browser, 14);
    await pickKioskWorker(page, w.name);
    for (const action of ["START_BREAK", "END_BREAK", "BREAK"]) {
      await page.unroute("**/*").catch(() => undefined);
      await tamperActions(page, (b) => b.replace('"CLOCK_IN"', `"${action}"`));
      await clockIn(page).click();
      await expect(toast(page, /check action/i).last()).toBeVisible();
      await expect(clockIn(page)).toBeEnabled();
    }
    expect(await entriesOf(w.id)).toHaveLength(0);
    expect(await db.contractTimeBreak.count({ where: { timeEntry: { contractWorkerId: w.id } } })).toBe(0);
    await page.context().close();
  });

  test("the server refuses a kiosk that is not active here and an unknown worker", async ({ browser }) => {
    const w = await makeWorker({ name: "Kp Crafted" });
    const page = await openCrewKiosk(browser, 15);
    await pickKioskWorker(page, w.name);
    await tamperActions(page, (b) => b.replace(cwKioskSlug(15), KIOSK_NEW_SLUG));
    await clockIn(page).click();
    await expect(toast(page, /kiosk session is not active on this device/i)).toBeVisible();
    await page.unroute("**/*");
    await tamperActions(page, (b) => b.replace(w.id, "no-such-worker"));
    await clockIn(page).click();
    await expect(toast(page, /unknown contract worker/i)).toBeVisible();
    expect(await entriesOf(w.id)).toHaveLength(0);
    await page.context().close();
  });

  test("a revoked kiosk can no longer punch", async ({ browser }) => {
    const w = await makeWorker({ name: "Kp Revoked" });
    const page = await openCrewKiosk(browser, 16);
    await pickKioskWorker(page, w.name);
    await db.kioskSession.update({ where: { slug: cwKioskSlug(16) }, data: { revokedAt: new Date() } });
    await clockIn(page).click();
    await expect(toast(page, /kiosk session is not active on this device/i)).toBeVisible();
    expect(await entriesOf(w.id)).toHaveLength(0);
    await db.kioskSession.update({ where: { slug: cwKioskSlug(16) }, data: { revokedAt: null } });
    await page.context().close();
  });

  test("the roster refresh is rate limited", async ({ browser }) => {
    const page = await openCrewKiosk(browser, 17);
    const seen = await captureActions(page);
    await page.reload();
    await page.getByRole("button", { name: /contract crew/i }).click();
    await expect.poll(() => seen.length).toBeGreaterThan(0);
    const roster = seen[0]!;
    let limited = "";
    for (let i = 0; i < 25 && !limited; i++) {
      const out = await replay(page.context(), roster);
      if (/too many refreshes/i.test(out)) limited = out;
    }
    expect(limited).not.toBe("");
    await page.context().close();
  });

  test("punches are rate limited", async ({ browser }) => {
    const w = await makeWorker({ name: "Kp Limited" });
    const page = await openCrewKiosk(browser, 18);
    const seen = await captureActions(page, { block: true });
    await pickKioskWorker(page, w.name);
    await clockIn(page).click();
    await expect.poll(() => seen.some((c) => c.body.includes("CLOCK_IN"))).toBe(true);
    const call = seen.find((c) => c.body.includes("CLOCK_IN"))!;
    const bogus = call.body.replace(w.id, "no-such-worker");
    let limited = false;
    for (let i = 0; i < 70 && !limited; i++) limited = /too many taps/i.test(await replay(page.context(), call, bogus));
    expect(limited).toBe(true);
    expect(await entriesOf(w.id)).toHaveLength(0);
    await page.context().close();
  });

  test("idle selection is cancelled after 30 seconds and the roster refreshes by itself", async ({ browser }) => {
    const w = await makeWorker({ name: "Kp Idle" });
    const page = await openCrewKiosk(browser, 19, { clock: true });
    await pickKioskWorker(page, w.name);
    await page.clock.fastForward(31_000);
    await expect(page.getByText("Agency staff", { exact: true })).toBeHidden();
    await makeOpenEntry(w.id, 1);
    await page.clock.fastForward(61_000);
    await expect(kioskList(page, w.name)).toContainText("In");
    await page.context().close();
  });
});

test.describe("kiosk contract crew: photos", () => {
  test("clock-in and clock-out photos are stored; an invalid photo is ignored but the punch works", async ({ browser }) => {
    const w = await makeWorker({ name: "Kf Photos" });
    const page = await openCrewKiosk(browser, 20);
    await pickKioskWorker(page, w.name);
    await clockIn(page).click();
    await expect(toast(page, /clocked in at/i)).toBeVisible();
    await expect.poll(async () => (await entriesOf(w.id))[0]?.clockInPhotoKey).toBeTruthy();
    await pickKioskWorker(page, w.name);
    await clockOut(page).click();
    await expect(toast(page, /clocked out at/i)).toBeVisible();
    await expect.poll(async () => (await entriesOf(w.id))[0]?.clockOutPhotoKey).toBeTruthy();
    const [e] = await entriesOf(w.id);
    const keys = await fakeS3Keys();
    expect(keys.some((k) => k.includes(`${e!.id}-in.jpg`))).toBe(true);
    expect(keys.some((k) => k.includes(`${e!.id}-out.jpg`))).toBe(true);
    await page.context().close();

    const w2 = await makeWorker({ name: "Kf BadPhoto" });
    const page2 = await openCrewKiosk(browser, 21);
    await pickKioskWorker(page2, w2.name);
    await tamperActions(page2, (b) => b.replace(/"photo":"data:image\/jpeg;base64,[^"]*"/, '"photo":"data:text/html;base64,PGI+"'));
    await clockIn(page2).click();
    await expect(toast(page2, /clocked in at/i)).toBeVisible();
    const [e2] = await entriesOf(w2.id);
    expect(e2!.clockInPhotoKey).toBeNull();
    await page2.context().close();
  });

  test("when the camera is denied the kiosk says so and the punch still works", async ({ browser }) => {
    const w = await makeWorker({ name: "Kf NoCamera" });
    const page = await openCrewKiosk(browser, 22, { noCamera: true });
    await pickKioskWorker(page, w.name);
    await expect(page.getByText("Camera off")).toBeVisible();
    await clockIn(page).click();
    await expect(toast(page, /clocked in at/i)).toBeVisible();
    const [e] = await entriesOf(w.id);
    expect(e).toMatchObject({ status: "ACTIVE", clockInPhotoKey: null });
    await page.context().close();
  });
});

test.describe("kiosk contract crew: job code on the entry", () => {
  /** The entry must carry a job code that really exists and is active - never an invented one. */
  async function expectSaneJobCode(page: Page, workerId: string) {
    await expect(anyToast(page)).toBeVisible();
    const entries = await entriesOf(workerId);
    if (entries.length === 0) {
      // A clear error is also acceptable.
      await expect(toast(page, /job code/i)).toBeVisible();
      return;
    }
    expect(entries[0]!.jobCode).not.toBe("ACT001");
    const jc = await db.jobCode.findUnique({ where: { code: entries[0]!.jobCode } });
    expect(jc, `entry used job code ${entries[0]!.jobCode}, which does not exist`).not.toBeNull();
    expect(jc!.isActive, `entry used inactive job code ${entries[0]!.jobCode}`).toBe(true);
  }

  test("a worker with an active job code gets exactly that code", async ({ browser }) => {
    const w = await makeWorker({ name: "Kj Active", jobCode: CW_JOB.second.code });
    const page = await openCrewKiosk(browser, 23);
    await pickKioskWorker(page, w.name);
    await clockIn(page).click();
    await expect(toast(page, /clocked in at/i)).toBeVisible();
    expect((await entriesOf(w.id))[0]!.jobCode).toBe(CW_JOB.second.code);
    await page.context().close();
  });

  // BUG: src/server/contract-time-core.ts `_contractClockIn` uses `worker.jobCode ?? DEFAULT_JOB_CODE`
  // ("ACT001"), a code that does not exist. Proposed fix: resolve like time-core.ts - the worker's
  // code if it is active, else the JobCode with isDefault && isActive, else return
  // fail("No job code is set for this worker and there is no default job code. See an admin.").
  test("a worker with no job code never gets the made-up code ACT001", async ({ browser }) => {
    const w = await makeWorker({ name: "Kj NoCode", jobCode: null });
    const page = await openCrewKiosk(browser, 24);
    await pickKioskWorker(page, w.name);
    await clockIn(page).click();
    await expectSaneJobCode(page, w.id);
    await page.context().close();
  });

  // Same bug: a code that was retired after assignment is copied onto the new entry.
  test("a worker whose job code was deactivated does not get the retired code", async ({ browser }) => {
    const w = await makeWorker({ name: "Kj Retired", jobCode: CW_JOB.inactive.code });
    const page = await openCrewKiosk(browser, 25);
    await pickKioskWorker(page, w.name);
    await clockIn(page).click();
    await expectSaneJobCode(page, w.id);
    await page.context().close();
  });

  // Same bug: a code that was deleted is copied onto the new entry.
  test("a worker whose job code was deleted does not get a non-existent code", async ({ browser }) => {
    const w = await makeWorker({ name: "Kj Deleted", jobCode: "GONE-CODE-1" });
    const page = await openCrewKiosk(browser, 26);
    await pickKioskWorker(page, w.name);
    await clockIn(page).click();
    await expectSaneJobCode(page, w.id);
    await page.context().close();
  });

  test("the default job code exists and is active in the test data (precondition for the fallback)", async () => {
    const def = await db.jobCode.findFirst({ where: { isDefault: true, isActive: true } });
    expect(def?.code).toBe(JOB_CODE.code);
  });
});

test.describe("kiosk contract crew: failures", () => {
  for (const mode of ["500", "stale"] as const) {
    test(`punch fails cleanly on ${mode} and records nothing`, async ({ browser }) => {
      const w = await makeWorker({ name: `Kx Fail${mode}` });
      const page = await openCrewKiosk(browser, mode === "500" ? 27 : 28);
      await pickKioskWorker(page, w.name);
      await failServerActions(page, mode);
      await clockIn(page).click();
      await expect(toast(page, mode === "500" ? SERVER_ERROR : STALE_ERROR)).toBeVisible();
      await expectNoCrash(page);
      expect(await entriesOf(w.id)).toHaveLength(0);
      await page.context().close();
    });
  }

  test("the roster failing to load does not crash the kiosk", async ({ browser }) => {
    const page = await openCrewKiosk(browser, 29, {
      beforeCrew: async (p) => {
        await failServerActions(p, "abort");
      },
    }).catch(() => null);
    // openCrewKiosk waits for the 'Agency staff' label, which is rendered even if the list fails.
    expect(page).not.toBeNull();
    await expectNoCrash(page!);
    await page!.context().close();
  });

  test("a failed punch can be retried and then succeeds", async ({ browser }) => {
    const w = await makeWorker({ name: "Kx Retry" });
    const page = await openCrewKiosk(browser, 30);
    await pickKioskWorker(page, w.name);
    await failServerActions(page, "500", { times: 1, match: "CLOCK_IN" });
    await clockIn(page).click();
    await expect(toast(page, SERVER_ERROR)).toBeVisible();
    expect(await entriesOf(w.id)).toHaveLength(0);
    // The kiosk stays on the same screen: punch again.
    await clockIn(page).click();
    await expect(toast(page, /clocked in at/i)).toBeVisible();
    expect(await entriesOf(w.id)).toHaveLength(1);
    await page.context().close();
  });
});
