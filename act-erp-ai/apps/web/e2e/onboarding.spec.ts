import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { db } from "./support/db";
import { fakeS3Keys } from "./support/fake-s3";
import { delayServerActions, expectNoCrash, failServerActions, toast } from "./support/helpers";
import {
  DEPTS,
  NEW_EMAIL_DOMAIN,
  NEW_PREFIX,
  PEOPLE,
  anonContext,
  choose,
  loginAs,
  pngBytes,
  purgeNewPeople,
  selectField,
  textField,
} from "./support/people";
import { ADMIN_STATE, env } from "./support/test-data";
import { NETWORK_ERROR } from "./support/action-errors";

test.use({ storageState: ADMIN_STATE });
test.afterAll(async () => {
  await purgeNewPeople();
  await db.onboardingInvite.deleteMany({ where: { token: { startsWith: "pp-" } } });
  await db.department.deleteMany({ where: { name: { startsWith: "E2E Temp Dept" } } });
});

// After a successful submit the page refreshes (invite now COMPLETED) but the form must still
// show the thank-you message. Assert it strictly.
const DONE_RE = /thanks, you.re all set/i;
const PASS = "Onboard-Pass-123";
const uname = (n: string) => `${NEW_PREFIX}-${n}`;

async function makeInvite(over: Record<string, unknown> = {}) {
  const admin = await db.user.findFirstOrThrow({ where: { email: env("E2E_ADMIN_EMAIL") } });
  return db.onboardingInvite.create({
    data: {
      token: `pp-${randomUUID()}`,
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
      createdById: admin.id,
      employmentType: "FULL_PART_TIME",
      compensationType: "HOURLY_RATE",
      ...over,
    },
  });
}

/** Walk the public wizard through hire-packet steps. Stops before Submit. */
async function fillWizard(
  page: Page,
  v: {
    name?: string;
    email?: string;
    username?: string;
    password?: string;
    confirm?: string;
    ssn?: string;
    doc?: { name: string; buffer: Buffer };
    personalEmail?: string;
  } = {},
) {
  const next = () => page.getByRole("button", { name: /^next/i }).click();
  const name = v.name ?? "Walter Walkthrough";
  await textField(page, "Full name *").fill(name);
  await textField(page, "SSN — last 4 digits *").fill(v.ssn ?? "6789");
  await next(); // address
  await next(); // application (optional fields)
  // Consents
  await textField(page, "Type your full name *").first().fill(name);
  await page.getByText(/agree to the drug\/alcohol testing consent/i).click();
  await textField(page, "Type your full name *").nth(1).fill(name);
  await page.getByText(/agree to the background check authorization/i).click();
  await next();
  // Direct deposit
  await textField(page, "Bank name *").fill("First National Bank");
  await textField(page, "Routing number *").fill("111000025");
  await textField(page, "Account number *").fill("123456789");
  await textField(page, "Type your full name *").fill(name);
  await page.getByText(/authorize direct deposit/i).click();
  await next();
  // Handbook
  await textField(page, "Type your full name *").fill(name);
  await page.getByText(/acknowledge receipt/i).click();
  await next();
  // Documents
  if (v.doc) {
    await page.locator('input[type="file"]').first().setInputFiles({
      name: v.doc.name,
      mimeType: "application/octet-stream",
      buffer: v.doc.buffer,
    });
  }
  await next();
  const email = textField(page, "Work email (leave blank if you don't have one)");
  await email.fill(v.email ?? "");
  await textField(page, "Username (only if no work email above) *").fill(v.username ?? "");
  if (v.personalEmail) await textField(page, "Personal email (optional)").fill(v.personalEmail);
  await textField(page, "Password *").fill(v.password ?? PASS);
  await textField(page, "Confirm password *").fill(v.confirm ?? v.password ?? PASS);
}

const submit = (page: Page) => page.getByRole("button", { name: /^submit$/i });

async function openInvite(browser: import("@playwright/test").Browser, token: string) {
  const ctx = await anonContext(browser);
  const page = await ctx.newPage();
  await page.goto(`/onboard/${token}`);
  if (await page.getByText("Page not found").count()) await page.reload();
  return page;
}

