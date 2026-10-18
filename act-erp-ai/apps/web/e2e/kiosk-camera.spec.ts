import { test, expect, type Page } from "@playwright/test";
import { fakeS3Keys } from "./support/fake-s3";
import { toast } from "./support/helpers";
import {
  CAMERA_DENIED,
  CAMERA_HANG,
  CAMERA_NO_API,
  CAMERA_SPY,
  EMP,
  adminTimeTracking,
  breakBtn,
  camCalls,
  camLive,
  cancelBtn,
  cardWithPin,
  clockInBtn,
  clockOutBtn,
  entriesOf,
  openCard,
  openEntry,
  openK,
  pinInput,
  resetEmployee,
  rosterButton,
  typePin,
} from "./support/kiosk";
import { BASE_URL, env } from "./support/test-data";

const PIN = env("E2E_EMPLOYEE_PIN");
const video = (p: Page) => p.locator("video");

/** True when the preview video holds a stream whose tracks are all live. */
const previewIsLive = (p: Page) =>
  video(p).evaluate((v: HTMLVideoElement) => {
    const s = v.srcObject as MediaStream | null;
    return !!s && s.getTracks().length > 0 && s.getTracks().every((t) => t.readyState === "live");
  });

test.beforeEach(async () => {
  await resetEmployee(EMP.flow);
  await resetEmployee(EMP.brk);
});

test.describe("kiosk camera: only on while the confirm card is open", () => {
  test("camera is off on the roster, turns on for the confirm card, and off again on Cancel", async ({
    browser,
  }) => {
    const page = await openK(browser, "cam-roster", { init: [CAMERA_SPY] });
    await expect(rosterButton(page, EMP.flow.name)).toBeVisible();
    // Roster: no preview element, no camera request, no live track.
    await expect(video(page)).toHaveCount(0);
    expect(await camCalls(page)).toBe(0);
    expect(await camLive(page)).toBe(0);
    await page.getByRole("button", { name: /list/i }).click();
    await page.getByPlaceholder(/search by name/i).fill("Alba");
    expect(await camCalls(page)).toBe(0);

    await rosterButton(page, EMP.flow.name).click();
    await expect(video(page)).toBeVisible();
    await expect.poll(() => camLive(page)).toBe(1);
    expect(await camCalls(page)).toBe(1); // only one stream is ever opened
    await expect.poll(() => previewIsLive(page)).toBe(true);

    await cancelBtn(page).click();
    await expect(video(page)).toHaveCount(0);
    await expect.poll(() => camLive(page)).toBe(0);

    // Opening the card again starts it again (a new request).
    await rosterButton(page, EMP.flow.name).click();
    await expect.poll(() => camLive(page)).toBe(1);
    expect(await camCalls(page)).toBe(2);
    await page.context().close();
  });

  test("ID entry also warms the camera up only for the card", async ({ browser }) => {
    const page = await openK(browser, "cam-on", { init: [CAMERA_SPY] });
    await page.getByRole("button", { name: /enter id/i }).click();
    expect(await camCalls(page)).toBe(0);
    const input = page.getByPlaceholder("Full ID or last digits");
    await input.fill("not-a-real-id");
    await input.press("Enter");
    await expect(toast(page, /unknown employee id/i)).toBeVisible();
    expect(await camCalls(page)).toBe(0); // a failed lookup never turns the camera on
    await input.fill(EMP.flow.employeeId);
    await input.press("Enter");
    await expect.poll(() => camLive(page)).toBe(1);
    await page.context().close();
  });

  test("a wrong PIN keeps the card (and camera) open; a punch turns the camera off", async ({ browser }) => {
    const page = await openK(browser, "cam-punch", { init: [CAMERA_SPY] });
    await cardWithPin(page, EMP.flow, "9999");
    await expect.poll(() => camLive(page)).toBe(1);
    await clockInBtn(page).click();
    await expect(toast(page, /incorrect pin/i)).toBeVisible();
    expect(await camLive(page)).toBe(1); // still on: the person is still at the card

    await typePin(page, PIN);
    await clockInBtn(page).click();
    await expect(toast(page, /clocked in/i)).toBeVisible();
    await expect(video(page)).toHaveCount(0);
    await expect.poll(() => camLive(page)).toBe(0);

    await cardWithPin(page, EMP.flow, PIN);
    await expect.poll(() => camLive(page)).toBe(1);
    await clockOutBtn(page).click();
    await expect(toast(page, /clocked out/i)).toBeVisible();
    await expect.poll(() => camLive(page)).toBe(0);
    await page.context().close();
  });

  test("camera stops when the tab goes to the background, and the punch still works without a photo", async ({
    browser,
  }) => {
    const page = await openK(browser, "cam-hidden", { init: [CAMERA_SPY] });
    await cardWithPin(page, EMP.flow, PIN);
    await expect.poll(() => camLive(page)).toBe(1);

    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => camLive(page)).toBe(0);
    await expect(pinInput(page)).toBeVisible(); // the card itself is untouched

    // Coming back does not turn the camera on by itself.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(await camLive(page)).toBe(0);

    await clockInBtn(page).click();
    await expect(toast(page, /clocked in/i)).toBeVisible();
    const [entry] = await entriesOf(EMP.flow);
    expect(entry!.clockInPhotoKey).toBeNull();
    expect(await camLive(page)).toBe(0);

    // A fresh card after that starts the camera again.
    await cardWithPin(page, EMP.flow, PIN);
    await expect.poll(() => camLive(page)).toBe(1);
    await page.context().close();
  });

  test("30 seconds of no touches resets the card and turns the camera off; activity restarts the timer", async ({
    browser,
  }) => {
    const page = await openK(browser, "cam-idle", { init: [CAMERA_SPY], clock: true });
    await openCard(page, EMP.flow);
    await expect.poll(() => camLive(page)).toBe(1);

    await page.clock.fastForward(20_000);
    await expect(pinInput(page)).toBeVisible();
    await pinInput(page).click(); // a tap counts as activity
    await page.clock.fastForward(20_000);
    await expect(pinInput(page)).toBeVisible(); // 40 s since opening, but only 20 s since the tap
    await expect.poll(() => camLive(page)).toBe(1);

    await page.clock.fastForward(11_000);
    // The idle reset ran: camera released. (The exit animation does not finish under
    // a fake clock, so the roster re-appearing is not asserted here.)
    await expect.poll(() => camLive(page)).toBe(0);
    expect(await entriesOf(EMP.flow)).toHaveLength(0);
    await page.context().close();
  });
});

