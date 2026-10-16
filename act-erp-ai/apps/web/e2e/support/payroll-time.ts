/**
 * Constants and helpers for the payroll / time-tracking / employee-time specs
 * (slot 4). Seeded by e2e/seed-parts/40-payroll-time.ts.
 */
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { computeEntryTotals, businessLocalToDate } from "../../src/lib/time-rules";
import { db } from "./db";
import { ADMIN_STATE, BASE_URL } from "./test-data";

export const PT_PASSWORD = "E2e-Pt-Pass-1!";

/** Employees created by the seed part. Specs import these, never hard-code. */
export const PT = {
  alice: { employeeId: "EMP-2026-0901", name: "Alice Approver", email: "alice@e2e.test" }, // ADMIN linked to an employee
  pat: { employeeId: "EMP-2026-0902", name: "Pat Pending", email: "pat@e2e.test" },
  rita: { employeeId: "EMP-2026-0903", name: "Rita Rejected", email: "rita@e2e.test" },
  opal: { employeeId: "EMP-2026-0904", name: "Opal Open", email: "opal@e2e.test" },
  alma: { employeeId: "EMP-2026-0905", name: "Alma Autoclosed", email: "alma@e2e.test" },
  zed: { employeeId: "EMP-2026-0906", name: "Zed Zerohours", email: "zed@e2e.test" },
  tina: { employeeId: "EMP-2026-0907", name: "Tina Tracker", email: "tina@e2e.test" },
  dana: { employeeId: "EMP-2026-0908", name: "Dana Daylight", email: "dana@e2e.test" },
  olga: { employeeId: "EMP-2026-0909", name: "Olga Overnight", email: "olga@e2e.test" },
  kira: { employeeId: "EMP-2026-0910", name: "Kira Kiosk", email: "kira@e2e.test" },
  fiona: { employeeId: "EMP-2026-0911", name: "Fiona Force", email: "fiona@e2e.test" },
  bruno: { employeeId: "EMP-2026-0912", name: "Bruno Bulk", email: "bruno@e2e.test" },
  rex: { employeeId: "EMP-2026-0913", name: "Rex Reviewer", email: "rex@e2e.test" },
  ella: { employeeId: "EMP-2026-0914", name: "Ella Employee", email: "ella@e2e.test" }, // logs in; own time + pay stubs
  penny: { employeeId: "EMP-2026-0915", name: "Penny Prereview", email: "penny@e2e.test" }, // PENDING_REVIEW
} as const;

/** Fixed pay periods (far in the past so they never overlap the base seed's periods). */
export const PERIOD_A = { title: "PT Period A", start: "2025-03-01", end: "2025-03-14", pay: "2025-03-19" };
export const PERIOD_B = { title: "PT Period B", start: "2025-03-15", end: "2025-03-28", pay: "2025-04-02" };
export const PERIOD_C = { title: "PT Period C", start: "2025-04-01", end: "2025-04-14", pay: "2025-04-18" };
/** Far-future dates used by the create/overlap tests (cleaned up by each test). */
export const FUTURE = { start: "2031-01-05", end: "2031-01-18", pay: "2031-01-23" };

/** Wall-clock America/Chicago time -> instant. */
export function ct(ymd: string, hhmm: string): Date {
  const d = businessLocalToDate(`${ymd}T${hhmm}`, "America/Chicago", "later");
  if (!d) throw new Error(`Bad Central time ${ymd} ${hhmm}`);
  return d;
}

export const dateOnly = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

type EntryOpts = {
  breakMin?: number; // one break in the middle of the shift
  approval?: "PENDING" | "APPROVED" | "REJECTED";
  source?: "MANUAL" | "KIOSK" | "WEB" | "AUTO";
  jobCode?: string;
  autoClosed?: boolean;
  approvalNotes?: string | null;
  editReason?: string | null;
  open?: boolean; // ACTIVE with no clock-out
  clockInAt?: Date; // explicit instants (override ymd/hhmm)
  clockOutAt?: Date | null;
  status?: "ACTIVE" | "ON_BREAK";
  kioskLabel?: string;
  clockInPhotoKey?: string;
  clockOutPhotoKey?: string;
};

