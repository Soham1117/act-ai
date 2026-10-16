import { test, expect, type Browser, type Page, type Request } from "@playwright/test";
import { db } from "./support/db";
import { fakeS3Keys } from "./support/fake-s3";
import { delayServerActions, expectNoCrash, failServerActions, toast } from "./support/helpers";
import {
  EMP,
  NEW_PIN,
  TEMP_PIN,
  auditCount,
  breakBtn,
  clockInBtn,
  clockOutBtn,
  empRow,
  endBreakBtn,
  entriesOf,
  kioskSlug,
  openCard,
  openEntry,
  openK,
  pinInput,
  resetEmployee,
  rosterButton,
  emailFor,
  PASSWORD_FOR,
} from "./support/kiosk";
import { ADMIN_STATE, BASE_URL, INACTIVE_EMPLOYEE } from "./support/test-data";

const setRequirePin = (name: string, value: boolean) =>
  db.kioskSession.update({ where: { slug: kioskSlug(name) }, data: { requirePin: value } });

/** Remembers the headers and body of the next server action whose body includes `text`. */
function captureAction(page: Page, text: string) {
  const box: { req?: Request } = {};
  page.on("request", (r) => {
    if (r.method() === "POST" && "next-action" in r.headers() && (r.postData() ?? "").includes(text)) {
      box.req ??= r;
    }
  });
  return box;
}

async function replay(page: Page, req: Request, edit: (body: string) => string = (b) => b) {
  const headers = { ...req.headers() };
  delete headers["content-length"];
  delete headers["host"];
  const res = await page.request.post(req.url(), { headers, data: edit(req.postData() ?? ""), maxRedirects: 0 });
  return { status: res.status(), text: await res.text() };
}

