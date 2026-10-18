import { test, expect } from "@playwright/test";
import { businessYmd, db } from "./support/db";
import { PT, entriesUrl, makeEntry, putFakeS3 } from "./support/payroll-time";
import { ADMIN_STATE } from "./support/test-data";

test.use({ storageState: ADMIN_STATE });

// Smallest valid JPEG (1x1), so the browser can really decode the punch photo.
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);

const line = (page: import("@playwright/test").Page, text: string | RegExp) =>
  page.getByRole("listitem").filter({ hasText: text }).filter({ hasText: /E2E100 ·/ });

test.describe("admin time tracking: Central time display", () => {
  test("spring-forward night shows 10:00 PM to 6:00 AM as 7 hours, and the employee total matches", async ({ page }) => {
    await page.goto(entriesUrl(PT.dana.name, "2024-03-01", "2024-03-31"));
    await expect(line(page, "E2E100 · 10:00 PM → 6:00 AM")).toContainText("7h 00m");
    await expect(page.getByText(/1 entry/)).toBeVisible();
    await expect(page.getByText("7h 00m", { exact: true }).first()).toBeVisible(); // totals by employee
  });

  test("fall-back night shows 9 hours; the repeated 1:30 AM hour counts once per clock reading", async ({ page }) => {
    await page.goto(entriesUrl(PT.dana.name, "2024-11-01", "2024-11-30"));
    await expect(line(page, "10:00 PM → 6:00 AM")).toContainText("9h 00m");
    await expect(line(page, "1:30 AM → 3:00 AM")).toContainText("2h 30m");
    await expect(page.getByText("11h 30m", { exact: true }).first()).toBeVisible(); // 9h + 2h30
    await expect(page.getByText(/2 entries/)).toBeVisible();
  });

  test("overnight shift is filed under the day it started and not duplicated on the next day", async ({ page }) => {
    await page.goto(entriesUrl(PT.olga.name, "2025-05-12", "2025-05-12"));
    await expect(line(page, "10:00 PM → 6:00 AM")).toContainText("8h 00m");
    await page.goto(entriesUrl(PT.olga.name, "2025-05-13", "2025-05-13"));
    await expect(page.getByText(/no entries in this range/i)).toBeVisible();
    await page.goto(entriesUrl(PT.olga.name, "2025-05-12", "2025-05-13"));
    await expect(page.getByText(/1 entry/)).toBeVisible();
  });

  test("breaks are shown and subtracted (8:00 AM to 4:30 PM with a 30 minute break = 8h)", async ({ page }) => {
    await page.goto(entriesUrl(PT.ella.name, "2025-06-02", "2025-06-02"));
    const l = line(page, "8:00 AM → 4:30 PM");
    await expect(l).toContainText("breaks 0h 30m");
    await expect(l).toContainText("8h 00m");
  });

  test("date range and employee filters narrow the list; rejected entries are not in the totals", async ({ page }) => {
    await page.goto(entriesUrl(PT.ella.name, "2025-06-01", "2025-06-30"));
    await expect(page.getByText(/3 entries/).first()).toBeVisible();
    // 8h + 4h pending + 4h approved = 16h; the rejected 4h is excluded.
    await expect(page.getByText("16h 00m", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/rejected entries are excluded from totals/i)).toBeVisible();
    await page.goto(entriesUrl("nobody-with-this-name", "2025-06-01", "2025-06-30"));
    await expect(page.getByText(/no entries in this range/i)).toBeVisible();
  });
});

