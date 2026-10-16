import { test as base, expect } from "@playwright/test";
import { BASE_URL } from "./support/test-data";
import { calEvents, gotoMonth, OLIVE, OLIVE_SHIFT, SCHED_PASSWORD, WES, WES_SHIFTS, WES_STATE, saveLogin } from "./support/schedules";

// Log in once per file (login is rate limited), then give each test a page on that session.
const test = base.extend({
  page: async ({ browser }, use) => {
    const context = await browser.newContext({ baseURL: BASE_URL, storageState: WES_STATE });
    await use(await context.newPage());
    await context.close();
  },
});

test.beforeAll(async ({ browser }) => {
  await saveLogin(browser, WES.email, SCHED_PASSWORD, WES_STATE);
});

type Shift = (typeof WES_SHIFTS)[keyof typeof WES_SHIFTS];

/** Month grid shows the Central time; the details popup shows date and full range. */
async function checkShift(page: import("@playwright/test").Page, s: Shift) {
  await page.goto("/dashboard/schedule");
  await gotoMonth(page, s.date);
  const [h, m] = s.start.split(":").map(Number) as [number, number];
  const clock = `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
  const ev = calEvents(page, new RegExp(`^${clock}\\s*${s.code}`)).first();
  await expect(ev).toBeVisible();
  await ev.click();
  const dlg = page.getByRole("dialog", { name: /shift/i });
  await expect(dlg).toContainText(s.dayText);
  await expect(dlg).toContainText(s.time);
}

test.describe("My schedule shows Central time", () => {
  // Regression: an 8:00 AM Central shift used to render as 1:00 PM (UTC).
  test("8:00 AM shift is 8:00 AM, not 1:00 PM", async ({ page }) => {
    await page.goto("/dashboard/schedule");
    await gotoMonth(page, WES_SHIFTS.early.date);
    const ev = calEvents(page, /^8:00 AM\s*E2E100/).first();
    await expect(ev).toBeVisible();
    await expect(calEvents(page, /^1:00 PM\s*E2E100/)).toHaveCount(0);
    await ev.click();
    await expect(page.getByRole("dialog")).toContainText("8:00 AM – 4:30 PM");
  });

  for (const key of ["early", "midnight", "noon", "late", "beforeSpring", "springDay", "withNotes", "spring2027", "beforeFall", "fallDay", "fallAmbiguous", "afterFall"] as const) {
    test(`shift ${key} (${WES_SHIFTS[key].date} ${WES_SHIFTS[key].start}) shows its stored time`, async ({ page }) => {
      await checkShift(page, WES_SHIFTS[key]);
    });
  }

  // A wall-clock time inside the spring-forward gap (2:30 AM on Mar 8) does not exist;
  // the calendar shifts it to 3:30 AM. Stored 02:30 should read 2:30 AM.
  test.fixme("a shift inside the spring-forward gap keeps its stored time", async ({ page }) => {
    await checkShift(page, WES_SHIFTS.springGap);
  });

  test("details popup shows notes and overnight marker", async ({ page }) => {
    await checkShift(page, WES_SHIFTS.withNotes);
    await expect(page.getByRole("dialog")).toContainText("Bring safety glasses");
    await page.keyboard.press("Escape");
    await checkShift(page, WES_SHIFTS.beforeSpring);
    await expect(page.getByRole("dialog")).toContainText("(next day)");
  });
});

test.describe("My schedule privacy", () => {
  test("only my own shifts are listed", async ({ page }) => {
    await page.goto("/dashboard/schedule");
    await gotoMonth(page, OLIVE_SHIFT.date);
    await expect(calEvents(page, /^8:00 AM/)).toHaveCount(1);
    await expect(calEvents(page, /^9:00 AM/)).toHaveCount(0); // Olive's 09:00
    await expect(page.getByText(OLIVE.name)).toHaveCount(0);
    await expect(page.getByText("Olive private note")).toHaveCount(0);
  });

  test("an employee cannot open the admin calendar", async ({ page }) => {
    await page.goto("/admin/schedules");
    await expect(page).not.toHaveURL(/\/admin\/schedules/);
  });
});