test.describe("kiosk without a PIN (requirePin off)", () => {
  test.beforeEach(async () => {
    await resetEmployee(EMP.flow);
  });

  test("pick a name, no PIN field; clock in, break, end break, clock out; both photos stored", async ({ browser }) => {
    const page = await openK(browser, "np-basic");
    await openCard(page, EMP.flow);
    await expect(pinInput(page)).toHaveCount(0);
    await expect(page.getByText(/enter your pin/i)).toHaveCount(0);
    await expect(clockInBtn(page)).toBeEnabled(); // no PIN needed to enable it

    const sent: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && "next-action" in r.headers()) sent.push(r.postData() ?? "");
    });
    await clockInBtn(page).click();
    await expect(toast(page, /clocked in/i)).toBeVisible();
    expect(sent.some((b) => b.includes("data:image/jpeg"))).toBe(true);
    expect(sent.filter((b) => b.includes("CLOCK_IN")).every((b) => !/"pin":"\d/.test(b))).toBe(true);
    let [entry] = await entriesOf(EMP.flow);
    expect(entry).toMatchObject({ status: "ACTIVE", source: "KIOSK" });
    expect(entry!.clockInPhotoKey).toBeTruthy();
    expect((await fakeS3Keys()).some((k) => k.endsWith(entry!.clockInPhotoKey!))).toBe(true);

    await openCard(page, EMP.flow);
    await breakBtn(page).click();
    await expect(toast(page, /break started/i)).toBeVisible();
    await openCard(page, EMP.flow);
    await endBreakBtn(page).click();
    await expect(toast(page, /break ended/i)).toBeVisible();
    await openCard(page, EMP.flow);
    await clockOutBtn(page).click();
    await expect(toast(page, /clocked out/i)).toBeVisible();
    [entry] = await entriesOf(EMP.flow);
    expect(entry!.status).toBe("COMPLETED");
    expect(entry!.clockOutPhotoKey).toBeTruthy();
    expect(entry!.breaks).toHaveLength(1);
    expect(await auditCount("kiosk.clock_in", (await empRow(EMP.flow)).id)).toBe(1);
    await page.context().close();
  });

  test("ID entry works without a PIN; inactive and unknown IDs are refused", async ({ browser }) => {
    const page = await openK(browser, "np-ids");
    await page.getByRole("button", { name: /enter id/i }).click();
    const input = page.getByPlaceholder("Full ID or last digits");
    await input.fill(INACTIVE_EMPLOYEE.employeeId);
    await input.press("Enter");
    await expect(toast(page, /isn.t active for kiosk use/i)).toBeVisible();
    await input.fill("EMP-2026-9998");
    await input.press("Enter");
    await expect(toast(page, /unknown employee id/i)).toBeVisible();
    await input.fill(EMP.flow.employeeId);
    await input.press("Enter");
    await expect(pinInput(page)).toHaveCount(0);
    await clockInBtn(page).click();
    await expect(toast(page, /clocked in/i)).toBeVisible();
    await page.context().close();
  });

  test("employee ended after the card opened is refused", async ({ browser }) => {
    const page = await openK(browser, "np-ids");
    await openCard(page, EMP.flow);
    await db.employee.update({
      where: { employeeId: EMP.flow.employeeId },
      data: { employmentStatus: "TERMINATED", terminationDate: new Date() },
    });
    await clockInBtn(page).click();
    await expect(toast(page, /isn.t active for kiosk use/i)).toBeVisible();
    expect(await entriesOf(EMP.flow)).toHaveLength(0);
    await page.context().close();
  });

  test("a device without the kiosk cookie cannot punch", async ({ browser }) => {
    const page = await openK(browser, "np-nocookie", { cookie: null });
    await expect(page).toHaveURL(/\/login/);
    await page.context().close();
  });

  test("server failure shows a message and saves nothing; retry works", async ({ browser }) => {
    const page = await openK(browser, "np-fail");
    await openCard(page, EMP.flow);
    await failServerActions(page, "abort", { times: 1, match: "CLOCK_IN" });
    await clockInBtn(page).click();
    await expect(toast(page, /could not reach the server/i)).toBeVisible();
    await expectNoCrash(page);
    expect(await entriesOf(EMP.flow)).toHaveLength(0);
    await clockInBtn(page).click();
    await expect(toast(page, /clocked in/i)).toBeVisible();
    expect(await entriesOf(EMP.flow)).toHaveLength(1);
    await page.context().close();
  });

  test("double tap on Clock in saves one entry", async ({ browser }) => {
    const page = await openK(browser, "np-double");
    await openCard(page, EMP.flow);
    await delayServerActions(page, 1200);
    await clockInBtn(page).dblclick();
    await expect(toast(page, /clocked in/i)).toBeVisible();
    expect(await entriesOf(EMP.flow)).toHaveLength(1);
    await page.context().close();
  });

  test("a PIN sent by a forged request is ignored: the outcome does not change", async ({ browser }) => {
    await openEntry(EMP.flow, 40);
    const page = await openK(browser, "np-forge");
    const cap = captureAction(page, "START_BREAK");
    await openCard(page, EMP.flow);
    await breakBtn(page).click();
    await expect(toast(page, /break started/i)).toBeVisible();
    // Undo the break, then replay the same request with a wrong and a right-looking PIN added.
    const resetBreak = async () => {
      await db.timeBreak.deleteMany({ where: { timeEntry: { employee: { employeeId: EMP.flow.employeeId } } } });
      await db.timeEntry.updateMany({
        where: { employee: { employeeId: EMP.flow.employeeId } },
        data: { status: "ACTIVE" },
      });
    };
    for (const forged of ["9999", "4826"]) {
      await resetBreak();
      const res = await replay(page, cap.req!, (b) => b.replace('"action"', `"pin":"${forged}","action"`));
      expect(res.text).toContain("ON_BREAK");
      expect((await entriesOf(EMP.flow))[0]!.status).toBe("ON_BREAK");
    }
    expect(await auditCount("kiosk.pin_failed", (await empRow(EMP.flow)).id)).toBe(0);
    await page.context().close();
  });

  test("more than 60 punches a minute on one kiosk get a wait message", async ({ browser }) => {
    const page = await openK(browser, "np-rate");
    const cap = captureAction(page, "CLOCK_IN");
    await openCard(page, EMP.flow);
    await clockInBtn(page).click();
    await expect(toast(page, /clocked in/i)).toBeVisible();
    let limited = 0;
    for (let i = 0; i < 70; i++) {
      const res = await replay(page, cap.req!, (b) => b.replace(EMP.flow.employeeId, "EMP-2026-9997"));
      if (res.text.includes("Too many punches on this kiosk")) limited += 1;
      else expect(res.text).toContain("Unknown employee ID");
    }
    expect(limited).toBe(11); // 60 allowed in the minute (1 real + 59 replays), the other 11 refused
    expect(await entriesOf(EMP.flow)).toHaveLength(1);
    await page.context().close();
  });
});