test.describe("admin time tracking: kiosk punch photos", () => {
  const made: string[] = [];
  test.afterEach(async () => {
    await db.timeEntry.deleteMany({ where: { id: { in: made.splice(0) } } });
  });

  async function kioskEntry(inH: number, outH: number, photos: { in?: string; out?: string }) {
    const e = await makeEntry(PT.kira.employeeId, businessYmd(0), "00:00", null, {
      clockInAt: new Date(Date.now() - inH * 3_600_000),
      clockOutAt: new Date(Date.now() - outH * 3_600_000),
      source: "KIOSK",
      kioskLabel: "E2E Kiosk",
      clockInPhotoKey: photos.in,
      clockOutPhotoKey: photos.out,
      approval: "PENDING",
    });
    // Put the entry on its own business day so the date filter finds it.
    const date = new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(e.clockIn)}T00:00:00Z`);
    await db.timeEntry.update({ where: { id: e.id }, data: { date } });
    made.push(e.id);
    return { e, ymd: date.toISOString().slice(0, 10) };
  }

  test("a recent kiosk punch shows both photos, which really load, and opens them large", async ({ page }) => {
    await putFakeS3("kiosk-photos/pt-kira-in.jpg", JPEG, "image/jpeg");
    await putFakeS3("kiosk-photos/pt-kira-out.jpg", JPEG, "image/jpeg");
    const { ymd } = await kioskEntry(5, 1, { in: "kiosk-photos/pt-kira-in.jpg", out: "kiosk-photos/pt-kira-out.jpg" });
    await page.goto(entriesUrl(PT.kira.name, ymd, businessYmd(0)));
    const row = line(page, PT.kira.name);
    await expect(row).toContainText("E2E Kiosk");
    const thumbIn = row.getByRole("img", { name: "Clock in" });
    await expect(thumbIn).toBeVisible();
    await expect.poll(() => thumbIn.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    await expect(row.getByRole("img", { name: "Clock out" })).toBeVisible();
    await row.getByTitle("Clock in photo").click();
    const dialog = page.getByRole("dialog", { name: /punch photos/i });
    await expect(dialog.getByRole("img", { name: "Clock in" })).toBeVisible();
    await expect(dialog.getByRole("img", { name: "Clock out" })).toBeVisible();
  });

  test("a kiosk punch with no stored photo says 'No photo'", async ({ page }) => {
    const { ymd } = await kioskEntry(5, 1, {});
    await page.goto(entriesUrl(PT.kira.name, ymd, businessYmd(0)));
    const row = line(page, PT.kira.name);
    await expect(row.getByText("No photo (in)")).toBeVisible();
    await expect(row.getByText("No photo (out)")).toBeVisible();
  });

  test("photos older than 30 days show 'Photo expired' and are not requested", async ({ page }) => {
    const old = await makeEntry(PT.kira.employeeId, "2025-09-02", "08:00", "16:00", {
      source: "KIOSK",
      kioskLabel: "E2E Kiosk",
      clockInPhotoKey: "kiosk-photos/pt-kira-old-in.jpg",
      clockOutPhotoKey: "kiosk-photos/pt-kira-old-out.jpg",
    });
    made.push(old.id);
    const photoRequests: string[] = [];
    page.on("request", (r) => r.url().includes("/api/punch-photo") && photoRequests.push(r.url()));
    await page.goto(entriesUrl(PT.kira.name, "2025-09-02", "2025-09-02"));
    const row = line(page, PT.kira.name);
    await expect(row.getByText("Photo expired (in)")).toBeVisible();
    await expect(row.getByText("Photo expired (out)")).toBeVisible();
    await expect(row.getByRole("img", { name: /^Clock (in|out)$/ })).toHaveCount(0);
    expect(photoRequests).toHaveLength(0);
  });

  // BUG (minor): src/components/punch-photos.tsx attaches onError in React; when the 404 arrives before hydration the
  // error event is missed and a broken image stays on screen instead of "Photo expired". Proposed fix: after mount, check img.complete && naturalWidth === 0 in a ref callback.
  test("a photo missing from storage falls back to 'Photo expired' instead of a broken image", async ({ page }) => {
    const { ymd } = await kioskEntry(5, 1, { in: "kiosk-photos/pt-kira-missing.jpg" });
    await page.goto(entriesUrl(PT.kira.name, ymd, businessYmd(0)));
    await expect(line(page, PT.kira.name).getByText("Photo expired (in)")).toBeVisible();
  });

  test("manual entries show no photo badges", async ({ page }) => {
    await page.goto(entriesUrl(PT.dana.name, "2024-03-01", "2024-03-31"));
    await expect(page.getByText(/photo/i)).toHaveCount(0);
  });

  test("the photo API is admin-only", async ({ browser, page }) => {
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const res = await anon.request.get("/api/punch-photo?type=employee&id=x&side=in", { maxRedirects: 0 });
    expect([301, 302, 303, 307, 308, 401, 403]).toContain(res.status());
    await anon.close();
    expect((await page.request.get("/api/punch-photo?type=bogus&id=x&side=in")).status()).toBe(400);
    expect((await page.request.get("/api/punch-photo?type=employee&id=nope&side=in")).status()).toBe(404);
  });
});
