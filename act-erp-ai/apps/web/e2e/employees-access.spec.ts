import { test, expect, type Page } from "@playwright/test";
import { db } from "./support/db";
import { fakeS3Keys } from "./support/fake-s3";
import { delayServerActions, expectNoCrash, failServerActions, openKiosk, toast } from "./support/helpers";
import {
  CODES,
  CUSTOM_PIN,
  DEFAULT_PIN,
  PEOPLE,
  PEOPLE_PASSWORD,
  choose,
  hashMatches,
  loginAs,
  personRow,
  personUrl,
  pngBytes,
  selectField,
  textField,
} from "./support/people";
import { ADMIN_STATE, KIOSK_ACTIVE_SLUG } from "./support/test-data";
import { NETWORK_ERROR } from "./support/action-errors";

test.use({ storageState: ADMIN_STATE });

const card = (page: Page, title: string) =>
  page.locator(`xpath=//*[normalize-space(text())="${title}"]/ancestor::div[contains(@class,"rounded")][1]`).first();

async function open(page: Page, key: keyof typeof PEOPLE) {
  await page.goto(await personUrl(key));
  // dev server: the first hit on a cold route can render a transient 404
  if (await page.getByText("Page not found").count()) await page.reload();
  await expect(page.getByText(PEOPLE[key].name).first()).toBeVisible();
}

async function editCard(page: Page, title: string, tab?: string) {
  if (tab) await page.getByRole("tab", { name: tab }).click();
  const c = card(page, title);
  await c.getByRole("button", { name: /^edit$/i }).click();
  return c;
}

test.describe("admin: reset an employee's password", () => {
  async function openReset(page: Page) {
    await open(page, "paula");
    await page.getByRole("button", { name: /reset password/i }).click();
    return page.getByRole("dialog", { name: /reset password/i });
  }

  test("mismatched passwords are refused client-side and nothing changes", async ({ page }) => {
    const before = await personRow("paula");
    const d = await openReset(page);
    await textField(d, "New password").fill("Another-Pass-1");
    await textField(d, "Confirm password").fill("Different-Pass-1");
    await d.getByRole("button", { name: /^save$/i }).click();
    await expect(toast(page, /passwords don.t match/i)).toBeVisible();
    expect((await personRow("paula")).user.passwordHash).toBe(before.user.passwordHash);
  });

  test("failure keeps the old password", async ({ page }) => {
    const before = await personRow("paula");
    const d = await openReset(page);
    await textField(d, "New password").fill("Another-Pass-1");
    await textField(d, "Confirm password").fill("Another-Pass-1");
    await failServerActions(page, "abort");
    await d.getByRole("button", { name: /^save$/i }).click();
    await expect(toast(page, NETWORK_ERROR)).toBeVisible();
    expect((await personRow("paula")).user.passwordHash).toBe(before.user.passwordHash);
  });

  test("reset forces a password change at next sign-in, revokes sessions; double click sends one call", async ({
    page,
    browser,
  }) => {
    const before = await personRow("paula");
    const old = await loginAs(browser, PEOPLE.paula.email, PEOPLE_PASSWORD);
    const d = await openReset(page);
    await textField(d, "New password").fill("Fresh-Temp-Pass-9");
    await textField(d, "Confirm password").fill("Fresh-Temp-Pass-9");
    const calls = await delayServerActions(page, 1200);
    await d.getByRole("button", { name: /^save$/i }).dblclick();
    await expect(toast(page, `Password reset for ${PEOPLE.paula.name}`)).toBeVisible();
    expect(calls.count()).toBe(1);

    const after = await personRow("paula");
    expect(after.user.mustChangePassword).toBe(true);
    expect(after.user.tokenVersion).toBe(before.user.tokenVersion + 1);
    expect(await hashMatches("Fresh-Temp-Pass-9", after.user.passwordHash)).toBe(true);

    // The old session is dead; the new password leads to the forced change page.
    await old.goto("/dashboard");
    await expect(old).toHaveURL(/\/login/);
    await old.context().close();
    const fresh = await loginAs(browser, PEOPLE.paula.email, "Fresh-Temp-Pass-9");
    await expect(fresh).toHaveURL(/\/change-password/);
    await fresh.context().close();
  });

  test("unticking 'require them to choose their own' lets them straight in", async ({ page, browser }) => {
    const d = await openReset(page);
    await textField(d, "New password").fill("Keep-This-Pass-7");
    await textField(d, "Confirm password").fill("Keep-This-Pass-7");
    await d.getByRole("checkbox").click();
    await d.getByRole("button", { name: /^save$/i }).click();
    await expect(toast(page, /password reset/i)).toBeVisible();
    expect((await personRow("paula")).user.mustChangePassword).toBe(false);
    const p = await loginAs(browser, PEOPLE.paula.email, "Keep-This-Pass-7");
    await expect(p).not.toHaveURL(/change-password/);
    await p.context().close();
  });
});

