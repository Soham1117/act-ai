import { test, expect, type Page } from "@playwright/test";
import { db } from "./support/db";
import { delayServerActions, expectNoCrash, failServerActions, toast } from "./support/helpers";
import {
  DEFAULT_PIN,
  NEW_EMAIL_DOMAIN,
  NEW_PREFIX,
  PEOPLE,
  PEOPLE_PASSWORD,
  hashMatches,
  loginAs,
  maxEmployeeSeq,
  purgeNewPeople,
  textField,
} from "./support/people";
import { ADMIN_STATE } from "./support/test-data";
import { NETWORK_ERROR } from "./support/action-errors";

test.use({ storageState: ADMIN_STATE });
test.afterAll(purgeNewPeople);

const mail = (n: string) => `${NEW_PREFIX}-${n}@${NEW_EMAIL_DOMAIN}`;

async function openAdd(page: Page) {
  await page.goto("/admin/employees");
  await page.getByRole("button", { name: /add employee/i }).click();
  const dialog = page.getByRole("dialog", { name: /new employee/i });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function fill(
  dialog: ReturnType<Page["locator"]>,
  v: { name?: string; email?: string; username?: string; password?: string },
) {
  if (v.name !== undefined) await textField(dialog, "Full name").fill(v.name);
  if (v.email !== undefined) await textField(dialog, "Company email (optional)").fill(v.email);
  if (v.username !== undefined)
    await textField(dialog, "Username (only if no company email)").fill(v.username);
  if (v.password !== undefined) await textField(dialog, "Temporary password").fill(v.password);
}

const create = (d: ReturnType<Page["locator"]>) => d.getByRole("button", { name: /^create$/i });
const countEmployees = () => db.employee.count();

test.describe("admin: add employee", () => {
  test("creates an employee with a generated EMP id, default kiosk PIN and forced password change", async ({
    page,
    browser,
  }) => {
    const seq = await maxEmployeeSeq();
    const dialog = await openAdd(page);
    await fill(dialog, { name: "Nora Newhire", email: mail("nora").toUpperCase(), password: "Temp-Pass-123" });
    await create(dialog).click();
    await expect(toast(page, "Created Nora Newhire")).toBeVisible();

    const emp = await db.employee.findFirstOrThrow({
      where: { email: mail("nora") }, // e-mail is stored trimmed + lower case
      include: { user: true },
    });
    expect(emp.employeeId).toBe(`EMP-${new Date().getFullYear()}-${String(seq + 1).padStart(4, "0")}`);
    expect(emp.employmentStatus).toBe("ACTIVE");
    expect(emp.user.role).toBe("EMPLOYEE");
    expect(emp.user.mustChangePassword).toBe(true);
    expect(await hashMatches(DEFAULT_PIN, emp.kioskPinHash)).toBe(true);
    expect(await hashMatches("Temp-Pass-123", emp.user.passwordHash)).toBe(true);

    // The new person signs in with the temporary password and is sent to choose a new one.
    const mine = await loginAs(browser, mail("nora"), "Temp-Pass-123");
    await expect(mine).toHaveURL(/\/change-password/);
    await mine.context().close();
  });

  test("an employee with no email can be created with a username only", async ({ page, browser }) => {
    const dialog = await openAdd(page);
    await fill(dialog, { name: "Uma Username", username: `${NEW_PREFIX}-uma`, password: "Temp-Pass-123" });
    await create(dialog).click();
    await expect(toast(page, "Created Uma Username")).toBeVisible();
    const emp = await db.employee.findFirstOrThrow({
      where: { name: "Uma Username" },
      include: { user: true },
    });
    expect(emp.email).toBeNull();
    expect(emp.user.username).toBe(`${NEW_PREFIX}-uma`);
    const mine = await loginAs(browser, `${NEW_PREFIX}-uma`, "Temp-Pass-123");
    await expect(mine).toHaveURL(/\/change-password/);
    await mine.context().close();
  });

  test("neither email nor username is refused", async ({ page }) => {
    const before = await countEmployees();
    const dialog = await openAdd(page);
    await fill(dialog, { name: "No Identity", password: "Temp-Pass-123" });
    await create(dialog).click();
    await expect(dialog.getByText(/enter a username when no company email/i)).toBeVisible();
    expect(await countEmployees()).toBe(before);
  });

  test("invalid fields show messages and nothing is saved", async ({ page }) => {
    const before = await countEmployees();
    const dialog = await openAdd(page);
    await fill(dialog, { name: "A", email: mail("x"), password: "Temp-Pass-123" });
    await create(dialog).click();
    await expect(dialog.getByText("At least 2 characters")).toBeVisible();
    await fill(dialog, { name: "Valid Name", email: "", username: "x!", password: "Temp-Pass-123" });
    await create(dialog).click();
    await expect(dialog.getByText(/letters, numbers/i)).toBeVisible();
    await textField(dialog, "SSN — last 4 only").fill("12");
    await fill(dialog, { username: `${NEW_PREFIX}-bad` });
    await create(dialog).click();
    await expect(dialog.getByText("Enter exactly 4 digits")).toBeVisible();
    expect(await countEmployees()).toBe(before);
  });

  test("a company email that already belongs to an employee is refused", async ({ page }) => {
    const before = await countEmployees();
    const dialog = await openAdd(page);
    await fill(dialog, { name: "Dup Email", email: PEOPLE.edith.email, password: "Temp-Pass-123" });
    await create(dialog).click();
    await expect(toast(page, /already belongs to an employee/i)).toBeVisible();
    expect(await countEmployees()).toBe(before);
  });

  test("a username that is taken is refused", async ({ page }) => {
    await db.user.create({ data: { username: `${NEW_PREFIX}-taken`, name: "Taken", role: "EMPLOYEE" } });
    const before = await countEmployees();
    const dialog = await openAdd(page);
    await fill(dialog, { name: "Dup User", username: `${NEW_PREFIX}-taken`, password: "Temp-Pass-123" });
    await create(dialog).click();
    await expect(toast(page, /username is already taken/i)).toBeVisible();
    expect(await countEmployees()).toBe(before);
  });

  test("server failure shows a toast, keeps the form and saves nothing", async ({ page }) => {
    const before = await countEmployees();
    const dialog = await openAdd(page);
    await fill(dialog, { name: "Fail Person", email: mail("fail"), password: "Temp-Pass-123" });
    await failServerActions(page, "abort");
    await create(dialog).click();
    await expect(toast(page, NETWORK_ERROR)).toBeVisible();
    await expectNoCrash(page);
    expect(await countEmployees()).toBe(before);
  });

  test("double click on Create makes one employee", async ({ page }) => {
    const dialog = await openAdd(page);
    await fill(dialog, { name: "Double Click", email: mail("dbl"), password: "Temp-Pass-123" });
    const calls = await delayServerActions(page, 1500);
    await create(dialog).dblclick();
    await expect(toast(page, "Created Double Click")).toBeVisible();
    expect(calls.count()).toBe(1);
    expect(await db.employee.count({ where: { email: mail("dbl") } })).toBe(1);
  });

  test("the seeded password constant still signs a seeded person in (sanity)", async ({ browser }) => {
    const p = await loginAs(browser, PEOPLE.edith.email, PEOPLE_PASSWORD);
    await expect(p).not.toHaveURL(/\/login/);
    await p.context().close();
  });
});
