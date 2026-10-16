/**
 * Shared bits for the access-control + smoke specs: dedicated users, fixed row
 * ids, a tiny fake-S3 writer, and a login helper that returns a browser
 * context holding a real session.
 */
import { expect, type Browser, type BrowserContext } from "@playwright/test";
import { BASE_URL, env } from "./test-data";

/** One password for every access-area user (fake, test only). */
export const ACC_PASSWORD = "E2e-Access-Pass-1!";
export const ACC_NEW_PASSWORD = "E2e-Access-New-Pass-2!";

/** Dedicated users created by e2e/seed-parts/10-access.ts. */
export const ACC_USERS = {
  /** Terminated 10 days ago: read-only grace window. Owns a payslip + document. */
  grace: { email: "gina.grace@e2e.test", name: "Gina Grace", employeeId: "EMP-ACC-0001" },
  /** Active colleague who owns the "other person's" files. */
  other: { email: "olive.other@e2e.test", name: "Olive Other", employeeId: "EMP-ACC-0002" },
  /** Logs in, then access ends (terminated 200 days ago) before the matrix runs. */
  ended: { email: "edna.ended@e2e.test", name: "Edna Ended", employeeId: "EMP-ACC-0003" },
  /** Session-expiry test: access is ended mid-session. */
  dying: { email: "dax.dying@e2e.test", name: "Dax Dying", employeeId: "EMP-ACC-0004" },
  /** Session-revocation test: tokenVersion is bumped mid-session. */
  tokenVer: { email: "tess.token@e2e.test", name: "Tess Token", employeeId: "EMP-ACC-0005" },
  /** Role-change test: promoted and demoted in the DB mid-session. */
  promo: { email: "pat.promo@e2e.test", name: "Pat Promo", employeeId: "EMP-ACC-0006" },
  /** Logout + back-button tests. */
  logout: { email: "lou.logout@e2e.test", name: "Lou Logout", employeeId: "EMP-ACC-0007" },
  /** Active when the page loads, read-only by the time the form is submitted. */
  flip: { email: "fay.flip@e2e.test", name: "Fay Flip", employeeId: "EMP-ACC-0008" },
  /** New hire awaiting approval: read-only. */
  pending: { email: "penny.pending@e2e.test", name: "Penny Pending", employeeId: "EMP-ACC-0009" },
  /** Forced password change: gate + validation + failure injection. */
  mustGate: { email: "mia.must@e2e.test", name: "Mia Must", employeeId: "EMP-ACC-0010" },
  /** Forced password change: the successful change. */
  mustOk: { email: "milo.must@e2e.test", name: "Milo Must", employeeId: "EMP-ACC-0011" },
  /** Admin linked to an employee record that ended long ago: cannot sign in. */
  endedAdmin: { email: "ada.endedadmin@e2e.test", name: "Ada EndedAdmin", employeeId: "EMP-ACC-0012" },
  /** Admin with no employee record who must change a temporary password. */
  mustAdmin: { email: "mo.mustadmin@e2e.test", name: "Mo MustAdmin" },
  /** Failure-injection on change-password (self-service from Settings). */
  settingsPw: { email: "sam.settings@e2e.test", name: "Sam Settings", employeeId: "EMP-ACC-0013" },
} as const;

/** Fixed row ids (set explicitly in the seed so specs never guess). */
export const ACC_IDS = {
  docErin: "acc-doc-erin",
  docOther: "acc-doc-other",
  docGrace: "acc-doc-grace",
  payErin: "acc-pay-erin",
  payOther: "acc-pay-other",
  payGrace: "acc-pay-grace",
  reimErin: "acc-reim-erin",
  reimOther: "acc-reim-other",
  rcptErin: "acc-rcpt-erin",
  rcptOther: "acc-rcpt-other",
  /** Employee punch (owner: Olive) with a clock-in photo. */
  entryPhoto: "acc-entry-photo",
  /** Employee punch with no photo at all. */
  entryNoPhoto: "acc-entry-nophoto",
  contractEntryPhoto: "acc-cte-photo",
  dept: "acc-dept",
  hireImport: "acc-hire-import",
  inviteToken: "acc-invite-token",
  inviteExpiredToken: "acc-invite-expired",
} as const;

