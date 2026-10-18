import { test, expect, type Page } from "@playwright/test";
import { db } from "./support/db";
import { INACTIVE_EMPLOYEE } from "./support/test-data";
import { delayServerActions, failServerActions, toast } from "./support/helpers";
import { CODES, PEOPLE, personRow, textField } from "./support/people";
import { ADMIN_STATE } from "./support/test-data";
import { NETWORK_ERROR } from "./support/action-errors";

test.use({ storageState: ADMIN_STATE });

const codeRow = (code: string) => db.jobCode.findUniqueOrThrow({ where: { code } });

test.afterAll(async () => {
  for (const k of ["jcA", "jcB"] as const) {
    const e = await personRow(k);
    await db.employee.update({ where: { id: e.id }, data: { primaryJobCodeId: null } });
    await db.jobCodeAssignment.deleteMany({ where: { employeeId: e.id } });
  }
});

async function openCode(page: Page, code: string) {
  const jc = await codeRow(code);
  await page.goto(`/admin/job-codes/${jc.id}`);
  if (await page.getByText("Page not found").count()) await page.reload();
  await expect(page.getByRole("heading", { name: new RegExp(code) })).toBeVisible();
  return jc;
}

async function assign(page: Page, name: string, opts: { rate?: string; primary?: boolean } = {}) {
  await page.getByRole("button", { name: /assign employee/i }).click();
  const d = page.getByRole("dialog", { name: /assign employee to/i });
  await d.getByRole("combobox").click();
  await page.getByRole("option", { name: new RegExp(name) }).click();
  if (opts.rate) await textField(d, "Assigned rate").fill(opts.rate);
  if (opts.primary) await d.getByRole("switch").click();
  return d;
}

const memberCard = (page: Page, name: string) =>
  page.locator("div.rounded-md.border").filter({ has: page.getByRole("link", { name: new RegExp(name) }) });