test.describe("kiosk page left open while the PIN setting changes", () => {
  test.beforeEach(async () => {
    await resetEmployee(EMP.flow);
  });

  test("PIN turned on before a name is picked: told to reload; after reload the PIN field is there", async ({ browser }) => {
    const page = await openK(browser, "np-stale");
    await expect(rosterButton(page, EMP.flow.name)).toBeVisible();
    await setRequirePin("np-stale", true);
    try {
      await rosterButton(page, EMP.flow.name).click();
      await expect(toast(page, /reload the page and try again/i)).toBeVisible();
      await expect(pinInput(page)).toHaveCount(0);
      await page.reload();
      await openCard(page, EMP.flow);
      await expect(pinInput(page)).toBeVisible();
    } finally {
      await setRequirePin("np-stale", false);
    }
    await page.context().close();
  });

  test("PIN turned on while a card is open: the punch is refused with the reload message", async ({ browser }) => {
    const page = await openK(browser, "np-stale2");
    await openCard(page, EMP.flow);
    await setRequirePin("np-stale2", true);
    try {
      await clockInBtn(page).click();
      await expect(toast(page, /this kiosk now asks for a pin\. reload the page and try again/i)).toBeVisible();
      expect(await entriesOf(EMP.flow)).toHaveLength(0);
    } finally {
      await setRequirePin("np-stale2", false);
    }
    await page.context().close();
  });

  test("PIN turned off while a temporary-PIN card is open: changing the PIN says PINs are not used", async ({ browser }) => {
    await resetEmployee(EMP.temp, TEMP_PIN);
    const page = await openK(browser, "np-chpin");
    await openCard(page, EMP.temp);
    await pinInput(page).fill(TEMP_PIN);
    await setRequirePin("np-chpin", false);
    try {
      await clockInBtn(page).click();
      await expect(page.getByText("Choose your new PIN")).toBeVisible();
      await page.getByPlaceholder("New PIN").fill(NEW_PIN);
      await page.getByPlaceholder("Confirm PIN").fill(NEW_PIN);
      await page.getByRole("button", { name: /save pin and continue/i }).click();
      await expect(toast(page, /pins are not used at this kiosk/i)).toBeVisible();
      expect(await entriesOf(EMP.temp)).toHaveLength(0);
    } finally {
      await setRequirePin("np-chpin", true);
    }
    await page.context().close();
  });
});

async function adminAt(browser: Browser) {
  const context = await browser.newContext({ storageState: ADMIN_STATE });
  const page = await context.newPage();
  await page.goto("/admin/kiosks");
  return page;
}
/** Clicks until the page has hydrated and the expected thing appears (SSR pages ignore early clicks). */
async function clickUntil(click: () => Promise<void>, shown: () => Promise<void>) {
  await expect(async () => {
    await click();
    await shown();
  }).toPass({ timeout: 15_000 });
}
const switchOf = (page: Page, slug: string) =>
  page.locator("li").filter({ hasText: `/kiosk/${slug} ` }).first().getByRole("switch");

