/**
 * Constants and helpers for the schedules specs (admin calendar + My schedule).
 * The matching rows are created by e2e/seed-parts/50-schedules.ts.
 */
import { expect, type Browser, type Locator, type Page } from "@playwright/test";
import { db } from "./db";
import { BASE_URL } from "./test-data";

export const SCHED_PASSWORD = "E2e-Sched-Pass-1!";

export const DEPT_A = "E2E Sched Dept A";
export const DEPT_B = "E2E Sched Dept B";

/** Second active job code (the base seed only has E2E100). */
export const JOB_CODE_2 = { code: "E2E200", title: "E2E Assembly" };
/** A code that exists in no table. A shift can still carry it (code deleted later). */
export const DELETED_JOB_CODE = "E2EGONE";

// People. `Sam`..`Uma` are the mutation targets (their shifts are removed after every test).
export const SAM = { employeeId: "EMP-2026-5001", name: "Sam Shifts", email: "sam.shifts@e2e.test" };
export const TARA = { employeeId: "EMP-2026-5002", name: "Tara Tuesday", email: "tara.tuesday@e2e.test" };
export const UMA = { employeeId: "EMP-2026-5003", name: "Uma Unit", email: "uma.unit@e2e.test" };
/** Employee who signs in and checks My schedule. Owns the fixed read-only shifts. */
export const WES = { employeeId: "EMP-2026-5004", name: "Wes Window", email: "wes.window@e2e.test" };
/** Another employee with fixed shifts Wes must never see. */
export const OLIVE = { employeeId: "EMP-2026-5005", name: "Olive Other", email: "olive.other@e2e.test" };
/** Terminated: not in the picker, shifts cannot be edited. */
export const TERRY = { employeeId: "EMP-2026-5006", name: "Terry Terminated", email: "terry.terminated@e2e.test" };
/** Has a fixed far-future shift for the "edit a shift whose code is gone" flows. */
export const LENA = { employeeId: "EMP-2026-5007", name: "Lena Leave", email: "lena.leave@e2e.test" };
/** Active in the seed; tests flip the status in the DB to simulate a stale picker. */
export const STAN = { employeeId: "EMP-2026-5008", name: "Stan Stale", email: "stan.stale@e2e.test" };

/** Employees whose shifts are wiped after each mutating test. */
export const MUTABLE_EMPLOYEE_IDS = [SAM, TARA, UMA, LENA, STAN, TERRY].map((e) => e.employeeId);

export const WES_STATE = "e2e/.auth/sched-wes.json";

/** Fixed, read-only shifts for Wes (see the seed part). `date` is the shift's start date. */
export const WES_SHIFTS = {
  // Regression: 8:00 AM Central must NOT show as 1:00 PM (UTC rendering bug).
  early: { date: "2026-03-04", start: "08:00", end: "16:30", code: "E2E100", dayText: "Wed, Mar 4, 2026", time: "8:00 AM – 4:30 PM" },
  midnight: { date: "2026-03-05", start: "00:00", end: "06:15", code: "E2E100", dayText: "Thu, Mar 5, 2026", time: "12:00 AM – 6:15 AM" },
  noon: { date: "2026-03-06", start: "12:00", end: "20:00", code: "E2E100", dayText: "Fri, Mar 6, 2026", time: "12:00 PM – 8:00 PM" },
  late: { date: "2026-03-09", start: "17:45", end: "23:30", code: "E2E100", dayText: "Mon, Mar 9, 2026", time: "5:45 PM – 11:30 PM" },
  // Day before spring forward (Mar 8, 2026), overnight across the clock change.
  beforeSpring: { date: "2026-03-07", start: "22:00", end: "01:30", code: "E2E100", dayText: "Sat, Mar 7, 2026", time: "10:00 PM – 1:30 AM (next day)" },
  springDay: { date: "2026-03-08", start: "08:15", end: "16:00", code: "E2E100", dayText: "Sun, Mar 8, 2026", time: "8:15 AM – 4:00 PM" },
  // A wall-clock time that does not exist (clocks jump 2:00 -> 3:00).
  springGap: { date: "2026-03-08", start: "02:30", end: "04:30", code: "E2E100", dayText: "Sun, Mar 8, 2026", time: "2:30 AM – 4:30 AM" },
  // Fall back: Sunday Nov 1, 2026 (clocks go 2:00 -> 1:00).
  beforeFall: { date: "2026-10-31", start: "22:00", end: "00:45", code: "E2E100", dayText: "Sat, Oct 31, 2026", time: "10:00 PM – 12:45 AM (next day)" },
  fallDay: { date: "2026-11-01", start: "08:00", end: "16:00", code: "E2E100", dayText: "Sun, Nov 1, 2026", time: "8:00 AM – 4:00 PM" },
  fallAmbiguous: { date: "2026-11-01", start: "01:30", end: "05:00", code: "E2E200", dayText: "Sun, Nov 1, 2026", time: "1:30 AM – 5:00 AM" },
  afterFall: { date: "2026-11-03", start: "13:00", end: "21:30", code: "E2E100", dayText: "Tue, Nov 3, 2026", time: "1:00 PM – 9:30 PM" },
  // Second DST pair, a year on.
  spring2027: { date: "2027-03-14", start: "09:00", end: "17:00", code: "E2E100", dayText: "Sun, Mar 14, 2027", time: "9:00 AM – 5:00 PM" },
  withNotes: { date: "2026-03-11", start: "10:00", end: "14:00", code: "E2E200", dayText: "Wed, Mar 11, 2026", time: "10:00 AM – 2:00 PM", notes: "Bring safety glasses" },
};

