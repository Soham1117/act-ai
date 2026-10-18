import { test, expect, type Page } from "@playwright/test";
import { db } from "./support/db";
import { delayServerActions, expectNoCrash, failServerActions, toast } from "./support/helpers";
import {
  CODES,
  anonContext,
  DEPTS,
  NEW_CODE_PREFIX,
  choose,
  personRow,
  restoreJobCodes,
  selectField,
  textField,
} from "./support/people";
import { ADMIN_STATE, INACTIVE_JOB_CODE, JOB_CODE } from "./support/test-data";

test.use({ storageState: ADMIN_STATE });

test.afterAll(async () => {
  await restoreJobCodes();
});

const NEW = (n: string) => `${NEW_CODE_PREFIX}${n}`;
const byCode = (code: string) => db.jobCode.findUnique({ where: { code } });

async function openList(page: Page) {
  await page.goto("/admin/job-codes");
  await expect(page.getByRole("heading", { name: "Job codes" })).toBeVisible();
}

async function openNew(page: Page) {
  await openList(page);
  await page.getByRole("button", { name: /new job code/i }).click();
  const dialog = page.getByRole("dialog", { name: /new job code/i });
  await expect(dialog).toBeVisible();
  return dialog;
}

const rowFor = (page: Page, code: string) =>
  page.getByRole("row").filter({ has: page.getByRole("link", { name: code, exact: true }) });

async function rowMenu(page: Page, code: string, item: RegExp) {
  await rowFor(page, code).getByRole("button").click();
  await page.getByRole("menuitem", { name: item }).click();
}