test.describe("onboarding: admin invites", () => {
  async function openDialog(page: Page) {
    await page.goto("/admin/onboarding");
    await page.getByRole("button", { name: /generate invite/i }).click();
    const d = page.getByRole("dialog", { name: /generate onboarding invite/i });
    await expect(d).toBeVisible();
    return d;
  }

  test("creates an invite with the hire's terms; the link opens the wizard", async ({ page, browser }) => {
    const d = await openDialog(page);
    await textField(d, "Job title").fill("Welder II");
    await choose(page, selectField(d, "Department"), DEPTS.staffed.name);
    await d.locator('input[type="date"]').fill("2026-02-02");
    await textField(d, "Compensation value ($)").fill("24.50");
    await d.getByRole("button", { name: /generate link/i }).click();
    const link = d.locator("input[readonly]");
    await expect(link).toHaveValue(/\/onboard\/[0-9a-f-]{36}$/);
    const token = (await link.inputValue()).split("/").pop()!;

    const inv = await db.onboardingInvite.findUniqueOrThrow({ where: { token } });
    expect(inv).toMatchObject({ jobTitle: "Welder II", status: "PENDING", employmentType: "FULL_PART_TIME", compensationType: "HOURLY_RATE" });
    expect(Number(inv.compensationValue)).toBe(24.5);
    expect(inv.dateOfHire?.toISOString().slice(0, 10)).toBe("2026-02-02");
    expect(inv.expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    await db.onboardingInvite.delete({ where: { id: inv.id } }).catch(() => undefined);
    await d.getByRole("button", { name: /^done$/i }).click();

    // The terms are shown on the public page.
    const inv2 = await makeInvite({ jobTitle: "Welder II" });
    const pub = await openInvite(browser, inv2.token);
    await expect(pub.getByText("Role: Welder II")).toBeVisible();
    await pub.context().close();
  });

  test("a silly hire date is refused; a department deleted meanwhile is refused; nothing is created", async ({ page }) => {
    const before = await db.onboardingInvite.count();
    let d = await openDialog(page);
    await d.locator('input[type="date"]').fill("1940-01-01");
    await d.getByRole("button", { name: /generate link/i }).click();
    await expect(toast(page, /date of hire looks wrong/i)).toBeVisible();

    const dept = await db.department.create({ data: { name: "E2E Temp Dept Vanish" } });
    d = await openDialog(page);
    await choose(page, selectField(d, "Department"), "E2E Temp Dept Vanish");
    await db.department.delete({ where: { id: dept.id } });
    await d.getByRole("button", { name: /generate link/i }).click();
    await expect(toast(page, /department no longer exists/i)).toBeVisible();
    expect(await db.onboardingInvite.count()).toBe(before);
  });

  test("generate: failure shows a toast; double click makes one invite", async ({ page }) => {
    const beforeIds = (await db.onboardingInvite.findMany({ select: { id: true } })).map((i) => i.id);
    const before = beforeIds.length;
    let d = await openDialog(page);
    await failServerActions(page, "abort");
    await d.getByRole("button", { name: /generate link/i }).click();
    await expect(toast(page, NETWORK_ERROR)).toBeVisible();
    // The dialog stays open (nothing was lost).
    await expect(d).toBeVisible();
    expect(await db.onboardingInvite.count()).toBe(before);

    d = await openDialog(page);
    const calls = await delayServerActions(page, 1200);
    await d.getByRole("button", { name: /generate link/i }).dblclick();
    await expect(d.locator("input[readonly]")).toBeVisible();
    expect(calls.count()).toBe(1);
    expect(await db.onboardingInvite.count()).toBe(before + 1);
    await db.onboardingInvite.deleteMany({ where: { id: { notIn: beforeIds } } }); // only the invite this test made
  });

  test("revoking an invite makes its link show Expired; revoking twice is refused", async ({ page, browser }) => {
    const inv = await makeInvite({ email: `ppnew-revoke@${NEW_EMAIL_DOMAIN}` });
    await page.goto("/admin/onboarding");
    const row = page.getByRole("listitem").filter({ hasText: inv.email! });
    await row.getByRole("button").last().click();
    await expect(toast(page, "Invite revoked")).toBeVisible();
    const after = await db.onboardingInvite.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.status).toBe("EXPIRED");

    const pub = await openInvite(browser, inv.token);
    await expect(pub.getByText(/this invite has expired/i)).toBeVisible();
    await pub.context().close();

    const inv2 = await makeInvite({ email: `ppnew-revoke2@${NEW_EMAIL_DOMAIN}` });
    await page.goto("/admin/onboarding");
    await db.onboardingInvite.update({ where: { id: inv2.id }, data: { status: "COMPLETED" } });
    await page.getByRole("listitem").filter({ hasText: inv2.email! }).getByRole("button").last().click();
    await expect(toast(page, /already used or revoked/i)).toBeVisible();
  });

  test("revoke: failure keeps the invite pending", async ({ page }) => {
    const inv = await makeInvite({ email: `ppnew-revoke3@${NEW_EMAIL_DOMAIN}` });
    await page.goto("/admin/onboarding");
    await failServerActions(page, "abort");
    await page.getByRole("listitem").filter({ hasText: inv.email! }).getByRole("button").last().click();
    await expect(toast(page, NETWORK_ERROR)).toBeVisible();
    expect((await db.onboardingInvite.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PENDING");
  });
});

test.describe("onboarding: public token pages", () => {
  test("unknown token, landing page, expired, revoked and used links", async ({ browser }) => {
    const bad = await openInvite(browser, "pp-not-a-real-token");
    await expect(bad.getByText(/not found|404/i).first()).toBeVisible();
    await bad.goto("/onboard");
    await expect(bad.getByText(/personal invite link from your admin/i)).toBeVisible();
    await bad.context().close();

    const expired = await makeInvite({ expiresAt: new Date(Date.now() - 1000) });
    const p1 = await openInvite(browser, expired.token);
    await expect(p1.getByText(/this invite has expired/i)).toBeVisible();
    await expect(p1.getByRole("link", { name: /go to sign in/i })).toBeVisible();
    await p1.context().close();

    const used = await makeInvite({ status: "COMPLETED", completedAt: new Date() });
    const p2 = await openInvite(browser, used.token);
    await expect(p2.getByText(/your account has been created/i)).toBeVisible();
    await p2.context().close();
  });
});

test.describe("onboarding: the new hire submits", () => {
  test("end to end: invite -> form -> pending review -> admin approves -> full access", async ({ page, browser }) => {
    const dept = await db.department.findUniqueOrThrow({ where: { name: DEPTS.staffed.name } });
    const inv = await makeInvite({
      departmentId: dept.id,
      jobTitle: "Shop Hand",
      dateOfHire: new Date("2026-03-02T00:00:00Z"),
      compensationValue: 21.25,
    });
    const hire = await openInvite(browser, inv.token);
    await expect(hire.getByText("Role: Shop Hand")).toBeVisible();
    await fillWizard(hire, {
      name: "Walter Walkthrough",
      username: uname("walter"),
      doc: { name: "license.png", buffer: pngBytes() },
    });
    await submit(hire).click();
    await expect(hire.getByText(DONE_RE)).toBeVisible();

    const emp = await db.employee.findFirstOrThrow({
      where: { name: "Walter Walkthrough" },
      include: { user: true, documents: true },
    });
    expect(emp.employeeId).toMatch(/^EMP-\d{4}-\d{4}$/);
    expect(emp).toMatchObject({ employmentStatus: "PENDING_REVIEW", jobTitle: "Shop Hand", departmentId: dept.id, ssnLast4: "6789" });
    expect(emp.dateOfHire?.toISOString().slice(0, 10)).toBe("2026-03-02");
    expect(Number(emp.compensationValue)).toBe(21.25);
    expect(emp.user).toMatchObject({ username: uname("walter"), role: "EMPLOYEE", mustChangePassword: false });
    expect(emp.documents).toHaveLength(1);
    expect((await fakeS3Keys()).some((k) => k.includes(`onboarding/${inv.id}/`))).toBe(true);
    const done = await db.onboardingInvite.findUniqueOrThrow({ where: { id: inv.id } });
    expect(done).toMatchObject({ status: "COMPLETED", completedByEmployeeId: emp.id });
    expect(await db.auditLog.count({ where: { action: "onboarding.complete", resource: `Employee:${emp.id}` } })).toBe(1);
    const packet = await db.onboardingPacketSubmission.findUniqueOrThrow({ where: { employeeId: emp.id } });
    expect(packet.consentVersion).toBeTruthy();
    expect(packet.directDeposit).toMatchObject({ routingNumber: "111000025", accountType: "CHECKING" });

    // The same link now says "Completed"; the invite cannot be reused.
    await hire.reload();
    await expect(hire.getByText(/your account has been created/i)).toBeVisible();
    await hire.context().close();

    // Pending review: they can sign in, read-only.
    const mine = await loginAs(browser, uname("walter"), PASS);
    await expect(mine.getByRole("status").filter({ hasText: /awaiting approval/i })).toBeVisible();
    await mine.context().close();

    // Admin approves from the onboarding page.
    await page.goto("/admin/onboarding");
    const card = page.locator("div").filter({ hasText: "Walter Walkthrough" }).filter({ has: page.getByRole("button", { name: /approve/i }) }).last();
    await card.getByRole("button", { name: /approve/i }).click();
    await expect(toast(page, "Walter Walkthrough approved")).toBeVisible();
    expect((await db.employee.findUniqueOrThrow({ where: { id: emp.id } })).employmentStatus).toBe("ACTIVE");

    const full = await loginAs(browser, uname("walter"), PASS);
    await expect(full.getByRole("status").filter({ hasText: /awaiting approval/i })).toHaveCount(0);
    await full.context().close();
  });

  test("with an email: the invite pre-fills it, and it is saved lower-case", async ({ browser }) => {
    const inv = await makeInvite({ email: `ppnew-prefill@${NEW_EMAIL_DOMAIN}` });
    const page = await openInvite(browser, inv.token);
    await fillWizard(page, { name: "Prefill Person", email: ` PPNEW-Prefill@${NEW_EMAIL_DOMAIN} ` });
    await submit(page).click();
    await expect(page.getByText(DONE_RE)).toBeVisible();
    const emp = await db.employee.findFirstOrThrow({ where: { name: "Prefill Person" } });
    expect(emp.email).toBe(`ppnew-prefill@${NEW_EMAIL_DOMAIN}`);
    await page.context().close();
  });

  test("client-side checks: name, SSN, username format, password length and mismatch", async ({ browser }) => {
    const inv = await makeInvite();
    const page = await openInvite(browser, inv.token);
    await textField(page, "Full name *").fill("X");
    await page.getByRole("button", { name: /^next/i }).click();
    await expect(toast(page, /enter your full name/i)).toBeVisible();
    await textField(page, "Full name *").fill("Check Person");
    await textField(page, "SSN — last 4 digits *").fill("12");
    await page.getByRole("button", { name: /^next/i }).click();
    await expect(toast(page, /last 4 digits of your ssn/i)).toBeVisible();
    await fillWizard(page, { name: "Check Person", ssn: "1234" });
    await submit(page).click();
    await expect(toast(page, /either a work email or a username/i)).toBeVisible();
    await textField(page, "Username (only if no work email above) *").fill("x!");
    await submit(page).click();
    await expect(toast(page, /username: letters, numbers/i)).toBeVisible();
    await textField(page, "Username (only if no work email above) *").fill(uname("chk"));
    await textField(page, "Password *").fill("short");
    await submit(page).click();
    await expect(page.getByText(/at least 8 characters/i).first()).toBeVisible();
    await textField(page, "Password *").fill(PASS);
    await textField(page, "Confirm password *").fill("Other-Pass-123");
    await submit(page).click();
    await expect(toast(page, /passwords don.t match/i)).toBeVisible();
    expect(await db.employee.count({ where: { name: "Check Person" } })).toBe(0);
    await page.context().close();
  });

  test("server-side checks show a message on the page and create nothing", async ({ browser }) => {
    const cases: Array<[string, Parameters<typeof fillWizard>[1], RegExp]> = [
      ["bad email", { email: "not-an-email" }, /check your details.*valid email/i],
      ["email taken", { email: PEOPLE.edith.email }, /work email already has an account/i],
      ["username taken", { username: "admin" }, /./], // replaced below
      ["password too long", { username: uname("long"), password: "p".repeat(80) }, /check your details.*password/i],
    ];
    await db.user.create({ data: { username: uname("taken"), name: "Taken", role: "EMPLOYEE" } });
    cases[2] = ["username taken", { username: uname("taken") }, /username is already taken/i];
    for (const [label, vals, msg] of cases) {
      const inv = await makeInvite();
      const page = await openInvite(browser, inv.token);
      await fillWizard(page, { name: `Case ${label}`, ...vals });
      await submit(page).click();
      await expect(page.getByRole("alert").filter({ hasText: msg })).toBeVisible();
      expect(await db.employee.count({ where: { name: `Case ${label}` } })).toBe(0);
      expect((await db.onboardingInvite.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PENDING");
      await page.context().close();
    }
  });

  test("a revoked or expired invite is refused at submit time", async ({ browser }) => {
    for (const [change, msg] of [
      [{ status: "EXPIRED" as const }, /already used/i],
      [{ expiresAt: new Date(Date.now() - 1000) }, /has expired/i],
    ] as const) {
      const inv = await makeInvite();
      const page = await openInvite(browser, inv.token);
      await fillWizard(page, { name: "Late Person", username: uname(`late${Math.random().toString(36).slice(2, 6)}`) });
      await db.onboardingInvite.update({ where: { id: inv.id }, data: change });
      await submit(page).click();
      await expect(page.getByRole("alert").filter({ hasText: msg })).toBeVisible();
      expect(await db.employee.count({ where: { name: "Late Person" } })).toBe(0);
      await page.context().close();
    }
  });

  test("a bad document stops the whole submission and names the file", async ({ browser }) => {
    const inv = await makeInvite();
    const page = await openInvite(browser, inv.token);
    await fillWizard(page, { name: "Doc Problem", username: uname("doc"), doc: { name: "scan.pdf", buffer: Buffer.from("this is not a pdf") } });
    await submit(page).click();
    await expect(page.getByRole("alert").filter({ hasText: /nothing was submitted.*driver.s license/i })).toBeVisible();
    expect(await db.employee.count({ where: { name: "Doc Problem" } })).toBe(0);
    expect(await db.user.count({ where: { username: uname("doc") } })).toBe(0);
    await page.context().close();
  });

  test("the file picker refuses a wrong type and an over-10MB file", async ({ browser }) => {
    const inv = await makeInvite();
    const page = await openInvite(browser, inv.token);
    const next = () => page.getByRole("button", { name: /^next/i }).click();
    const name = "Picker Person";
    await textField(page, "Full name *").fill(name);
    await textField(page, "SSN — last 4 digits *").fill("1234");
    await next();
    await next();
    await textField(page, "Type your full name *").first().fill(name);
    await page.getByText(/agree to the drug\/alcohol testing consent/i).click();
    await textField(page, "Type your full name *").nth(1).fill(name);
    await page.getByText(/agree to the background check authorization/i).click();
    await next();
    await textField(page, "Bank name *").fill("Bank");
    await textField(page, "Routing number *").fill("111000025");
    await textField(page, "Account number *").fill("999999");
    await textField(page, "Type your full name *").fill(name);
    await page.getByText(/authorize direct deposit/i).click();
    await next();
    await textField(page, "Type your full name *").fill(name);
    await page.getByText(/acknowledge receipt/i).click();
    await next();
    const input = page.locator('input[type="file"]').first();
    await input.setInputFiles({ name: "a.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
    await expect(toast(page, /only pdf, png or jpg/i)).toBeVisible();
    await input.setInputFiles({ name: "big.png", mimeType: "image/png", buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
    await expect(toast(page, /larger than 10 mb/i)).toBeVisible();
    await page.context().close();
  });

  test("failure keeps the invite usable; double click submits once", async ({ browser }) => {
    const inv = await makeInvite();
    const page = await openInvite(browser, inv.token);
    await fillWizard(page, { name: "Retry Person", username: uname("retry") });
    await failServerActions(page, "abort", { times: 1 });
    await submit(page).click();
    await expect(toast(page, NETWORK_ERROR)).toBeVisible();
    await expectNoCrash(page);
    expect((await db.onboardingInvite.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PENDING");
    await page.context().close();

    const page2 = await openInvite(browser, inv.token);
    await fillWizard(page2, { name: "Retry Person", username: uname("retry") });
    const calls = await delayServerActions(page2, 1500);
    await submit(page2).dblclick();
    await expect(page2.getByText(DONE_RE)).toBeVisible();
    expect(calls.count()).toBe(1);
    expect(await db.employee.count({ where: { name: "Retry Person" } })).toBe(1);
    await page2.context().close();
  });
});