test.describe("admin: Require PIN switch", () => {
  test.beforeEach(async () => {
    await setRequirePin("np-switch", true);
  });

  test("OFF asks first (Cancel keeps it on); confirm turns it off; ON saves at once; kiosk follows", async ({ browser }) => {
    const slug = kioskSlug("np-switch");
    const page = await adminAt(browser);
    const sw = switchOf(page, slug);
    await expect(sw).toBeChecked();
    const confirm = page.getByRole("alertdialog");
    await clickUntil(() => sw.click(), () => expect(confirm).toBeVisible({ timeout: 1500 }));
    await expect(confirm).toContainText(/turn off the pin/i);
    await confirm.getByRole("button", { name: /cancel/i }).click();
    expect((await db.kioskSession.findUniqueOrThrow({ where: { slug } })).requirePin).toBe(true);

    await sw.click();
    await page.getByRole("alertdialog").getByRole("button", { name: /turn off pin/i }).click();
    await expect(toast(page, /pin is no longer required/i)).toBeVisible();
    const row = await db.kioskSession.findUniqueOrThrow({ where: { slug } });
    expect(row.requirePin).toBe(false);
    expect(await auditCount("kiosk.require_pin", row.id)).toBe(1);
    await page.reload();
    await expect(switchOf(page, slug)).not.toBeChecked();

    const kiosk = await openK(browser, "np-switch");
    await resetEmployee(EMP.flow);
    await openCard(kiosk, EMP.flow);
    await expect(pinInput(kiosk)).toHaveCount(0);
    await kiosk.context().close();

    await switchOf(page, slug).click(); // ON: no confirmation
    await expect(toast(page, /pin is now required/i)).toBeVisible();
    expect((await db.kioskSession.findUniqueOrThrow({ where: { slug } })).requirePin).toBe(true);
    const kiosk2 = await openK(browser, "np-switch");
    await openCard(kiosk2, EMP.flow);
    await expect(pinInput(kiosk2)).toBeVisible();
    await kiosk2.context().close();
    await page.context().close();
  });

  test("server failure keeps the old setting and shows a message", async ({ browser }) => {
    const page = await adminAt(browser);
    const slug = kioskSlug("np-switch");
    await db.kioskSession.update({ where: { slug }, data: { requirePin: false } });
    await page.reload();
    await failServerActions(page, "abort");
    await switchOf(page, slug).click();
    await expect(page.getByText(/something went wrong|failed|try again/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect((await db.kioskSession.findUniqueOrThrow({ where: { slug } })).requirePin).toBe(false);
    await page.context().close();
  });

  test("kiosk deleted meanwhile: clear message", async ({ browser }) => {
    const admin = await db.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    await db.kioskSession.create({
      data: { slug: "k6a-gone", label: "Gone", provisionedBy: admin.id, expiresAt: new Date(Date.now() + 86_400_000) },
    });
    const page = await adminAt(browser);
    await db.kioskSession.delete({ where: { slug: "k6a-gone" } });
    // switching ON saves at once
    await clickUntil(() => switchOf(page, "k6a-gone").click(), () => expect(toast(page, /that kiosk was not found/i)).toBeVisible({ timeout: 2000 }));
    await page.context().close();
  });

  test("employees and anonymous callers cannot change the setting", async ({ browser }) => {
    const slug = kioskSlug("np-switch");
    const adminPage = await adminAt(browser);
    const cap = captureAction(adminPage, '"');
    // Capture the real request by switching ON from OFF.
    await db.kioskSession.update({ where: { slug }, data: { requirePin: false } });
    await adminPage.reload();
    await switchOf(adminPage, slug).click();
    await expect(toast(adminPage, /pin is now required/i)).toBeVisible();
    expect(cap.req).toBeTruthy();
    const req = cap.req!;
    await adminPage.context().close();

    // Employee session.
    const empCtx = await browser.newContext({ baseURL: BASE_URL });
    const empPage = await empCtx.newPage();
    await empPage.goto("/login");
    await empPage.getByLabel(/email or username/i).fill(emailFor(EMP.brk));
    await empPage.getByLabel(/^password/i).fill(PASSWORD_FOR(EMP.brk));
    await empPage.getByRole("button", { name: /sign in/i }).click();
    await empPage.waitForURL((u) => !u.pathname.startsWith("/login"));
    await db.kioskSession.update({ where: { slug }, data: { requirePin: false } });
    const asEmployee = await replay(empPage, req);
    expect(asEmployee.text).not.toContain('"ok":true');
    expect((await db.kioskSession.findUniqueOrThrow({ where: { slug } })).requirePin).toBe(false);
    await empCtx.close();

    // Anonymous.
    const anon = await browser.newContext({ baseURL: BASE_URL });
    const anonPage = await anon.newPage();
    const asAnon = await replay(anonPage, req);
    expect(asAnon.text).not.toContain('"ok":true');
    expect((await db.kioskSession.findUniqueOrThrow({ where: { slug } })).requirePin).toBe(false);
    await anon.close();
  });
});
