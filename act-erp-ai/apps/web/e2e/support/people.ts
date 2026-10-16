import { expect, type Browser, type Locator, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { deflateSync } from "node:zlib";
import { db } from "./db";
import { BASE_URL } from "./test-data";
import { NEW_EMAIL_DOMAIN, NEW_PREFIX, PEOPLE } from "./people-data";

export * from "./people-data";

/** The seeded employee row (with its login) for a PEOPLE key. */
export function personRow(key: keyof typeof PEOPLE) {
  return db.employee.findUniqueOrThrow({
    where: { employeeId: PEOPLE[key].employeeId },
    include: { user: true },
  });
}

/** The page route of a seeded employee. */
export async function personUrl(key: keyof typeof PEOPLE) {
  return `/admin/employees/${(await personRow(key)).id}`;
}

/**
 * Form fields in this app use a <Label> that is NOT linked to its input, so
 * getByLabel does not work. These find the input/select that follows a label.
 */
export function textField(scope: Page | Locator, label: string): Locator {
  const l = `normalize-space(.)=${JSON.stringify(label)}`;
  return scope.locator(
    `xpath=.//label[${l}]/following-sibling::*[self::input or self::textarea][1]` +
      ` | .//label[${l}]/following-sibling::*[1]//input[1]`,
  );
}

/** The combobox (shadcn Select trigger) that follows a label. */
export function selectField(scope: Page | Locator, label: string): Locator {
  const l = `normalize-space(.)=${JSON.stringify(label)}`;
  return scope.locator(`xpath=.//label[${l}]/following-sibling::*[self::button][1]`);
}

/** Open a select and choose an option by (partial) name. */
export async function choose(page: Page, trigger: Locator, option: string | RegExp) {
  await trigger.click();
  await page.getByRole("option", { name: option }).first().click();
}

/**
 * A browser context with NO session. Playwright applies the file's
 * `test.use({ storageState })` to browser.newContext() too, so an anonymous
 * context must say so explicitly.
 */
export function anonContext(browser: Browser) {
  return browser.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
}

/** Sign in through the real login form in a brand-new browser context. */
export async function loginAs(
  browser: Browser,
  identifier: string,
  password: string,
): Promise<Page> {
  const context = await anonContext(browser);
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel(/email or username/i).fill(identifier);
  await page.getByLabel(/^password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });
  return page;
}

/** Try to sign in and return the page still on /login (for refused logins). */
export async function failedLogin(
  browser: Browser,
  identifier: string,
  password: string,
): Promise<Page> {
  const context = await anonContext(browser);
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel(/email or username/i).fill(identifier);
  await page.getByLabel(/^password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  return page;
}

/** Does this bcrypt hash match the plain text? */
export const hashMatches = (plain: string, hash: string | null | undefined) =>
  hash ? bcrypt.compare(plain, hash) : Promise.resolve(false);

/**
 * Delete people the specs created through the UI (add dialog, onboarding form).
 * They are ACTIVE with no hours, which would block payroll readiness for the
 * later payroll-csv spec, so every spec that creates people calls this in afterAll.
 */
export async function purgeNewPeople() {
  const users = await db.user.findMany({
    where: {
      OR: [
        { email: { endsWith: `@${NEW_EMAIL_DOMAIN}` } },
        { username: { startsWith: NEW_PREFIX } },
      ],
    },
    select: { id: true },
  });
  if (users.length) await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
}

/** Prefix of every job code a spec creates through the UI. */
export const NEW_CODE_PREFIX = "PPX";

/**
 * Put the job codes back the way seed.ts left them (E2E100 active + default,
 * E2E999 retired) and remove codes the specs created. Later specs (kiosk,
 * schedules) rely on E2E100 being the default.
 */
export async function restoreJobCodes(purge = true) {
  if (purge) await db.jobCode.deleteMany({ where: { code: { startsWith: NEW_CODE_PREFIX } } });
  await db.jobCode.updateMany({ data: { isDefault: false } });
  await db.jobCode.updateMany({
    where: { code: { in: ["E2E100", "PPJC1", "PPJC2", "PPJCDEL", "PPJCUSE"] } },
    data: { isActive: true },
  });
  await db.jobCode.update({ where: { code: "E2E100" }, data: { isDefault: true, isActive: true } });
  await db.jobCode.update({ where: { code: "E2E999" }, data: { isActive: false } });
}

/** Highest EMP-YYYY-NNNN suffix for the current year, so tests can predict the next id. */
export async function maxEmployeeSeq(year = new Date().getFullYear()) {
  const rows = await db.employee.findMany({
    where: { employeeId: { startsWith: `EMP-${year}-` } },
    select: { employeeId: true },
  });
  return rows.reduce((m, r) => Math.max(m, Number(r.employeeId.slice(`EMP-${year}-`.length)) || 0), 0);
}

/** Visible toast helper that also accepts a regex for the whole message. */
export const errorToast = (page: Page, text: string | RegExp) =>
  page.locator("[data-sonner-toast]").filter({ hasText: text }).first();

/** Wait until a condition in the database holds. */
export async function dbEventually<T>(read: () => Promise<T>, check: (v: T) => boolean) {
  await expect.poll(async () => check(await read()), { timeout: 15_000 }).toBe(true);
}

/* ------------------------------- fixtures --------------------------------- */

const crcTable = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** A valid solid-colour PNG (default 8x8). */
export function pngBytes(size = 8): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, 0x80)]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
