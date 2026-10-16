/**
 * Shared constants and helpers for the kiosk (employee side + admin) specs.
 * Every scenario gets its own kiosk slug, so the per-kiosk rate limits
 * (roster 20/min, lookup 30/min, PIN lockout) never leak between tests.
 */
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { expect, type Browser, type Page } from "@playwright/test";
import { businessYmd, db } from "./db";
import { ADMIN_STATE, BASE_URL, IP_INSIDE, env } from "./test-data";

/** Kiosk "names". Slug is `k6-<name>`; the seed part creates one row per name. */
export const KIOSK_NAMES = [
  // PIN flow
  "flow-basic", "flow-states", "flow-states2", "flow-search", "flow-ids", "flow-races", "flow-stale", "flow-double",
  "flow-fail", "flow-abort-newpin",
  // forced PIN change
  "temp-weak", "temp-mismatch", "temp-ok", "temp-wrong", "temp-stale", "temp-fail",
  // lockout
  "lock-emp", "lock-emp2", "lock-ip", "lock-reset",
  // camera
  "cam-roster", "cam-on", "cam-idle", "cam-hidden", "cam-punch", "cam-denied", "cam-noapi",
  "cam-photo", "cam-hang", "cam-hang2", "cam-break",
  // session
  "sess-revoked", "sess-expired", "sess-wrongcookie", "sess-other-a", "sess-other-b", "sess-slide",
  "sess-end", "sess-roster", "sess-lookup", "sess-refresh-fail", "sess-idle",
  // no-PIN kiosks (requirePin = false) and PIN-switch scenarios
  "np-basic", "np-ids", "np-nocookie", "np-fail", "np-double", "np-forge", "np-rate", "np-stale",
  "np-stale2", "np-chpin", "np-switch",
  // admin read-only fixtures
  "adm-expired", "adm-expiring", "adm-revoked", "adm-inactive", "adm-active",
] as const;
/** Kiosks seeded with requirePin = false. Every other seeded kiosk requires the PIN. */
export const NO_PIN_KIOSKS: string[] = ["np-basic", "np-ids", "np-nocookie", "np-fail", "np-double", "np-forge", "np-rate", "np-stale", "np-stale2"];
export type KioskName = (typeof KIOSK_NAMES)[number];

export const kioskSlug = (name: KioskName | string) => `k6-${name}`;
/** The raw device cookie for a seeded kiosk (its sha256 is stored in the DB). */
export const kioskCookie = (name: KioskName | string) => `${env("E2E_KIOSK_COOKIE")}-k6-${name}`;
export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export type Emp = { employeeId: string; name: string; jobTitle?: string; status?: "ACTIVE" | "TERMINATED" };

/** Dedicated people, so each scenario has its own PIN, entries and lockout counters. */
export const EMP = {
  flow: { employeeId: "EMP-2026-6001", name: "Alba Flowers" },
  brk: { employeeId: "EMP-2026-6002", name: "Bram Breakwater" },
  temp: { employeeId: "EMP-2026-6003", name: "Cora Tempest" },
  lockA: { employeeId: "EMP-2026-6004", name: "Dane Lockhart" },
  lockB: { employeeId: "EMP-2026-6005", name: "Esme Lockwood" },
  stale: { employeeId: "EMP-2026-6006", name: "Finn Stalebread" },
  race: { employeeId: "EMP-2026-6007", name: "Gwen Racecourse" },
  search: { employeeId: "EMP-2026-6021", name: "Quill Searchable", jobTitle: "Rigger" },
  twinA: { employeeId: "EMP-2026-6101", name: "Twin Alpha" },
  twinB: { employeeId: "EMP-2027-6101", name: "Twin Beta" },
  twinActive: { employeeId: "EMP-2026-6103", name: "Twin Current" },
  padded: { employeeId: "EMP-2026-0630", name: "Padded Person" },
  soloGone: { employeeId: "EMP-2019-0777", name: "Solo Departed", status: "TERMINATED" },
  twinGone: { employeeId: "EMP-2020-6103", name: "Twin Departed", status: "TERMINATED" },
} satisfies Record<string, Emp>;
/** Five more people for the per-kiosk IP lockout (20 failures / 5 min). */
export const IP_LOCK_EMPS: Emp[] = [1, 2, 3, 4, 5].map((n) => ({
  employeeId: `EMP-2026-60${10 + n}`,
  name: `Ipland${"abcde"[n - 1]!.toUpperCase()} Person`,
}));

