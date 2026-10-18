import { test, expect, type Page } from "@playwright/test";
import { db } from "./support/db";
import { delayServerActions, expectNoCrash, failServerActions, toast } from "./support/helpers";
import { DEPTS, PEOPLE, anonContext, textField } from "./support/people";
import { ADMIN_STATE } from "./support/test-data";
import { NETWORK_ERROR, SERVER_ERROR, STALE_ERROR } from "./support/action-errors";

test.use({ storageState: ADMIN_STATE });

const CREATED = "E2E Created Dept";

test.afterAll(async () => {
  await db.department.deleteMany({ where: { name: { startsWith: CREATED } } });
});

async function openDialog(page: Page) {
  await page.goto("/admin/departments");
  await page.getByRole("button", { name: /new department/i }).click();
  const dialog = page.getByRole("dialog", { name: /new department/i });
  await expect(dialog).toBeVisible();
  return dialog;
}

const count = (name: string) => db.department.count({ where: { name } });

test.describe("admin departments: create", () => {
  test("creates a department; code is saved upper-case and blank description as null", async ({
    page,
  }) => {
    const dialog = await openDialog(page);
    await textField(dialog, "Name").fill(`${CREATED} A`);
    await textField(dialog, "Short code (optional)").fill("ppca");
    await dialog.getByRole("button", { name: /^create$/i }).click();
    await expect(toast(page, `Created ${CREATED} A`)).toBeVisible();
    await expect(dialog).toBeHidden();

    const row = await db.department.findUniqueOrThrow({ where: { name: `${CREATED} A` } });
    expect(row.code).toBe("PPCA");
    expect(row.description).toBeNull();
    // It shows up as a card with its code and an employee count of 0.
    const card = page.getByRole("link", { name: new RegExp(`${CREATED} A`) });
    await expect(card).toBeVisible();
    await expect(card).toContainText("PPCA");
    await expect(card).toContainText("0 employees");
  });

  test("two departments with no code can both be saved (blank code is not a clash)", async ({
    page,
  }) => {
    for (const suffix of ["B", "C"]) {
      const dialog = await openDialog(page);
      await textField(dialog, "Name").fill(`${CREATED} ${suffix}`);
      await dialog.getByRole("button", { name: /^create$/i }).click();
      await expect(toast(page, `Created ${CREATED} ${suffix}`)).toBeVisible();
    }
    const rows = await db.department.findMany({
      where: { name: { in: [`${CREATED} B`, `${CREATED} C`] } },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.code === null)).toBe(true);
  });

  test("a duplicate name is refused with a clear message and nothing is saved", async ({
    page,
  }) => {
    const before = await db.department.count();
    const dialog = await openDialog(page);
    await textField(dialog, "Name").fill(DEPTS.staffed.name);
    await dialog.getByRole("button", { name: /^create$/i }).click();
    await expect(toast(page, /that name is already taken/i)).toBeVisible();
    await expect(dialog).toBeVisible(); // stays open so the admin can fix it
    expect(await db.department.count()).toBe(before);
  });

  test("a duplicate short code is refused with a clear message", async ({ page }) => {
    const before = await db.department.count();
    const dialog = await openDialog(page);
    await textField(dialog, "Name").fill(`${CREATED} Dup Code`);
    await textField(dialog, "Short code (optional)").fill(DEPTS.staffed.code);
    await dialog.getByRole("button", { name: /^create$/i }).click();
    await expect(toast(page, /that code is already in use/i)).toBeVisible();
    expect(await db.department.count()).toBe(before);
  });

  test("Create stays disabled until the name has 2 characters; the code box stops at 8", async ({
    page,
  }) => {
    const dialog = await openDialog(page);
    const create = dialog.getByRole("button", { name: /^create$/i });
    await expect(create).toBeDisabled();
    await textField(dialog, "Name").fill("A");
    await expect(create).toBeDisabled();
    await textField(dialog, "Name").fill("AB");
    await expect(create).toBeEnabled();
    await textField(dialog, "Short code (optional)").fill("abcdefghijkl");
    await expect(textField(dialog, "Short code (optional)")).toHaveValue("ABCDEFGH");
  });

  test("a name that is too short once trimmed is rejected by the server with a message", async ({
    page,
  }) => {
    const before = await db.department.count();
    const dialog = await openDialog(page);
    await textField(dialog, "Name").fill(" x"); // 2 chars for the button, 1 after trimming
    await dialog.getByRole("button", { name: /^create$/i }).click();
    await expect(toast(page, /check name/i)).toBeVisible();
    expect(await db.department.count()).toBe(before);
  });

  test("dropped connection shows a toast, keeps the dialog and saves nothing", async ({ page }) => {
    const dialog = await openDialog(page);
    await textField(dialog, "Name").fill(`${CREATED} Fail`);
    await failServerActions(page, "abort");
    await dialog.getByRole("button", { name: /^create$/i }).click();
    await expect(toast(page, NETWORK_ERROR)).toBeVisible();
    await expectNoCrash(page);
    // The dialog stays open with what was typed.
    await expect(dialog).toBeVisible();
    await expect(textField(dialog, "Name")).toHaveValue(`${CREATED} Fail`);
    expect(await count(`${CREATED} Fail`)).toBe(0);
  });

  test("server error 500 shows an error and saves nothing", async ({ page }) => {
    const dialog = await openDialog(page);
    await textField(dialog, "Name").fill(`${CREATED} Five`);
    await failServerActions(page, "500");
    await dialog.getByRole("button", { name: /^create$/i }).click();
    await expect(toast(page, SERVER_ERROR)).toBeVisible();
    // The dialog stays open (nothing was lost).
    await expect(dialog).toBeVisible();
    expect(await count(`${CREATED} Five`)).toBe(0);
  });

  test("double click on Create saves one department", async ({ page }) => {
    const dialog = await openDialog(page);
    await textField(dialog, "Name").fill(`${CREATED} Double`);
    const calls = await delayServerActions(page, 1500);
    await dialog.getByRole("button", { name: /^create$/i }).dblclick();
    await expect(toast(page, `Created ${CREATED} Double`)).toBeVisible();
    expect(calls.count()).toBe(1);
    expect(await count(`${CREATED} Double`)).toBe(1);
  });

  test("page from an older deployment: reports a clear failure and nothing is saved", async ({
    page,
  }) => {
    const dialog = await openDialog(page);
    await textField(dialog, "Name").fill(`${CREATED} Stale`);
    await failServerActions(page, "stale");
    await dialog.getByRole("button", { name: /^create$/i }).click();
    await expect(toast(page, STALE_ERROR)).toBeVisible();
    await expectNoCrash(page);
    await expect(dialog).toBeVisible();
    await expect(textField(dialog, "Name")).toHaveValue(`${CREATED} Stale`);
    expect(await count(`${CREATED} Stale`)).toBe(0);
    test.info().annotations.push({
      type: "stale-deployment",
      description: "createDepartment with a Server Action that no longer exists",
    });
  });
});

