/**
 * Shared constants and helpers for the employee self-service specs
 * (leave, reimbursements, requests, benefits, documents, notifications, settings).
 * The matching data is created by e2e/seed-parts/20-self-service.ts.
 */
import { expect, type Browser, type Locator, type Page } from "@playwright/test";
import { db, businessYmd } from "./db";
import { BASE_URL } from "./test-data";

export * from "./self-service-data";
import type { SsUser } from "./self-service-data";

export const READ_ONLY_TEXT = /account is read-only/i;

/** Employee row id (cuid) for a business employee id like EMP-2026-0201. */
export async function empDbId(u: SsUser): Promise<string> {
  const e = await db.employee.findUniqueOrThrow({ where: { employeeId: u.employeeId }, select: { id: true } });
  return e.id;
}

/**
 * Sign in through the UI in a fresh context and save the session to
 * e2e/.auth/<key>.json. Call once per spec file (login is rate limited).
 */
export async function loginState(browser: Browser, u: SsUser, key: string, password = u.password): Promise<string> {
  const path = `e2e/.auth/${key}.json`;
  // Empty storage state: the spec's own `test.use({ storageState })` file does not exist yet.
  const context = await browser.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel(/email or username/i).fill(u.email);
  await page.getByLabel(/^password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  await context.storageState({ path });
  await context.close();
  return path;
}

// ── Dates ──────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const ymdToUtc = (s: string) => new Date(`${s}T00:00:00.000Z`);
const utcToYmd = (d: Date) => d.toISOString().slice(0, 10);

/** Business-time (America/Chicago) date, `offset` days from today. */
export function ymdFromToday(offset: number): string {
  return utcToYmd(new Date(ymdToUtc(businessYmd(0)).getTime() + offset * DAY));
}

/** First Monday-Friday on or after `offset` days from today. */
export function weekdayFromToday(offset: number): string {
  let d = ymdToUtc(ymdFromToday(offset));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d = new Date(d.getTime() + DAY);
  return utcToYmd(d);
}

/** The first Monday on or after `offset` days from today. */
export function mondayFromToday(offset: number): string {
  let d = ymdToUtc(ymdFromToday(offset));
  while (d.getUTCDay() !== 1) d = new Date(d.getTime() + DAY);
  return utcToYmd(d);
}

export function addDays(ymd: string, n: number): string {
  return utcToYmd(new Date(ymdToUtc(ymd).getTime() + n * DAY));
}

export const dateOnly = ymdToUtc;
export const currentYear = () => Number(businessYmd(0).slice(0, 4));

/** Counts Monday-Friday days in [start, end]. */
export function weekdaysBetween(start: string, end: string): number {
  let n = 0;
  for (let d = ymdToUtc(start); d <= ymdToUtc(end); d = new Date(d.getTime() + DAY)) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n++;
  }
  return n;
}

// ── Form helpers ─────────────────────────────────────────────────────────

/**
 * The control that follows a `<Label>` with this exact text (the app's labels
 * are not linked with htmlFor, so getByLabel does not work on most dialogs).
 */
export function labelled(scope: Page | Locator, label: string | RegExp): Locator {
  return scope
    .locator("label")
    .filter({ hasText: label })
    .first()
    .locator("xpath=following-sibling::*[1]");
}

/** Pick an option in a Radix select by the text of its label. */
export async function pick(page: Page, scope: Page | Locator, label: string | RegExp, option: string | RegExp) {
  await labelled(scope, label).click();
  await page.getByRole("option", { name: option }).first().click();
}

// ── Files ────────────────────────────────────────────────────────────────

/** A tiny but valid PDF (passes the %PDF magic-byte check). */
export function pdfFile(name = "receipt.pdf", extra = ""): { name: string; mimeType: string; buffer: Buffer } {
  return {
    name,
    mimeType: "application/pdf",
    buffer: Buffer.from(`%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n${extra}`),
  };
}

/** 1x1 transparent PNG. */
export function pngFile(name = "receipt.png"): { name: string; mimeType: string; buffer: Buffer } {
  return {
    name,
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    ),
  };
}

export function textFile(name: string, text: string) {
  return { name, mimeType: "text/plain", buffer: Buffer.from(text) };
}

/** The big number of a StatCard (e.g. "Pending approval"). */
export function statValue(page: Page, label: string | RegExp): Locator {
  return page
    .locator("div.rounded-lg.border")
    .filter({ has: page.locator("span.uppercase", { hasText: label }) })
    .locator("span.text-2xl")
    .first();
}

/**
 * A Monday at least `offset` days away such that [Monday, Monday + spanDays]
 * stays inside one calendar year (so balance math never splits across years).
 */
export function mondayWindow(offset: number, spanDays = 8): string {
  let start = mondayFromToday(offset);
  while (start.slice(0, 4) !== addDays(start, spanDays).slice(0, 4)) start = addDays(start, 7);
  return start;
}

/** Answer the next browser confirm() prompt. */
export function answerNextDialog(page: Page, accept = true) {
  page.once("dialog", (d) => void (accept ? d.accept() : d.dismiss()));
}

/** Put an object straight into the in-memory fake S3 (key like "documents/<id>/file.pdf"). */
export async function putFakeS3(key: string, body: Buffer, contentType: string) {
  const res = await fetch(`${process.env.AWS_ENDPOINT_URL}/${process.env.S3_BUCKET}/${key}`, {
    method: "PUT",
    body: new Uint8Array(body),
    headers: { "content-type": contentType },
  });
  if (!res.ok) throw new Error(`fake S3 put failed: ${res.status}`);
}

/** Wait for any visible toast with this text and assert it. */
export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: text }).first()).toBeVisible();
}