export const emailFor = (e: Emp) => `k6-${e.employeeId.toLowerCase()}@e2e.test`;
export const PASSWORD_FOR = (_e: Emp) => "E2e-Kiosk6-Pass-1!";
export const TEMP_PIN = "3214";
export const NEW_PIN = "7391";

// ───────────────────────── database helpers ─────────────────────────

export const empRow = (e: Emp) => db.employee.findUniqueOrThrow({ where: { employeeId: e.employeeId } });

export const entriesOf = (e: Emp) =>
  db.timeEntry.findMany({
    where: { employee: { employeeId: e.employeeId } },
    orderBy: { clockIn: "asc" },
    include: { breaks: true },
  });

/** Back to a known state: ACTIVE, the given PIN, no time entries. */
export async function resetEmployee(e: Emp, pin: string | null = env("E2E_EMPLOYEE_PIN")) {
  await db.timeEntry.deleteMany({ where: { employee: { employeeId: e.employeeId } } });
  const row = await db.employee.findUniqueOrThrow({ where: { employeeId: e.employeeId }, select: { id: true } });
  await db.auditLog.deleteMany({ where: { resource: `Employee:${row.id}` } });
  await db.employee.update({
    where: { employeeId: e.employeeId },
    data: {
      employmentStatus: "ACTIVE",
      terminationDate: null,
      kioskPinHash: pin === null ? null : await bcrypt.hash(pin, 4),
    },
  });
}

export async function setPin(e: Emp, pin: string) {
  await db.employee.update({
    where: { employeeId: e.employeeId },
    data: { kioskPinHash: await bcrypt.hash(pin, 4) },
  });
}

export async function pinMatches(e: Emp, pin: string) {
  const row = await empRow(e);
  return !!row.kioskPinHash && (await bcrypt.compare(pin, row.kioskPinHash));
}

/** An open entry that started `minutesAgo` minutes ago (optionally with an open break). */
export async function openEntry(
  e: Emp,
  minutesAgo: number,
  opts: { onBreak?: boolean } = {},
) {
  const emp = await empRow(e);
  const clockIn = new Date(Date.now() - minutesAgo * 60_000);
  const entry = await db.timeEntry.create({
    data: {
      employeeId: emp.id,
      date: new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(clockIn)),
      clockIn,
      status: opts.onBreak ? "ON_BREAK" : "ACTIVE",
      jobCode: "E2E100",
      source: "KIOSK",
    },
  });
  if (opts.onBreak) {
    await db.timeBreak.create({
      data: { timeEntryId: entry.id, startTime: new Date(Date.now() - 5 * 60_000), type: "BREAK" },
    });
  }
  return entry;
}

/** Move an open entry's start back in time (to make it stale between lookup and click). */
export const backdate = (entryId: string, minutesAgo: number) =>
  db.timeEntry.update({
    where: { id: entryId },
    data: { clockIn: new Date(Date.now() - minutesAgo * 60_000) },
  });

export const auditCount = (action: string, resourceContains?: string) =>
  db.auditLog.count({
    where: { action, ...(resourceContains ? { resource: { contains: resourceContains } } : {}) },
  });

// ───────────────────────── browser helpers ─────────────────────────