/** Object keys exactly as the app stores them (prefix = the legacy "bucket" name). */
export const ACC_KEYS = {
  docErin: "documents/acc-erin-doc.pdf",
  docOther: "documents/acc-other-doc.pdf",
  docGrace: "documents/acc-grace-doc.pdf",
  payErin: "payroll/acc-erin-stub.pdf",
  payOther: "payroll/acc-other-stub.pdf",
  payGrace: "payroll/acc-grace-stub.pdf",
  rcptErin: "reimbursement-receipts/acc-erin-receipt.pdf",
  rcptOther: "reimbursement-receipts/acc-other-receipt.pdf",
  punchIn: "kiosk-photos/acc/entry-in.jpg",
  contractPunchIn: "kiosk-photos/acc/contract-in.jpg",
} as const;

/** What each stored file contains, so a test can tell WHOSE file came back. */
export const ACC_BODY = (key: string) => `%PDF-1.4\nE2E-ACCESS-OBJECT:${key}\n`;
/** Minimal JPEG-ish bytes for punch photos / avatars (content is not decoded by the app). */
export const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);

/** Put an object into the in-memory fake S3 under the app's bucket. */
export async function putS3(key: string, body: string | Buffer, contentType: string) {
  const res = await fetch(`${process.env.AWS_ENDPOINT_URL}/${env("S3_BUCKET")}/${key}`, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: typeof body === "string" ? body : new Uint8Array(body),
  });
  if (!res.ok) throw new Error(`fake S3 PUT ${key} failed: ${res.status}`);
}

/** Seed every object the access specs read. Safe to call repeatedly. */
export async function putAccessObjects(extra: { avatarFor?: string } = {}) {
  for (const k of [
    ACC_KEYS.docErin,
    ACC_KEYS.docOther,
    ACC_KEYS.docGrace,
    ACC_KEYS.payErin,
    ACC_KEYS.payOther,
    ACC_KEYS.payGrace,
    ACC_KEYS.rcptErin,
    ACC_KEYS.rcptOther,
  ]) {
    await putS3(k, ACC_BODY(k), "application/pdf");
  }
  await putS3(ACC_KEYS.punchIn, JPEG_BYTES, "image/jpeg");
  await putS3(ACC_KEYS.contractPunchIn, JPEG_BYTES, "image/jpeg");
  if (extra.avatarFor) await putS3(`profile-pics/${extra.avatarFor}/avatar`, JPEG_BYTES, "image/jpeg");
}

/** Sign in through the real login form in a fresh context; resolves once past /login. */
export async function loginContext(
  browser: Browser,
  email: string,
  password = ACC_PASSWORD,
  opts: { next?: string } = {},
): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  await page.goto(opts.next ? `/login?next=${encodeURIComponent(opts.next)}` : "/login");
  await page.getByLabel(/email or username/i).fill(email);
  await page.getByLabel(/^password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.close();
  return context;
}

/** Fill and submit the login form on an already-open /login page. */
export async function submitLoginForm(
  page: import("@playwright/test").Page,
  email: string,
  password = ACC_PASSWORD,
) {
  await page.getByLabel(/email or username/i).fill(email);
  await page.getByLabel(/^password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
}

/** Ids for the {tokens} used in route paths (see support/access-routes.ts). */
export async function loadRouteTokens(): Promise<Record<string, string>> {
  const { db } = await import("./db");
  const { EMPLOYEE, JOB_CODE, KIOSK_NEW_SLUG, PAYROLL_PERIOD_TITLE } = await import("./test-data");
  const [erin, cw, job, period] = await Promise.all([
    db.employee.findFirstOrThrow({ where: { employeeId: EMPLOYEE.employeeId } }),
    db.contractWorker.findUniqueOrThrow({ where: { workerId: "CW-ACC1" } }),
    db.jobCode.findUniqueOrThrow({ where: { code: JOB_CODE.code } }),
    db.payrollCalendar.findFirstOrThrow({ where: { title: PAYROLL_PERIOD_TITLE } }),
  ]);
  return {
    ...ACC_IDS,
    erin: erin.id,
    cw: cw.id,
    job: job.id,
    period: period.id,
    dept: ACC_IDS.dept,
    hire: ACC_IDS.hireImport,
    invite: ACC_IDS.inviteToken,
    inviteExpired: ACC_IDS.inviteExpiredToken,
    newKiosk: KIOSK_NEW_SLUG,
  };
}

export const resolveTokens = (path: string, tokens: Record<string, string>) =>
  path.replace(/\{(\w+)\}/g, (_, k: string) => tokens[k] ?? `MISSING-${k}`);

/** Wait for a heading or main region so "page rendered" is a real assertion. */
export async function expectPageContent(page: import("@playwright/test").Page) {
  await expect(page.getByRole("heading").or(page.locator("main")).first()).toBeVisible();
}