test.describe("kiosk camera: not available", () => {
  const cases: [string, string][] = [
    ["permission denied", CAMERA_DENIED],
    ["no camera API in the browser", CAMERA_NO_API],
  ];
  for (const [label, script] of cases) {
    test(`${label}: preview says Camera off, punches still go through with no photo`, async ({ browser }) => {
      const kiosk = label.startsWith("permission") ? "cam-denied" : "cam-noapi";
      const page = await openK(browser, kiosk, { init: [script] });
      await cardWithPin(page, EMP.flow, PIN);
      await expect(page.getByText("Camera off")).toBeVisible();
      await expect(video(page)).toBeHidden();

      const keysBefore = await fakeS3Keys();
      const bodies: string[] = [];
      page.on("request", (r) => {
        if (r.method() === "POST" && "next-action" in r.headers()) bodies.push(r.postData() ?? "");
      });
      await clockInBtn(page).click();
      await expect(toast(page, /clocked in/i)).toBeVisible();
      expect(bodies.some((b) => b.includes("CLOCK_IN"))).toBe(true);
      expect(bodies.some((b) => b.includes("data:image"))).toBe(false);

      let [entry] = await entriesOf(EMP.flow);
      expect(entry).toMatchObject({ status: "ACTIVE", source: "KIOSK", clockInPhotoKey: null });

      await cardWithPin(page, EMP.flow, PIN);
      await expect(page.getByText("Camera off")).toBeVisible();
      await clockOutBtn(page).click();
      await expect(toast(page, /clocked out/i)).toBeVisible();
      [entry] = await entriesOf(EMP.flow);
      expect(entry).toMatchObject({ status: "COMPLETED", clockInPhotoKey: null, clockOutPhotoKey: null });
      expect(await fakeS3Keys()).toEqual(keysBefore);

      // Admin sees "No photo" markers for the kiosk punch.
      const { context, page: admin } = await adminTimeTracking(browser, EMP.flow);
      await expect(admin.getByText("No photo (in)").first()).toBeVisible();
      await expect(admin.getByText("No photo (out)").first()).toBeVisible();
      await context.close();
      await page.context().close();
    });
  }

  test("camera slow to start: Cancel before it opens leaves nothing running when it finally arrives", async ({
    browser,
  }) => {
    const page = await openK(browser, "cam-hang", { init: [CAMERA_HANG] });
    await openCard(page, EMP.flow);
    expect(await camCalls(page)).toBe(1);
    await cancelBtn(page).click();
    await page.evaluate(() => (window as unknown as { __camRelease: () => void }).__camRelease());
    // The late stream was created, then stopped straight away.
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __cam: { streams: unknown[] } }).__cam.streams.length),
      )
      .toBe(1);
    expect(await camLive(page)).toBe(0);
    await page.context().close();
  });

  test("camera still starting when Clock in is pressed: the punch is not blocked, no photo", async ({
    browser,
  }) => {
    const page = await openK(browser, "cam-hang2", { init: [CAMERA_HANG] });
    await cardWithPin(page, EMP.flow, PIN);
    await clockInBtn(page).click();
    await expect(toast(page, /clocked in/i)).toBeVisible();
    const [entry] = await entriesOf(EMP.flow);
    expect(entry!.clockInPhotoKey).toBeNull();
    await page.context().close();
  });
});