test.describe("admin: reset kiosk PIN", () => {
  test("cancelling the confirmation changes nothing", async ({ page }) => {
    await open(page, "pinn");
    page.once("dialog", (d) => void d.dismiss());
    await page.getByRole("button", { name: /reset kiosk pin/i }).click();
    expect(await hashMatches(CUSTOM_PIN, (await personRow("pinn")).kioskPinHash)).toBe(true);
  });

  test("failure leaves the PIN alone", async ({ page }) => {
    await open(page, "pinn");
    await failServerActions(page, "abort");
    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: /reset kiosk pin/i }).click();
    await expect(toast(page, NETWORK_ERROR)).toBeVisible();
    expect(await hashMatches(CUSTOM_PIN, (await personRow("pinn")).kioskPinHash)).toBe(true);
  });

  test("reset sets the temporary PIN 3214 and the kiosk asks for it", async ({ page, browser }) => {
    await open(page, "pinn");
    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: /reset kiosk pin/i }).click();
    await expect(toast(page, "Kiosk PIN reset to 3214")).toBeVisible();
    const e = await personRow("pinn");
    expect(await hashMatches(DEFAULT_PIN, e.kioskPinHash)).toBe(true);
    expect(await db.auditLog.count({ where: { action: "kiosk.pin_reset", resource: `Employee:${e.id}` } })).toBe(1);

    const kiosk = await openKiosk(browser, KIOSK_ACTIVE_SLUG);
    await kiosk.getByRole("button", { name: new RegExp(PEOPLE.pinn.name) }).first().click();
    await expect(kiosk.getByText(/enter the temporary pin from your admin/i)).toBeVisible();
    await kiosk.getByPlaceholder("••••").fill(DEFAULT_PIN);
    await kiosk.getByRole("button", { name: /^clock in$/i }).click();
    await expect(kiosk.getByText(/choose your new pin/i)).toBeVisible();
    await kiosk.context().close();
  });
});

test.describe("admin: make or remove admin access", () => {
  test("promote then demote revokes the session each time", async ({ page }) => {
    await open(page, "rory");
    const v0 = (await personRow("rory")).user.tokenVersion;
    await page.getByRole("button", { name: /make admin/i }).click();
    await page.getByRole("dialog").getByRole("button", { name: /confirm/i }).click();
    await expect(toast(page, "Admin access granted")).toBeVisible();
    const a = await personRow("rory");
    expect(a.user.role).toBe("ADMIN");
    expect(a.user.tokenVersion).toBe(v0 + 1);
    // An admin cannot be terminated from the detail page.
    await expect(page.getByRole("button", { name: /^terminate$/i })).toBeDisabled();

    await page.getByRole("button", { name: /remove admin access/i }).click();
    await page.getByRole("dialog").getByRole("button", { name: /confirm/i }).click();
    await expect(toast(page, "Admin access removed")).toBeVisible();
    expect((await personRow("rory")).user.role).toBe("EMPLOYEE");
  });

  test("failure keeps the role; a person who was terminated meanwhile cannot be promoted", async ({ page }) => {
    await open(page, "rory");
    await page.getByRole("button", { name: /make admin/i }).click();
    await failServerActions(page, "abort", { times: 1 });
    await page.getByRole("dialog").getByRole("button", { name: /confirm/i }).click();
    await expect(toast(page, NETWORK_ERROR)).toBeVisible();
    expect((await personRow("rory")).user.role).toBe("EMPLOYEE");

    await open(page, "rory");
    await page.getByRole("button", { name: /make admin/i }).click();
    await db.employee.update({ where: { employeeId: PEOPLE.rory.employeeId }, data: { employmentStatus: "TERMINATED", terminationDate: new Date() } });
    try {
      await page.getByRole("dialog").getByRole("button", { name: /confirm/i }).click();
      await expect(toast(page, /only active employees can be made admins/i)).toBeVisible();
      expect((await personRow("rory")).user.role).toBe("EMPLOYEE");
    } finally {
      await db.employee.update({ where: { employeeId: PEOPLE.rory.employeeId }, data: { employmentStatus: "ACTIVE", terminationDate: null } });
    }
  });
});