test.describe("admin departments: pages", () => {
  test("the staffed department card counts its member and the detail page lists them", async ({
    page,
  }) => {
    await page.goto("/admin/departments");
    const card = page.getByRole("link", { name: new RegExp(DEPTS.staffed.name) });
    await expect(card).toContainText("1 employees");
    await card.click();
    await expect(page.getByRole("heading", { name: DEPTS.staffed.name })).toBeVisible();
    await expect(page.getByText("Members (1)")).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(PEOPLE.dept.name) })).toBeVisible();
  });

  test("an empty department says no one is assigned", async ({ page }) => {
    const dept = await db.department.findUniqueOrThrow({ where: { name: DEPTS.empty.name } });
    await page.goto(`/admin/departments/${dept.id}`);
    await expect(page.getByText("Members (0)")).toBeVisible();
    await expect(page.getByText(/no one assigned yet/i)).toBeVisible();
  });

  test("an unknown department id shows the not-found page", async ({ page }) => {
    await page.goto("/admin/departments/does-not-exist");
    await expect(page.getByText(/not found|404/i).first()).toBeVisible();
    await expect(page.getByText("Members")).toHaveCount(0);
  });

  test("a visitor who is not signed in is sent to the login page", async ({ browser }) => {
    const context = await anonContext(browser);
    const page = await context.newPage();
    await page.goto("/admin/departments");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fdepartments/);
    await context.close();
  });
});