/** Insert a finished (or open) entry straight into the DB. */
export async function makeEntry(
  employeeId: string, // Employee.employeeId (EMP-...)
  ymd: string,
  inHHMM: string,
  outHHMM: string | null,
  o: EntryOpts = {},
) {
  const emp = await db.employee.findUniqueOrThrow({ where: { employeeId } });
  const clockIn = o.clockInAt ?? ct(ymd, inHHMM);
  const clockOut = o.open ? null : (o.clockOutAt ?? ct(ymd, outHHMM!));
  const breaks: { startTime: Date; endTime: Date }[] = [];
  if (o.breakMin && clockOut) {
    const mid = new Date(clockIn.getTime() + Math.floor((clockOut.getTime() - clockIn.getTime()) / 2));
    breaks.push({ startTime: mid, endTime: new Date(mid.getTime() + o.breakMin * 60_000) });
  }
  const totals = clockOut ? computeEntryTotals({ clockIn, clockOut, breaks }) : null;
  const approval = o.open ? "PENDING" : (o.approval ?? "APPROVED");
  return db.timeEntry.create({
    data: {
      employeeId: emp.id,
      date: dateOnly(ymd),
      clockIn,
      clockOut,
      jobCode: o.jobCode ?? "E2E100",
      source: o.source ?? "MANUAL",
      status: o.open ? (o.status ?? "ACTIVE") : approval === "PENDING" ? "COMPLETED" : approval,
      approvalStatus: approval,
      approvalDate: approval === "PENDING" ? null : new Date(),
      approvalNotes: o.approvalNotes ?? null,
      editReason: o.editReason ?? null,
      autoClosed: o.autoClosed ?? false,
      totalWorkMin: totals?.totalWorkMin ?? 0,
      totalBreakMin: totals?.totalBreakMin ?? 0,
      kioskLabel: o.kioskLabel ?? null,
      clockInPhotoKey: o.clockInPhotoKey ?? null,
      clockOutPhotoKey: o.clockOutPhotoKey ?? null,
      breaks: breaks.length
        ? { create: breaks.map((b) => ({ ...b, durationMin: o.breakMin!, type: "BREAK" as const })) }
        : undefined,
    },
  });
}

/** Remove every time entry of one seeded employee (call in afterEach/afterAll). */
export async function clearEntries(employeeId: string, where: object = {}) {
  // Only touches seeded-era history (before 2026) so each employee's base-period hours survive.
  await db.timeEntry.deleteMany({ where: { employee: { employeeId }, date: { lt: new Date("2026-01-01T00:00:00Z") }, ...where } });
}

/** Wire the browser pane for a seeded user (once per spec file). Re-uses a saved session when fresh. */
export async function sessionFor(
  browser: Browser,
  key: string,
  email: string,
  password = PT_PASSWORD,
): Promise<BrowserContext> {
  const dir = path.resolve("e2e/.auth");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `pt-${key}.json`);
  const fresh =
    existsSync(file) && existsSync(ADMIN_STATE) && statSync(file).mtimeMs > statSync(ADMIN_STATE).mtimeMs;
  if (fresh) return browser.newContext({ baseURL: BASE_URL, storageState: file });
  // Explicitly empty: a file-level storageState in test.use() would otherwise leak in.
  const ctx = await browser.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel(/email or username/i).fill(email);
  await page.getByLabel(/^password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await ctx.storageState({ path: file });
  await page.close();
  return ctx;
}

/** Entries-tab URL for one employee and date range. */
export function entriesUrl(name: string, from: string, to: string) {
  return `/admin/time-tracking?tab=entries&from=${from}&to=${to}&q=${encodeURIComponent(name)}`;
}

/** Same formatting as the app's formatHours(). */
export function hoursText(minutes: number) {
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** Minimal PDF-looking bytes; `tag` makes each file's sha256 unique. */
export function fakePdf(tag: string): Buffer {
  return Buffer.from(
    `%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n% ${tag}\ntrailer<</Root 1 0 R>>\n%%EOF\n`,
  );
}

/**
 * A real one-page PDF laid out like the payroll provider's template, so the
 * app's paystub parser can read the name, SSN last 4, period, pay date and net pay.
 * Dates are MM/DD/YYYY. `tag` makes the bytes (and sha256) unique.
 */
export function paystubPdf(o: { name: string; last4: string; start: string; end: string; payDate: string; tag: string }): Buffer {
  const NL = "\n";
  const lines = [
    `${o.name} ***-**-${o.last4}, Hourly`,
    `Pay Period: ${o.start} - ${o.end}`,
    `Pay Date: ${o.payDate}`,
    `Check number: ${o.tag}`,
    `Net Pay 1,234.56`,
  ];
  const text = lines.map((l) => "(" + l.split("(").join("").split(")").join("") + ") Tj T*").join(" ");
  const stream = `BT /F1 12 Tf 50 700 Td 14 TL ${text} ET`;
  const objs = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    `<</Length ${stream.length}>>${NL}stream${NL}${stream}${NL}endstream`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];
  let out = `%PDF-1.4${NL}`;
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj${NL}${body}${NL}endobj${NL}`;
  });
  const xref = out.length;
  out += `xref${NL}0 ${objs.length + 1}${NL}0000000000 65535 f ${NL}`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n ${NL}`;
  out += `trailer<</Size ${objs.length + 1}/Root 1 0 R>>${NL}startxref${NL}${xref}${NL}%%EOF${NL}`;
  return Buffer.from(out, "latin1");
}

/** Put an object in the in-memory fake S3 (key is "<prefix>/<path>"). */
export async function putFakeS3(key: string, body: Buffer, contentType: string) {
  const res = await fetch(`${process.env.AWS_ENDPOINT_URL}/${process.env.S3_BUCKET}/${key}`, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: new Uint8Array(body),
  });
  if (!res.ok) throw new Error(`fake S3 PUT failed: ${res.status}`);
}

export type { Page };