async function openEdit(page: Page, code: string) {
  await openList(page);
  await rowMenu(page, code, /edit/i);
  const dialog = page.getByRole("dialog", { name: /edit job code/i });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function fillNew(dialog: ReturnType<Page["locator"]>, code: string, title: string) {
  await textField(dialog, "Code").fill(code);
  await textField(dialog, "Title").fill(title);
}

test.describe("admin job codes: create", () => {
  test("creates a code; it is saved upper-case, active, not default, rate NA", async ({ page }) => {
    const dialog = await openNew(page);
    await fillNew(dialog, "ppxa1", "Created One");
    await expect(textField(dialog, "Code")).toHaveValue("PPXA1"); // typing already upper-cases
    await dialog.getByRole("button", { name: /^create$/i }).click();
    await expect(toast(page, "Created PPXA1")).toBeVisible();
    await expect(dialog).toBeHidden();

    const row = await byCode(NEW("A1"));
    expect(row).toMatchObject({
      title: "Created One",
      rate: "NA",
      isActive: true,
      isDefault: false,
      description: null,
      departmentId: null,
    });
    await expect(rowFor(page, NEW("A1"))).toContainText("Created One");
    await expect(rowFor(page, NEW("A1"))).toContainText("Active");
    expect(await db.auditLog.count({ where: { action: "job_code.create", resource: `JobCode:${row!.id}` } })).toBe(1);
  });

  test("saves rate, description and department", async ({ page }) => {
    const dialog = await openNew(page);
    await fillNew(dialog, NEW("A2"), "With Details");
    await textField(dialog, "Rate").fill("$22.00");
    await textField(dialog, "Description").fill("  Welds big things  ");
    await choose(page, selectField(dialog, "Department (optional)"), DEPTS.staffed.name);
    await dialog.getByRole("button", { name: /^create$/i }).click();
    await expect(toast(page, `Created ${NEW("A2")}`)).toBeVisible();
    const row = await byCode(NEW("A2"));
    const dept = await db.department.findUniqueOrThrow({ where: { name: DEPTS.staffed.name } });
    expect(row).toMatchObject({ rate: "$22.00", description: "Welds big things", departmentId: dept.id });
  });

  test("a duplicate code is refused, even when typed in lower case", async ({ page }) => {
    const before = await db.jobCode.count();
    const dialog = await openNew(page);
    await fillNew(dialog, CODES.a.code.toLowerCase(), "Duplicate");
    await dialog.getByRole("button", { name: /^create$/i }).click();
    await expect(toast(page, /that code is already in use/i)).toBeVisible();
    expect(await db.jobCode.count()).toBe(before);
    await expect(dialog).toBeVisible();
  });

  test("Create stays disabled until code and title have 2 characters; code stops at 20", async ({
    page,
  }) => {
    const dialog = await openNew(page);
    const create = dialog.getByRole("button", { name: /^create$/i });
    await expect(create).toBeDisabled();
    await textField(dialog, "Code").fill("A");
    await textField(dialog, "Title").fill("Ok title");
    await expect(create).toBeDisabled();
    await textField(dialog, "Code").fill("a".repeat(25));
    await expect(textField(dialog, "Code")).toHaveValue("A".repeat(20));
    await textField(dialog, "Title").fill("T");
    await expect(create).toBeDisabled();
  });

  test("values that are too short once trimmed, or too long, are rejected with a message", async ({
    page,
  }) => {
    const before = await db.jobCode.count();
    const dialog = await openNew(page);
    const create = dialog.getByRole("button", { name: /^create$/i });

    await fillNew(dialog, " X", "Valid title"); // code is 1 char after trimming
    await create.click();
    await expect(toast(page, /check code/i)).toBeVisible();

    await fillNew(dialog, NEW("A3"), " x"); // title is 1 char after trimming
    await create.click();
    await expect(toast(page, /check title/i)).toBeVisible();

    await fillNew(dialog, NEW("A3"), "Valid title");
    await textField(dialog, "Description").fill("d".repeat(501));
    await create.click();
    await expect(toast(page, /check description/i)).toBeVisible();

    expect(await db.jobCode.count()).toBe(before);
  });

  test("creating a default code makes it the only default", async ({ page }) => {
    const dialog = await openNew(page);
    await fillNew(dialog, NEW("D1"), "New Default");
    await dialog.getByRole("switch").first().click();
    await dialog.getByRole("button", { name: /^create$/i }).click();
    await expect(toast(page, `Created ${NEW("D1")}`)).toBeVisible();

    const defaults = await db.jobCode.findMany({ where: { isDefault: true } });
    expect(defaults.map((d) => d.code)).toEqual([NEW("D1")]);
    // The star marks the default in the list.
    await openList(page);
    await expect(rowFor(page, NEW("D1")).locator("svg.fill-primary")).toBeVisible();
    await expect(rowFor(page, JOB_CODE.code).locator("svg.fill-primary")).toHaveCount(0);
    await restoreJobCodes(false);
  });

  test("server failure shows the error screen and saves nothing", async ({ page }) => {
    const dialog = await openNew(page);
    await fillNew(dialog, NEW("F1"), "Failing");
    await failServerActions(page, "abort");
    await dialog.getByRole("button", { name: /^create$/i }).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect(await byCode(NEW("F1"))).toBeNull();
  });

  test("server error 500 saves nothing", async ({ page }) => {
    const dialog = await openNew(page);
    await fillNew(dialog, NEW("F2"), "Failing");
    await failServerActions(page, "500");
    await dialog.getByRole("button", { name: /^create$/i }).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    expect(await byCode(NEW("F2"))).toBeNull();
  });

  test("double click on Create saves one code", async ({ page }) => {
    const dialog = await openNew(page);
    await fillNew(dialog, NEW("DB"), "Double");
    const calls = await delayServerActions(page, 1500);
    await dialog.getByRole("button", { name: /^create$/i }).dblclick();
    await expect(toast(page, `Created ${NEW("DB")}`)).toBeVisible();
    expect(calls.count()).toBe(1);
    expect(await db.jobCode.count({ where: { code: NEW("DB") } })).toBe(1);
  });

  test("page from an older deployment saves nothing", async ({ page }) => {
    const dialog = await openNew(page);
    await fillNew(dialog, NEW("ST"), "Stale");
    await failServerActions(page, "stale");
    await dialog.getByRole("button", { name: /^create$/i }).click();
    await expect
      .poll(async () => (await page.getByText(/something went wrong|refresh|reload|try again/i).count()) > 0)
      .toBe(true);
    expect(await byCode(NEW("ST"))).toBeNull();
  });
});

test.describe("admin job codes: edit, default, active", () => {
  test.beforeAll(async () => {
    for (const c of ["A1", "A2B", "A2R"]) await db.jobCode.upsert({ where: { code: NEW(c) }, update: {}, create: { code: NEW(c), title: `Fixture ${c}` } });
  });
  test("edits title, rate, description and department; the change is audited", async ({ page }) => {
    const dialog = await openEdit(page, NEW("A1"));
    await expect(textField(dialog, "Code")).toHaveValue(NEW("A1"));
    await textField(dialog, "Title").fill("Renamed One");
    await textField(dialog, "Rate").fill("NA");
    await textField(dialog, "Description").fill("Now with words");
    await choose(page, selectField(dialog, "Department (optional)"), DEPTS.empty.name);
    await dialog.getByRole("button", { name: /^save$/i }).click();
    await expect(toast(page, `Updated ${NEW("A1")}`)).toBeVisible();

    const row = await byCode(NEW("A1"));
    const dept = await db.department.findUniqueOrThrow({ where: { name: DEPTS.empty.name } });
    expect(row).toMatchObject({ title: "Renamed One", description: "Now with words", departmentId: dept.id });
    const audit = await db.auditLog.findFirst({
      where: { action: "job_code.update", resource: `JobCode:${row!.id}` },
      orderBy: { createdAt: "desc" },
    });
    expect(JSON.stringify(audit?.diff)).toContain("Renamed One");
  });

  test("changing the code to one that exists is refused and nothing changes", async ({ page }) => {
    const dialog = await openEdit(page, NEW("A1"));
    await textField(dialog, "Code").fill(CODES.a.code);
    await dialog.getByRole("button", { name: /^save$/i }).click();
    await expect(toast(page, /that code is already in use/i)).toBeVisible();
    expect(await byCode(NEW("A1"))).not.toBeNull();
  });

  test("renaming a code to lower case is saved upper-case", async ({ page }) => {
    const dialog = await openEdit(page, NEW("A2R"));
    await textField(dialog, "Code").fill(NEW("a2c").toLowerCase());
    await dialog.getByRole("button", { name: /^save$/i }).click();
    await expect(toast(page, `Updated ${NEW("A2C")}`)).toBeVisible();
    expect(await byCode(NEW("A2C"))).not.toBeNull();
    expect(await byCode(NEW("A2R"))).toBeNull();
  });

  test("setting another code as default clears the old default (and back again)", async ({ page }) => {
    const dialog = await openEdit(page, CODES.b.code);
    await dialog.getByRole("switch").first().click(); // Default code
    await dialog.getByRole("button", { name: /^save$/i }).click();
    await expect(toast(page, `Updated ${CODES.b.code}`)).toBeVisible();
    expect((await db.jobCode.findMany({ where: { isDefault: true } })).map((c) => c.code)).toEqual([
      CODES.b.code,
    ]);

    const back = await openEdit(page, JOB_CODE.code);
    await back.getByRole("switch").first().click();
    await back.getByRole("button", { name: /^save$/i }).click();
    await expect(toast(page, `Updated ${JOB_CODE.code}`)).toBeVisible();
    expect((await db.jobCode.findMany({ where: { isDefault: true } })).map((c) => c.code)).toEqual([
      JOB_CODE.code,
    ]);
  });

  test("the Active switch in the edit dialog retires a code", async ({ page }) => {
    const dialog = await openEdit(page, NEW("A2B"));
    await dialog.getByRole("switch").nth(1).click(); // Active -> off
    await dialog.getByRole("button", { name: /^save$/i }).click();
    await expect(toast(page, `Updated ${NEW("A2B")}`)).toBeVisible();
    expect((await byCode(NEW("A2B")))?.isActive).toBe(false);
    await expect(rowFor(page, NEW("A2B"))).toContainText("Inactive");
  });

  // BUG (app): updateJobCode accepts isDefault=true together with isActive=false, so the
  // company "default" can be a code nobody may use. src/server/actions/job-codes.ts.
  // Proposed fix: in updateJobCode (and toggleJobCodeActive) refuse, or clear isDefault,
  // when the code is not active.
  test("an inactive code cannot be made the default", async ({ page }) => {
    const dialog = await openEdit(page, NEW("A2B"));
    await dialog.getByRole("switch").first().click(); // default on
    await dialog.getByRole("button", { name: /^save$/i }).click();
    const row = await byCode(NEW("A2B"));
    expect(row?.isDefault && !row.isActive).toBe(false);
  });

  // BUG (app): deactivating the default code leaves isDefault=true on an inactive code.
  // Proposed fix: toggleJobCodeActive should clear isDefault when deactivating (or refuse).
  test("deactivating the default code does not leave an inactive default", async ({ page }) => {
    await openList(page);
    await rowMenu(page, JOB_CODE.code, /deactivate/i);
    await expect(toast(page, /deactivated/i)).toBeVisible();
    const row = await byCode(JOB_CODE.code);
    try {
      expect(row?.isDefault && !row.isActive).toBe(false);
    } finally {
      await restoreJobCodes(false);
    }
  });

  test("editing a code that someone deleted shows a clear message", async ({ page }) => {
    const gone = await db.jobCode.create({ data: { code: NEW("GN"), title: "Soon gone" } });
    const dialog = await openEdit(page, NEW("GN"));
    await db.jobCode.delete({ where: { id: gone.id } });
    await dialog.getByRole("button", { name: /^save$/i }).click();
    await expect(toast(page, /no longer exists/i)).toBeVisible();
  });

  test("failure while saving an edit shows an error and keeps the old values", async ({ page }) => {
    const dialog = await openEdit(page, NEW("A2B"));
    await textField(dialog, "Title").fill("Never saved");
    await failServerActions(page, "abort");
    await dialog.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    expect((await byCode(NEW("A2B")))?.title).not.toBe("Never saved");
  });

  test("double click on Save sends one update", async ({ page }) => {
    const dialog = await openEdit(page, NEW("A2B"));
    await textField(dialog, "Title").fill("Saved once");
    const calls = await delayServerActions(page, 1500);
    await dialog.getByRole("button", { name: /^save$/i }).dblclick();
    await expect(toast(page, `Updated ${NEW("A2B")}`)).toBeVisible();
    expect(calls.count()).toBe(1);
  });
});

test.describe("admin job codes: deactivate and delete", () => {
  test("deactivating and reactivating a code from the list; the shift dialog follows", async ({
    page,
  }) => {
    await openList(page);
    await rowMenu(page, CODES.a.code, /deactivate/i);
    await expect(toast(page, "Deactivated")).toBeVisible();
    await expect(rowFor(page, CODES.a.code)).toContainText("Inactive");
    expect((await byCode(CODES.a.code))?.isActive).toBe(false);

    // The shift dialog offers only active codes.
    await page.goto("/admin/schedules");
    await page.getByRole("button", { name: /new shift/i }).click();
    const shift = page.getByRole("dialog", { name: /new shift/i });
    await shift.getByRole("combobox").click();
    await expect(page.getByRole("option", { name: new RegExp(CODES.a.code) })).toHaveCount(0);
    await expect(page.getByRole("option", { name: new RegExp(JOB_CODE.code) })).toHaveCount(1);
    await page.keyboard.press("Escape");

    await openList(page);
    await rowMenu(page, CODES.a.code, /activate/i);
    await expect(toast(page, "Activated")).toBeVisible();
    expect((await byCode(CODES.a.code))?.isActive).toBe(true);
    await page.goto("/admin/schedules");
    await page.getByRole("button", { name: /new shift/i }).click();
    await page.getByRole("dialog", { name: /new shift/i }).getByRole("combobox").click();
    await expect(page.getByRole("option", { name: new RegExp(CODES.a.code) })).toHaveCount(1);
  });

  test("the retired seeded code stays out of the shift dialog", async ({ page }) => {
    await page.goto("/admin/schedules");
    await page.getByRole("button", { name: /new shift/i }).click();
    await page.getByRole("dialog", { name: /new shift/i }).getByRole("combobox").click();
    await expect(page.getByRole("option", { name: new RegExp(INACTIVE_JOB_CODE.code) })).toHaveCount(0);
  });

  test("deleting an unused code removes it and is audited", async ({ page }) => {
    const id = (await byCode(CODES.del.code))!.id;
    await openList(page);
    await rowMenu(page, CODES.del.code, /delete/i);
    await expect(toast(page, "Deleted")).toBeVisible();
    expect(await byCode(CODES.del.code)).toBeNull();
    await expect(rowFor(page, CODES.del.code)).toHaveCount(0);
    expect(await db.auditLog.count({ where: { action: "job_code.delete", resource: `JobCode:${id}` } })).toBe(1);
  });

  test("a code that is assigned to someone cannot be deleted", async ({ page }) => {
    const jc = await db.jobCode.findUniqueOrThrow({ where: { code: CODES.used.code } });
    const emp = await personRow("jcA");
    await db.jobCodeAssignment.create({ data: { jobCodeId: jc.id, employeeId: emp.id, isPrimary: true } });
    await db.employee.update({ where: { id: emp.id }, data: { primaryJobCodeId: jc.id } });
    try {
      await openList(page);
      await rowMenu(page, CODES.used.code, /delete/i);
      await expect(toast(page, /cannot delete: 1 employee\(s\) are still assigned/i)).toBeVisible();
      expect(await byCode(CODES.used.code)).not.toBeNull();
    } finally {
      await db.employee.update({ where: { id: emp.id }, data: { primaryJobCodeId: null } });
      await db.jobCodeAssignment.deleteMany({ where: { employeeId: emp.id } });
    }
  });

  test("a code someone else already deleted gives a clear message when toggled or deleted", async ({
    page,
  }) => {
    const gone = await db.jobCode.create({ data: { code: NEW("GT"), title: "Gone soon" } });
    await openList(page);
    await db.jobCode.delete({ where: { id: gone.id } });
    await rowMenu(page, NEW("GT"), /deactivate/i);
    await expect(toast(page, /no longer exists/i)).toBeVisible();
  });

  test("failure while deleting shows an error and keeps the code", async ({ page }) => {
    await db.jobCode.create({ data: { code: NEW("FD"), title: "Keep me" } });
    await openList(page);
    await failServerActions(page, "abort");
    await rowMenu(page, NEW("FD"), /delete/i);
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    expect(await byCode(NEW("FD"))).not.toBeNull();
  });

  test("failure while toggling shows an error and keeps the old state", async ({ page }) => {
    await openList(page);
    await failServerActions(page, "abort");
    await rowMenu(page, NEW("FD"), /deactivate/i);
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    expect((await byCode(NEW("FD")))?.isActive).toBe(true);
  });

  // BUG (app): deleteJobCode only checks employee assignments. A contract worker (and any
  // schedule / template) can still reference the code by its text, so deleting it leaves
  // the crew kiosk stamping punches with a code that no longer exists.
  // src/server/actions/job-codes.ts deleteJobCode; src/server/contract-time-core.ts.
  // Proposed fix: also count ContractWorker.jobCode (and ScheduleTemplate.jobCode) and
  // refuse with "N contract worker(s) use this code".
  test("a code used by a contract worker cannot be deleted", async ({ page }) => {
    const code = await db.jobCode.create({ data: { code: NEW("CW"), title: "Crew code" } });
    const agency = await db.staffingAgency.findFirstOrThrow();
    const admin = await db.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    const worker = await db.contractWorker.create({
      data: {
        workerId: "CW-PP01",
        name: "Crew Codeholder",
        agencyId: agency.id,
        jobCode: code.code,
        project: "E2E",
        startDate: new Date(),
        createdById: admin.id,
      },
    });
    try {
      await openList(page);
      await rowMenu(page, NEW("CW"), /delete/i);
      await expect(toast(page, /cannot delete/i)).toBeVisible();
      expect(await byCode(NEW("CW"))).not.toBeNull();
    } finally {
      await db.contractWorker.delete({ where: { id: worker.id } });
    }
  });
});

test.describe("admin job codes: detail page", () => {
  test("the detail page shows status, rate and assigned employees", async ({ page }) => {
    const jc = await byCode(CODES.b.code);
    await page.goto(`/admin/job-codes/${jc!.id}`);
    await expect(page.getByRole("heading", { name: new RegExp(CODES.b.code) })).toBeVisible();
    await expect(page.getByText(/assigned employees \(0\)/i)).toBeVisible();
    await expect(page.getByText(/no employees assigned to this code yet/i)).toBeVisible();
  });

  test("an unknown job code id shows the not-found page", async ({ page }) => {
    await page.goto("/admin/job-codes/does-not-exist");
    await expect(page.getByText(/not found|404/i).first()).toBeVisible();
  });

  test("the job code list is not available when signed out", async ({ browser }) => {
    const context = await anonContext(browser);
    const page = await context.newPage();
    await page.goto("/admin/job-codes");
    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });

  test("the assign button is disabled when nobody is left to assign", async ({ page }) => {
    // Every active person is already on this code -> no assignable employees.
    const jc = await db.jobCode.create({ data: { code: NEW("ALL"), title: "Everyone" } });
    const everyone = await db.employee.findMany({ where: { employmentStatus: { not: "TERMINATED" } } });
    await db.jobCodeAssignment.createMany({
      data: everyone.map((e) => ({ jobCodeId: jc.id, employeeId: e.id })),
    });
    try {
      await page.goto(`/admin/job-codes/${jc.id}`);
      await expect(page.getByRole("button", { name: /assign employee/i })).toBeDisabled();
    } finally {
      await db.jobCode.delete({ where: { id: jc.id } }); // cascades the assignments
    }
  });
});