/** Init scripts that watch or replace the camera API. Run before the page loads. */
export const CAMERA_SPY = `(() => {
  const md = navigator.mediaDevices;
  const orig = md.getUserMedia.bind(md);
  const cam = { calls: 0, streams: [] };
  window.__cam = cam;
  md.getUserMedia = async (c) => { cam.calls++; const s = await orig(c); cam.streams.push(s); return s; };
  window.__camLive = () => cam.streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === "live").length;
})();`;
/** getUserMedia waits until the test calls window.__camRelease(). */
export const CAMERA_HANG = `(() => {
  const md = navigator.mediaDevices;
  const orig = md.getUserMedia.bind(md);
  const cam = { calls: 0, streams: [] };
  let release;
  const gate = new Promise((r) => (release = r));
  window.__cam = cam;
  window.__camRelease = () => release();
  md.getUserMedia = async (c) => { cam.calls++; await gate; const s = await orig(c); cam.streams.push(s); return s; };
  window.__camLive = () => cam.streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === "live").length;
})();`;
/** Permission denied, like a person (or policy) blocking the camera. */
export const CAMERA_DENIED = `(() => {
  const cam = { calls: 0, streams: [] };
  window.__cam = cam;
  navigator.mediaDevices.getUserMedia = async () => { cam.calls++; throw new DOMException("Permission denied", "NotAllowedError"); };
  window.__camLive = () => 0;
})();`;
/** A browser with no camera API at all. */
export const CAMERA_NO_API = `Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });`;

type CamWindow = { __cam: { calls: number }; __camLive: () => number };
export const camLive = (page: Page) => page.evaluate(() => (window as unknown as CamWindow).__camLive());
export const camCalls = (page: Page) => page.evaluate(() => (window as unknown as CamWindow).__cam.calls);

export type OpenOpts = {
  /** Fake connecting IP (any value works for punching; only activation checks the network). */
  ip?: string;
  init?: string[];
  /** Install a controllable clock (page.clock) before the page loads. */
  clock?: boolean;
  /** Cookie value override (for wrong-cookie tests). Default: the kiosk's own cookie. */
  cookie?: string | null;
  permissions?: string[];
  /** Do not open the page yet. */
  noGoto?: boolean;
};

/** Opens /kiosk/<slug> in a fresh context holding the kiosk's device cookie. */
export async function openK(browser: Browser, name: KioskName | string, opts: OpenOpts = {}): Promise<Page> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    permissions: opts.permissions ?? ["camera"],
    extraHTTPHeaders: { "x-forwarded-for": opts.ip ?? IP_INSIDE },
  });
  if (opts.cookie !== null) {
    await context.addCookies([
      { name: "act_kiosk", value: opts.cookie ?? kioskCookie(name), url: BASE_URL },
    ]);
  }
  for (const script of opts.init ?? []) await context.addInitScript(script);
  const page = await context.newPage();
  if (opts.clock) await page.clock.install();
  if (!opts.noGoto) await page.goto(`/kiosk/${kioskSlug(name)}`);
  return page;
}

export const pinInput = (page: Page) => page.getByPlaceholder("••••");
export const rosterButton = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(name) }).first();

/** Waits for the roster, picks the person, and waits for the confirm card. */
export async function openCard(page: Page, e: Emp) {
  await rosterButton(page, e.name).click();
  await expect(page.getByText(e.employeeId)).toBeVisible();
  await expect(page.getByRole("button", { name: /^cancel$/i })).toBeVisible();
}

export async function typePin(page: Page, pin: string) {
  await pinInput(page).fill(pin);
}

export const clockInBtn = (page: Page) => page.getByRole("button", { name: /^clock in$/i });
export const clockOutBtn = (page: Page) => page.getByRole("button", { name: /^clock out$/i });
export const breakBtn = (page: Page) => page.getByRole("button", { name: /^break$/i });
export const endBreakBtn = (page: Page) => page.getByRole("button", { name: /end break/i });
export const cancelBtn = (page: Page) => page.getByRole("button", { name: /^cancel$/i });

/** Open card + PIN typed (the action button is still to be pressed). */
export async function cardWithPin(page: Page, e: Emp, pin: string) {
  await openCard(page, e);
  await expect(pinInput(page)).toBeVisible();
  await typePin(page, pin);
}

/** An admin looking at the time-tracking page, filtered to one person (last 3 days). */
export async function adminTimeTracking(browser: Browser, e: Emp) {
  const context = await browser.newContext({ storageState: ADMIN_STATE });
  const page = await context.newPage();
  await page.goto(
    `/admin/time-tracking?from=${businessYmd(3)}&to=${businessYmd(0)}&q=${encodeURIComponent(e.name)}`,
  );
  return { context, page };
}