test.describe("admin: profile picture", () => {
  const input = (page: Page) => page.locator('input[type="file"]').first();

  test("uploads a valid image, stores it and records the url", async ({ page }) => {
    await open(page, "pico");
    await input(page).setInputFiles({ name: "me.png", mimeType: "image/png", buffer: pngBytes() });
    await expect(toast(page, "Profile picture updated")).toBeVisible();
    const e = await personRow("pico");
    expect(e.profilePic).toBe(`/api/employees/${e.id}/profile-pic`);
    expect((await fakeS3Keys()).some((k) => k.includes(`profile-pics/${e.id}/avatar`))).toBe(true);
  });

  test("wrong type, fake image and oversize image are refused with a message", async ({ page }) => {
    await open(page, "pico");
    const before = (await personRow("pico")).updatedAt;
    await input(page).setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await expect(toast(page, /unsupported file type/i)).toBeVisible();
    await input(page).setInputFiles({ name: "fake.png", mimeType: "image/png", buffer: Buffer.from("not really a png") });
    await expect(toast(page, /contents don.t match its type/i)).toBeVisible();
    const big = Buffer.concat([pngBytes(), Buffer.alloc(5 * 1024 * 1024 + 10)]);
    await input(page).setInputFiles({ name: "big.png", mimeType: "image/png", buffer: big });
    await expect(toast(page, /file is too large \(max 5 mb\)/i)).toBeVisible();
    expect((await personRow("pico")).updatedAt).toEqual(before);
  });

  test("failure shows an error and keeps the old picture", async ({ page }) => {
    await open(page, "pico");
    const before = (await personRow("pico")).profilePic;
    await failServerActions(page, "abort");
    await input(page).setInputFiles({ name: "me2.png", mimeType: "image/png", buffer: pngBytes(16) });
    await expect(toast(page, NETWORK_ERROR)).toBeVisible();
    await expectNoCrash(page);
    expect((await personRow("pico")).profilePic).toBe(before);
  });
});

