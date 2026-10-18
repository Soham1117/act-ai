import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { db } from "./support/db";
import { delayServerActions, expectNoCrash, failServerActions, toast } from "./support/helpers";
import { DEPTS, PEOPLE, anonContext, textField } from "./support/people";
import { ADMIN_STATE, env } from "./support/test-data";
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

// ---- edit and delete ----------------------------------------------------------------------

let seq = 0;
async function makeDept(over: { name?: string; code?: string | null; description?: string | null } = {}) {
  seq += 1;
  return db.department.create({
    data: {
      name: over.name ?? `${CREATED} Own ${Date.now()}-${seq}`,
      code: over.code === undefined ? null : over.code,
      description: over.description ?? null,
    },
  });
}

async function openActions(page: Page, name: string, item: "Edit" | "Delete") {
  await page.goto("/admin/departments");
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

const editDialog = (page: Page) => page.getByRole("dialog", { name: /edit department/i });
const deleteDialog = (page: Page) => page.getByRole("dialog", { name: /^delete /i });
const getDept = (id: string) => db.department.findUniqueOrThrow({ where: { id } });
const auditCount = (action: string, id: string) =>
  db.auditLog.count({ where: { action, resource: `Department:${id}` } });

test.describe("admin departments: edit", () => {
  test("edits name, code and description; the code is saved upper-case; audited", async ({ page }) => {
    const d = await makeDept({ code: "OLDC", description: "Old text" });
    await openActions(page, d.name, "Edit");
    const dialog = editDialog(page);
    await expect(textField(dialog, "Name")).toHaveValue(d.name);
    await expect(textField(dialog, "Short code (optional)")).toHaveValue("OLDC");
    await textField(dialog, "Name").fill(`${d.name} Renamed`);
    await textField(dialog, "Short code (optional)").fill("newc");
    await dialog.getByRole("textbox").last().fill("New text");
    await dialog.getByRole("button", { name: /^save$/i }).click();
    await expect(toast(page, `Saved ${d.name} Renamed`)).toBeVisible();
    await expect(dialog).toBeHidden();
    expect(await getDept(d.id)).toMatchObject({
      name: `${d.name} Renamed`,
      code: "NEWC",
      description: "New text",
    });
    expect(await auditCount("department.update", d.id)).toBe(1);
    await expect(page.getByRole("link", { name: new RegExp(`${d.name} Renamed`) })).toContainText("NEWC");
  });

  test("clearing the code and description saves them as null", async ({ page }) => {
    const d = await makeDept({ code: "CLR", description: "Gone soon" });
    await openActions(page, d.name, "Edit");
    const dialog = editDialog(page);
    await textField(dialog, "Short code (optional)").fill("");
    await dialog.getByRole("textbox").last().fill("");
    await dialog.getByRole("button", { name: /^save$/i }).click();
    await expect(toast(page, `Saved ${d.name}`)).toBeVisible();
    expect(await getDept(d.id)).toMatchObject({ code: null, description: null });
  });

  test("a duplicate name or code is refused with a clear message and nothing changes", async ({ page }) => {
    const d = await makeDept({ code: "EDUP" });
    await openActions(page, d.name, "Edit");
    const dialog = editDialog(page);
    await textField(dialog, "Name").fill(DEPTS.staffed.name);
    await dialog.getByRole("button", { name: /^save$/i }).click();
    await expect(toast(page, /that name is already taken/i)).toBeVisible();
    await expect(dialog).toBeVisible();
    await textField(dialog, "Name").fill(d.name);
    await textField(dialog, "Short code (optional)").fill(DEPTS.staffed.code);
    await dialog.getByRole("button", { name: /^save$/i }).click();
    await expect(toast(page, /that code is already in use/i)).toBeVisible();
    expect(await getDept(d.id)).toMatchObject({ name: d.name, code: "EDUP" });
  });

  test("a name that is too short once trimmed is refused by the server", async ({ page }) => {
    const d = await makeDept();
    await openActions(page, d.name, "Edit");
    const dialog = editDialog(page);
    await expect(dialog.getByRole("button", { name: /^save$/i })).toBeEnabled();
    await textField(dialog, "Name").fill("A");
    await expect(dialog.getByRole("button", { name: /^save$/i })).toBeDisabled();
    await textField(dialog, "Name").fill(" x");
    await dialog.getByRole("button", { name: /^save$/i }).click();
    await expect(toast(page, /check name/i)).toBeVisible();
    expect((await getDept(d.id)).name).toBe(d.name);
  });

  test("editing a department deleted meanwhile says so", async ({ page }) => {
    const d = await makeDept();
    await openActions(page, d.name, "Edit");
    await db.department.delete({ where: { id: d.id } });
    const dialog = editDialog(page);
    await textField(dialog, "Name").fill(`${d.name} Late`);
    await dialog.getByRole("button", { name: /^save$/i }).click();
    await expect(toast(page, /that department no longer exists/i)).toBeVisible();
    expect(await db.department.count({ where: { name: `${d.name} Late` } })).toBe(0);
  });

  test("server failure shows an error and saves nothing", async ({ page }) => {
    const d = await makeDept();
    await openActions(page, d.name, "Edit");
    const dialog = editDialog(page);
    await textField(dialog, "Name").fill(`${d.name} Fail`);
    await failServerActions(page, "abort");
    await dialog.getByRole("button", { name: /^save$/i }).click();
    await expect(toast(page, /could not reach the server|something went wrong/i)).toBeVisible();
    await expectNoCrash(page);
    expect((await getDept(d.id)).name).toBe(d.name);
  });

  test("double click on Save saves once", async ({ page }) => {
    const d = await makeDept();
    await openActions(page, d.name, "Edit");
    const dialog = editDialog(page);
    await textField(dialog, "Name").fill(`${d.name} Twice`);
    const calls = await delayServerActions(page, 1500);
    await dialog.getByRole("button", { name: /^save$/i }).dblclick();
    await expect(toast(page, `Saved ${d.name} Twice`)).toBeVisible();
    expect(calls.count()).toBe(1);
    expect(await auditCount("department.update", d.id)).toBe(1);
  });
});

test.describe("admin departments: delete", () => {
  test("deletes an empty department after confirmation; audited", async ({ page }) => {
    const d = await makeDept();
    await openActions(page, d.name, "Delete");
    const dialog = deleteDialog(page);
    await expect(dialog).toContainText(d.name);
    await dialog.getByRole("button", { name: /^delete$/i }).click();
    await expect(toast(page, `Deleted ${d.name}`)).toBeVisible();
    await expect(dialog).toBeHidden();
    expect(await db.department.count({ where: { id: d.id } })).toBe(0);
    expect(await auditCount("department.delete", d.id)).toBe(1);
    await expect(page.getByRole("link", { name: new RegExp(d.name) })).toHaveCount(0);
  });

  test("cancelling the confirmation deletes nothing", async ({ page }) => {
    const d = await makeDept();
    await openActions(page, d.name, "Delete");
    await deleteDialog(page).getByRole("button", { name: /cancel/i }).click();
    await expect(deleteDialog(page)).toBeHidden();
    expect(await db.department.count({ where: { id: d.id } })).toBe(1);
  });

  test("a department that still has employees is refused with a clear message", async ({ page }) => {
    await openActions(page, DEPTS.staffed.name, "Delete");
    await deleteDialog(page).getByRole("button", { name: /^delete$/i }).click();
    await expect(
      toast(page, /cannot delete this department: 1 employee\(s\) are still assigned/i),
    ).toBeVisible();
    expect(await db.department.count({ where: { name: DEPTS.staffed.name } })).toBe(1);
    expect(await db.employee.count({ where: { department: { name: DEPTS.staffed.name } } })).toBe(1);
  });

  test("a department with an open onboarding invite is refused", async ({ page }) => {
    const d = await makeDept();
    const admin = await db.user.findFirstOrThrow({ where: { email: env("E2E_ADMIN_EMAIL") } });
    const invite = await db.onboardingInvite.create({
      data: {
        token: `pp-dept-${randomUUID()}`,
        expiresAt: new Date(Date.now() + 86_400_000),
        createdById: admin.id,
        departmentId: d.id,
        employmentType: "FULL_PART_TIME",
        compensationType: "HOURLY_RATE",
      },
    });
    try {
      await openActions(page, d.name, "Delete");
      await deleteDialog(page).getByRole("button", { name: /^delete$/i }).click();
      await expect(
        toast(page, /cannot delete this department: 1 open onboarding invite\(s\) use it/i),
      ).toBeVisible();
      expect(await db.department.count({ where: { id: d.id } })).toBe(1);
    } finally {
      await db.onboardingInvite.delete({ where: { id: invite.id } });
    }
  });

  test("deleting a department already deleted meanwhile says so", async ({ page }) => {
    const d = await makeDept();
    await openActions(page, d.name, "Delete");
    await db.department.delete({ where: { id: d.id } });
    await deleteDialog(page).getByRole("button", { name: /^delete$/i }).click();
    await expect(toast(page, /that department no longer exists/i)).toBeVisible();
  });

  test("server failure shows an error and deletes nothing", async ({ page }) => {
    const d = await makeDept();
    await openActions(page, d.name, "Delete");
    await failServerActions(page, "abort");
    await deleteDialog(page).getByRole("button", { name: /^delete$/i }).click();
    await expect(toast(page, /could not reach the server|something went wrong/i)).toBeVisible();
    await expectNoCrash(page);
    expect(await db.department.count({ where: { id: d.id } })).toBe(1);
  });

  test("double click on Delete sends one request and deletes once", async ({ page }) => {
    const d = await makeDept();
    await openActions(page, d.name, "Delete");
    const calls = await delayServerActions(page, 1500);
    await deleteDialog(page).getByRole("button", { name: /^delete$/i }).dblclick();
    await expect(toast(page, `Deleted ${d.name}`)).toBeVisible();
    expect(calls.count()).toBe(1);
    expect(await auditCount("department.delete", d.id)).toBe(1);
  });
});