test.describe("kiosk camera: photos", () => {
  test("clock in and clock out store a JPEG each; the admin sees and opens them", async ({ browser }) => {
    const page = await openK(browser, "cam-photo", { init: [CAMERA_SPY] });
    await cardWithPin(page, EMP.flow, PIN);
    await expect.poll(() => camLive(page)).toBe(1);
    await expect(page.getByText("Camera off")).toHaveCount(0);
    await clockInBtn(page).click();
    await expect(toast(page, /clocked in/i)).toBeVisible();
    let [entry] = await entriesOf(EMP.flow);
    expect(entry!.clockInPhotoKey).toMatch(
      new RegExp(`^kiosk-photos/employee/\\d{4}/\\d{2}/${entry!.id}-in\\.jpg$`),
    );
    expect(entry!.clockOutPhotoKey).toBeNull();
    expect((await fakeS3Keys()).some((k) => k.endsWith(entry!.clockInPhotoKey!))).toBe(true);

    await cardWithPin(page, EMP.flow, PIN);
    await clockOutBtn(page).click();
    await expect(toast(page, /clocked out/i)).toBeVisible();
    [entry] = await entriesOf(EMP.flow);
    expect(entry!.clockOutPhotoKey).toMatch(new RegExp(`${entry!.id}-out\\.jpg$`));
    expect((await fakeS3Keys()).some((k) => k.endsWith(entry!.clockOutPhotoKey!))).toBe(true);
    await expect.poll(() => camLive(page)).toBe(0);
    await page.context().close();

    // Admin: thumbnails on the time-tracking page, large photos in the dialog.
    const { context, page: admin } = await adminTimeTracking(browser, EMP.flow);
    const thumbIn = admin.getByRole("img", { name: "Clock in", exact: true }).first();
    const thumbOut = admin.getByRole("img", { name: "Clock out", exact: true }).first();
    await expect(thumbIn).toBeVisible();
    await expect(thumbOut).toBeVisible();
    await expect
      .poll(() => thumbIn.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0))
      .toBe(true);
    await admin.getByTitle("Clock in photo").click();
    const dialog = admin.getByRole("dialog", { name: /punch photos/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("img")).toHaveCount(2);
    await expect
      .poll(() =>
        dialog.getByRole("img").first().evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0),
      )
      .toBe(true);

    // The photo route: admin gets a JPEG, anonymous is refused, bad input is a clean 4xx.
    const url = `/api/punch-photo?type=employee&id=${entry!.id}&side=in`;
    const ok = await context.request.get(url);
    expect(ok.status()).toBe(200);
    expect(ok.headers()["content-type"]).toBe("image/jpeg");
    expect((await ok.body()).subarray(0, 3).toString("hex")).toBe("ffd8ff");
    expect((await context.request.get("/api/punch-photo?type=employee&id=x&side=sideways")).status()).toBe(400);
    expect((await context.request.get("/api/punch-photo?type=employee&id=nope&side=in")).status()).toBe(404);
    expect((await context.request.get("/api/punch-photo?type=bogus&id=x&side=in")).status()).toBe(400);
    const anon = await browser.newContext({ baseURL: BASE_URL });
    const anonRes = await anon.request.get(url, { maxRedirects: 0 });
    expect(anonRes.status()).toBeGreaterThanOrEqual(300);
    expect(anonRes.status()).toBeLessThan(400);
    expect(anonRes.headers()["location"]).toContain("/login");
    await anon.close();
    await context.close();
  });

  test("break and end break take no photo and upload nothing", async ({ browser }) => {
    await openEntry(EMP.brk, 45);
    const page = await openK(browser, "cam-break", { init: [CAMERA_SPY] });
    const keysBefore = await fakeS3Keys();
    const bodies: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && "next-action" in r.headers()) bodies.push(r.postData() ?? "");
    });
    await cardWithPin(page, EMP.brk, PIN);
    await breakBtn(page).click();
    await expect(toast(page, /break started/i)).toBeVisible();
    await cardWithPin(page, EMP.brk, PIN);
    await page.getByRole("button", { name: /end break/i }).click();
    await expect(toast(page, /break ended/i)).toBeVisible();
    expect(bodies.some((b) => b.includes("START_BREAK"))).toBe(true);
    expect(bodies.some((b) => b.includes("data:image"))).toBe(false);
    expect(await fakeS3Keys()).toEqual(keysBefore);
    const [entry] = await entriesOf(EMP.brk);
    expect(entry!.clockInPhotoKey).toBeNull();
    expect(await camLive(page)).toBe(0);
    await page.context().close();
  });
});