test.describe("admin: inline edit", () => {
  test("rename in the sidebar; a one-letter name is refused; the login name follows", async ({ page }) => {
    await open(page, "edith");
    await page.getByRole("button", { name: PEOPLE.edith.name }).click();
    await page.locator("input.h-8").fill("E");
    await page.locator("button:has(svg.lucide-save)").click();
    await expect(toast(page, /name too short/i)).toBeVisible();
    await page.locator("input.h-8").fill("Edith Renamed");
    await page.locator("button:has(svg.lucide-save)").click();
    await expect(toast(page, "Saved")).toBeVisible();
    const e = await personRow("edith");
    expect(e.name).toBe("Edith Renamed");
    expect(e.user.name).toBe("Edith Renamed");
    await db.employee.update({ where: { id: e.id }, data: { name: PEOPLE.edith.name } });
    await db.user.update({ where: { id: e.userId }, data: { name: PEOPLE.edith.name } });
  });

  test("profile card saves; a future date of birth is refused", async ({ page }) => {
    await open(page, "edith");
    const c = await editCard(page, "Profile");
    await textField(c, "Nationality").fill("Canadian");
    await textField(c, "City").fill("Houston");
    await c.getByRole("button", { name: /^save$/i }).click();
    await expect(toast(page, "Saved")).toBeVisible();
    expect(await personRow("edith")).toMatchObject({ nationality: "Canadian", city: "Houston" });

    const c2 = await editCard(page, "Profile");
    await textField(c2, "DOB").fill("2999-01-01");
    await c2.getByRole("button", { name: /^save$/i }).click();
    await expect(toast(page, /date of birth must be in the past/i)).toBeVisible();
    expect((await personRow("edith")).dateOfBirth).toBeNull();
  });

  test("employment card saves; a silly hire year is refused; failure and double click", async ({ page }) => {
    await open(page, "edith");
    const c = await editCard(page, "Employment", "Work");
    await textField(c, "Job title").fill("Lead Fabricator");
    await textField(c, "Date of hire").fill("1940-01-01");
    await c.getByRole("button", { name: /^save$/i }).click();
    await expect(toast(page, /date of hire looks wrong/i)).toBeVisible();
    expect((await personRow("edith")).jobTitle).not.toBe("Lead Fabricator");

    await textField(c, "Date of hire").fill("2024-03-01");
    const calls = await delayServerActions(page, 1200);
    await c.getByRole("button", { name: /^save$/i }).dblclick();
    await expect(toast(page, "Saved")).toBeVisible();
    expect(calls.count()).toBe(1);
    expect(await personRow("edith")).toMatchObject({ jobTitle: "Lead Fabricator" });

    const c2 = await editCard(page, "Employment");
    await textField(c2, "Job title").fill("Never Saved");
    await failServerActions(page, "abort");
    await c2.getByRole("button", { name: /^save$/i }).click();
    await expect(toast(page, NETWORK_ERROR)).toBeVisible();
    expect((await personRow("edith")).jobTitle).toBe("Lead Fabricator");
  });

  test("a supervisor loop is refused", async ({ page }) => {
    const supa = await personRow("supa");
    const supb = await personRow("supb");
    await db.employee.update({ where: { id: supb.id }, data: { supervisorId: supa.id } });
    try {
      await open(page, "supa");
      const c = await editCard(page, "Employment", "Work");
      await choose(page, selectField(c, "Supervisor"), PEOPLE.supb.name);
      await c.getByRole("button", { name: /^save$/i }).click();
      await expect(toast(page, /reporting loop/i)).toBeVisible();
      expect((await personRow("supa")).supervisorId).toBeNull();
    } finally {
      await db.employee.update({ where: { id: supb.id }, data: { supervisorId: null } });
    }
  });

  test("a department deleted meanwhile is refused with a clear message", async ({ page }) => {
    const dept = await db.department.create({ data: { name: "E2E Vanishing Dept" } });
    await open(page, "edith");
    const c = await editCard(page, "Employment", "Work");
    await choose(page, selectField(c, "Department"), "E2E Vanishing Dept");
    await db.department.delete({ where: { id: dept.id } });
    await c.getByRole("button", { name: /^save$/i }).click();
    await expect(toast(page, /department no longer exists/i)).toBeVisible();
  });

  test("primary job code: choose, switch, clear; assignments stay in sync", async ({ page }) => {
    await open(page, "edith");
    const pick = async (label: RegExp | string) => {
      const c = await editCard(page, "Compensation", "Work");
      await choose(page, selectField(c, "Primary job code"), label);
      await c.getByRole("button", { name: /^save$/i }).click();
      await expect(c.getByRole("button", { name: /^edit$/i })).toBeVisible(); // edit mode closed = saved
    };
    const id = (code: string) => db.jobCode.findUniqueOrThrow({ where: { code } });

    await pick(new RegExp(CODES.a.code));
    let e = await personRow("edith");
    expect(e.primaryJobCodeId).toBe((await id(CODES.a.code)).id);
    expect(await db.jobCodeAssignment.count({ where: { employeeId: e.id, isPrimary: true } })).toBe(1);

    await pick(new RegExp(CODES.b.code));
    e = await personRow("edith");
    expect(e.primaryJobCodeId).toBe((await id(CODES.b.code)).id);
    const rows = await db.jobCodeAssignment.findMany({ where: { employeeId: e.id } });
    expect(rows.filter((r) => r.isPrimary)).toHaveLength(1);

    await pick("—");
    e = await personRow("edith");
    expect(e.primaryJobCodeId).toBeNull();
    expect(await db.jobCodeAssignment.count({ where: { employeeId: e.id, isPrimary: true } })).toBe(0);
    await db.jobCodeAssignment.deleteMany({ where: { employeeId: e.id } });
  });

  test("a job code deleted meanwhile is refused", async ({ page }) => {
    const jc = await db.jobCode.create({ data: { code: "PPXVAN", title: "Vanishing" } });
    await open(page, "edith");
    const c = await editCard(page, "Compensation", "Work");
    await choose(page, selectField(c, "Primary job code"), /PPXVAN/);
    await db.jobCode.delete({ where: { id: jc.id } });
    await c.getByRole("button", { name: /^save$/i }).click();
    await expect(toast(page, /job code no longer exists/i)).toBeVisible();
  });

  test("an unknown employee id shows the not-found page", async ({ page }) => {
    await page.goto("/admin/employees/does-not-exist");
    await expect(page.getByText(/not found|404/i).first()).toBeVisible();
  });
});