export const OLIVE_SHIFT = { date: "2026-03-04", start: "09:00", end: "17:00", code: "E2E100" };

/** Today's date in the machine's local zone: what the shift dialog preselects. */
export function localYmd(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** YYYY-MM-DD as the Date a `@db.Date` column stores (UTC midnight). */
export function dateOnly(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

export function ymdOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function employeeDbId(employeeId: string): Promise<string> {
  const e = await db.employee.findUniqueOrThrow({ where: { employeeId }, select: { id: true } });
  return e.id;
}

/** Remove every shift (and leave) the mutating tests could have left behind. */
export async function cleanupScheduleRows() {
  const ids = (
    await db.employee.findMany({
      where: { employeeId: { in: MUTABLE_EMPLOYEE_IDS } },
      select: { id: true },
    })
  ).map((e) => e.id);
  await db.schedule.deleteMany({ where: { employeeId: { in: ids } } });
  await db.leaveRequest.deleteMany({ where: { employeeId: { in: ids } } });
  await db.notification.deleteMany({ where: { type: "SCHEDULE" } });
  await db.auditLog.deleteMany({ where: { action: { startsWith: "schedule." } } });
  await db.jobCode.deleteMany({ where: { code: { startsWith: "E2ETMP" } } });
  await db.employee.deleteMany({ where: { employeeId: { startsWith: "EMP-TMP-" } } });
  await db.user.deleteMany({ where: { email: { endsWith: "@tmp.e2e.test" } } });
  // Put back anything a test flipped.
  await db.employee.updateMany({
    where: { employeeId: STAN.employeeId },
    data: { employmentStatus: "ACTIVE" },
  });
  await db.jobCode.updateMany({ where: { code: JOB_CODE_2.code }, data: { isActive: true } });
}

/** Insert a shift directly (arrangement, not the thing under test). */
export async function insertShift(opts: {
  employeeId: string;
  date: string;
  start: string;
  end: string;
  code?: string;
  notes?: string | null;
}) {
  return db.schedule.create({
    data: {
      employeeId: await employeeDbId(opts.employeeId),
      date: dateOnly(opts.date),
      startTime: opts.start,
      endTime: opts.end,
      jobCode: opts.code ?? "E2E100",
      notes: opts.notes ?? null,
    },
  });
}

export async function shiftsOf(employeeId: string) {
  return db.schedule.findMany({
    where: { employeeId: await employeeDbId(employeeId) },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });
}

/** Sign in through the UI in a fresh context and save the session. */
export async function saveLogin(browser: Browser, email: string, password: string, statePath: string) {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel(/email or username/i).fill(email);
  await page.getByLabel(/^password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await context.storageState({ path: statePath });
  await context.close();
}

// ────────────────────────────── admin dialog helpers

export async function openShiftDialog(page: Page) {
  await page.goto("/admin/schedules");
  await page.getByRole("button", { name: /new shift/i }).click();
  const dialog = page.getByRole("dialog", { name: /new shift/i });
  await expect(dialog).toBeVisible();
  return dialog;
}

export function createButton(dialog: Locator) {
  return dialog.getByRole("button", { name: /^create$/i });
}

export function startInput(dialog: Locator) {
  return dialog.locator('input[type="time"]').nth(0);
}
export function endInput(dialog: Locator) {
  return dialog.locator('input[type="time"]').nth(1);
}

export async function pickEmployee(dialog: Locator, name: string) {
  await dialog.getByRole("button", { name: new RegExp(`^${name}`) }).click();
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Opens one of the dialog's date fields (by the label above it) and picks `ymd`. */
export async function pickDate(page: Page, field: Locator, ymd: string) {
  await field.click();
  const popover = page.locator("[data-radix-popper-content-wrapper]").last();
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const monthName = MONTHS[m - 1]!;
  for (let i = 0; i < 80; i++) {
    const caption = (await popover.locator(".rdp-caption_label, [role=status], .rdp-root").first().innerText())
      .replace(/\s+/g, " ");
    const shown = MONTHS.findIndex((n) => new RegExp(`${n}\\s+\\d{4}`).test(caption));
    const yearMatch = /(\d{4})/.exec(caption);
    if (shown >= 0 && yearMatch) {
      const diff = (y - Number(yearMatch[1])) * 12 + (m - 1 - shown);
      if (diff === 0) break;
      await popover
        .getByRole("button", { name: diff > 0 ? /next month/i : /previous month/i })
        .click();
    } else {
      break;
    }
  }
  await popover
    .getByRole("button", { name: new RegExp(`${monthName} ${d}(st|nd|rd|th), ${y}`) })
    .click();
}

/** The toast stack as one string (several toasts can be up at once). */
export async function allToasts(page: Page) {
  return page.locator("[data-sonner-toast]").allInnerTexts();
}

/** The shift dialog's date buttons ("Oct 16, 2026"): one in single mode, From and To in range mode. */
export function dateButtons(dialog: Locator) {
  return dialog.getByRole("button", { name: /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/ });
}

/** Weekday toggles in range mode, Monday first (aria-pressed buttons). */
export function weekdayButtons(dialog: Locator) {
  return dialog.locator("button[aria-pressed]");
}

/** Month-grid events on the admin or employee calendar. */
export function calEvents(page: Page, text?: string | RegExp) {
  const all = page.locator(".sx__month-grid-event");
  return text ? all.filter({ hasText: text }) : all;
}

/** Jump the Schedule-X calendar to the month holding `ymd` through its date field. */
export async function gotoMonth(page: Page, ymd: string) {
  const [y, m, d] = ymd.split("-") as [string, string, string];
  const input = page.getByTestId("date-picker-input");
  await input.fill(`${m}/${d}/${y}`);
  await input.press("Enter");
  await expect(page.locator(".sx__range-heading")).toHaveText(`${MONTHS[Number(m) - 1]} ${y}`);
}

/** A throw-away active employee that is listed in the picker (removed by cleanupScheduleRows). */
export async function createTempEmployee(tag: string) {
  const user = await db.user.create({
    data: { email: `${tag}@tmp.e2e.test`, name: `Temp ${tag}`, role: "EMPLOYEE", passwordHash: "x" },
  });
  return db.employee.create({
    data: {
      employeeId: `EMP-TMP-${tag}`,
      userId: user.id,
      name: `Temp ${tag}`,
      email: `${tag}@tmp.e2e.test`,
      gender: "OTHER",
      employmentType: "FULL_PART_TIME",
      compensationType: "HOURLY_RATE",
      compensationValue: 20,
      jobTitle: "Temp",
      dateOfHire: new Date("2024-01-01T00:00:00.000Z"),
      employmentStatus: "ACTIVE",
    },
  });
}