test.describe("job code assignments", () => {
  test("assign as primary with a rate; employee primary code follows; list shows it", async ({ page }) => {
    const jc = await openCode(page, CODES.a.code);
    const d = await assign(page, PEOPLE.jcA.name, { rate: "$30.00", primary: true });
    await d.getByRole("button", { name: /^assign$/i }).click();
    await expect(toast(page, "Assigned")).toBeVisible();

    const e = await personRow("jcA");
    const row = await db.jobCodeAssignment.findUniqueOrThrow({ where: { jobCodeId_employeeId: { jobCodeId: jc.id, employeeId: e.id } } });
    expect(row).toMatchObject({ isPrimary: true, assignedRate: "$30.00" });
    expect(e.primaryJobCodeId).toBe(jc.id);
    await expect(memberCard(page, PEOPLE.jcA.name)).toContainText("Primary");
    expect(await db.auditLog.count({ where: { action: "job_code.assign", resource: `Employee:${e.id}` } })).toBe(1);
  });

  test("the picker lists only unassigned, non-terminated people", async ({ page }) => {
    await openCode(page, CODES.a.code);
    await page.getByRole("button", { name: /assign employee/i }).click();
    await page.getByRole("dialog").getByRole("combobox").click();
    await expect(page.getByRole("option", { name: new RegExp(PEOPLE.jcA.name) })).toHaveCount(0); // already on it
    await expect(page.getByRole("option", { name: new RegExp(INACTIVE_EMPLOYEE.name) })).toHaveCount(0); // terminated
    await expect(page.getByRole("option", { name: new RegExp(PEOPLE.jcB.name) })).toHaveCount(1);
  });

  test("a second primary code moves the primary flag; rate defaults to NA", async ({ page }) => {
    const second = await openCode(page, CODES.b.code);
    const d = await assign(page, PEOPLE.jcA.name, { primary: true });
    await d.getByRole("button", { name: /^assign$/i }).click();
    await expect(toast(page, "Assigned")).toBeVisible();
    const e = await personRow("jcA");
    const rows = await db.jobCodeAssignment.findMany({ where: { employeeId: e.id } });
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.isPrimary).map((r) => r.jobCodeId)).toEqual([second.id]);
    expect(rows.find((r) => r.jobCodeId === second.id)?.assignedRate).toBe("NA");
    expect(e.primaryJobCodeId).toBe(second.id);
  });

  test("a non-primary assignment adds a code without changing the primary", async ({ page }) => {
    const jc = await openCode(page, CODES.used.code);
    const d = await assign(page, PEOPLE.jcA.name);
    await d.getByRole("button", { name: /^assign$/i }).click();
    await expect(toast(page, "Assigned")).toBeVisible();
    const e = await personRow("jcA");
    expect(e.primaryJobCodeId).toBe((await codeRow(CODES.b.code)).id);
    expect(await db.jobCodeAssignment.count({ where: { employeeId: e.id, jobCodeId: jc.id, isPrimary: false } })).toBe(1);
  });

  test("unassigning the primary code clears the employee's primary code", async ({ page }) => {
    const jc = await openCode(page, CODES.b.code);
    await memberCard(page, PEOPLE.jcA.name).getByRole("button").click();
    await expect(toast(page, "Unassigned")).toBeVisible();
    const e = await personRow("jcA");
    expect(e.primaryJobCodeId).toBeNull();
    expect(await db.jobCodeAssignment.count({ where: { employeeId: e.id, jobCodeId: jc.id } })).toBe(0);
  });

  test("unassign twice (stale page) says the record no longer exists", async ({ page }) => {
    const jc = await openCode(page, CODES.used.code);
    const e = await personRow("jcA");
    await db.jobCodeAssignment.deleteMany({ where: { employeeId: e.id, jobCodeId: jc.id } });
    await db.jobCodeAssignment.create({ data: { employeeId: e.id, jobCodeId: jc.id } });
    await page.reload();
    await db.jobCodeAssignment.deleteMany({ where: { employeeId: e.id, jobCodeId: jc.id } });
    await memberCard(page, PEOPLE.jcA.name).getByRole("button").click();
    await expect(toast(page, /record no longer exists/i)).toBeVisible();
  });

  test("assign: someone deleted the code or the employee meanwhile", async ({ page }) => {
    const code = await db.jobCode.create({ data: { code: "PPXAS", title: "Assign target" } });
    await openCode(page, "PPXAS");
    await db.jobCode.delete({ where: { id: code.id } });
    let d = await assign(page, PEOPLE.jcB.name);
    await d.getByRole("button", { name: /^assign$/i }).click();
    await expect(toast(page, /job code no longer exists/i)).toBeVisible();

    await openCode(page, CODES.a.code);
    d = await assign(page, PEOPLE.jcB.name);
    const user = await db.user.create({ data: { email: "ppnew-assign@ppnew.e2e.test", name: "Gone", role: "EMPLOYEE" } });
    const gone = await db.employee.create({
      data: { employeeId: "PPL-9003", userId: user.id, name: "Gone Assignee", email: user.email, gender: "OTHER", employmentType: "FULL_PART_TIME", compensationType: "HOURLY_RATE" },
    });
    await page.reload();
    d = await assign(page, "Gone Assignee");
    await db.user.delete({ where: { id: user.id } });
    await d.getByRole("button", { name: /^assign$/i }).click();
    await expect(toast(page, /employee was not found/i)).toBeVisible();
    void gone;
  });

  test("assign: failure shows a toast; double click assigns once", async ({ page }) => {
    const jc = await openCode(page, CODES.a.code);
    let d = await assign(page, PEOPLE.jcB.name);
    await failServerActions(page, "abort");
    await d.getByRole("button", { name: /^assign$/i }).click();
    await expect(toast(page, NETWORK_ERROR)).toBeVisible();
    const e = await personRow("jcB");
    expect(await db.jobCodeAssignment.count({ where: { employeeId: e.id, jobCodeId: jc.id } })).toBe(0);

    await openCode(page, CODES.a.code);
    d = await assign(page, PEOPLE.jcB.name);
    const calls = await delayServerActions(page, 1200);
    await d.getByRole("button", { name: /^assign$/i }).dblclick();
    await expect(toast(page, "Assigned")).toBeVisible();
    expect(calls.count()).toBe(1);
    expect(await db.jobCodeAssignment.count({ where: { employeeId: e.id, jobCodeId: jc.id } })).toBe(1);
  });

  test("the employee page lists the assignments with the primary badge", async ({ page }) => {
    const e = await personRow("jcA");
    await db.jobCodeAssignment.upsert({
      where: { jobCodeId_employeeId: { jobCodeId: (await codeRow(CODES.a.code)).id, employeeId: e.id } },
      update: { isPrimary: true },
      create: { jobCodeId: (await codeRow(CODES.a.code)).id, employeeId: e.id, isPrimary: true },
    });
    await page.goto(`/admin/employees/${e.id}`);
    if (await page.getByText("Page not found").count()) await page.reload();
    await page.getByRole("tab", { name: "Work" }).click();
    await expect(page.getByText(/job code assignments \(\d+\)/i)).toBeVisible();
    await expect(page.getByText(CODES.a.code, { exact: true }).first()).toBeVisible();
  });
});
