import { test, expect } from "@playwright/test";
import { db, businessYmd } from "./support/db";
import { ADMIN_STATE, JOB_CODE, KIOSK_ACTIVE_SLUG } from "./support/test-data";
import { PEOPLE, PEOPLE_PASSWORD, loginAs, personRow, personUrl } from "./support/people";
import { openKiosk, toast } from "./support/helpers";
import { makeWorker, makeOpenEntry, openCrewKiosk, workersUrl, tamperActions } from "./support/contract";
import { businessDateOnly } from "../src/lib/format";

test.use({ storageState: ADMIN_STATE });

test.describe("inactive status", () => {
  test("a crafted termination action cannot bypass the inactive transition", async ({ page }) => {
    const employee = await personRow("terry");
    await db.employee.update({ where: { id: employee.id }, data: { employmentStatus: "ACTIVE", terminationDate: null, terminationReason: null } });
    await page.goto(await personUrl("terry"));
    await page.getByRole("button", { name: /^terminate$/i }).click();
    await tamperActions(page, (body) => body.replace(/TERMINATED/g, "INACTIVE"));
    await page.getByRole("dialog", { name: /terminate employee/i }).getByRole("button", { name: /^terminate$/i }).click();
    await expect(toast(page, /invalid option/i)).toBeVisible();
    expect((await personRow("terry")).employmentStatus).toBe("ACTIVE");
  });

  test("employee pause keeps read-only access and history, closes shifts, hides active roster, and can be reversed", async ({ page, browser }) => {
    const employee = await personRow("terry");
    await db.employee.update({ where: { id: employee.id }, data: { employmentStatus: "ACTIVE", terminationDate: null, terminationReason: null } });
    const now = new Date();
    const entry = await db.timeEntry.create({ data: {
      employeeId: employee.id, date: businessDateOnly(now), clockIn: new Date(now.getTime() - 90 * 60_000),
      status: "ON_BREAK", jobCode: JOB_CODE.code, source: "KIOSK",
      breaks: { create: { startTime: new Date(now.getTime() - 15 * 60_000) } },
    } });
    const countBefore = await db.timeEntry.count({ where: { employeeId: employee.id } });
    await page.goto(await personUrl("terry"));
    await page.getByRole("button", { name: /^make inactive$/i }).click();
    await page.getByRole("dialog", { name: /make employee inactive/i }).getByRole("button", { name: /^make inactive$/i }).click();
    await expect(toast(page, /employee made inactive/i)).toBeVisible();
    const inactive = await personRow("terry");
    expect(inactive.employmentStatus).toBe("INACTIVE");
    expect(inactive.terminationDate).toBeNull();
    expect(inactive.terminationReason).toBeNull();
    expect(inactive.dateOfHire).toEqual(employee.dateOfHire);
    const closed = await db.timeEntry.findUniqueOrThrow({ where: { id: entry.id }, include: { breaks: true } });
    expect(closed.clockOut).not.toBeNull();
    expect(closed.approvalStatus).toBe("PENDING");
    expect(closed.breaks[0].endTime).not.toBeNull();
    expect(await db.timeEntry.count({ where: { employeeId: employee.id } })).toBe(countBefore);

    const portal = await loginAs(browser, PEOPLE.terry.email, PEOPLE_PASSWORD);
    await expect(portal.getByRole("status").filter({ hasText: /account is inactive and read-only/i })).toBeVisible();
    await portal.goto("/dashboard/documents");
    await expect(portal.getByRole("status").filter({ hasText: /inactive and read-only/i })).toBeVisible();
    const kiosk = await openKiosk(browser, KIOSK_ACTIVE_SLUG);
    await expect(kiosk.getByText(PEOPLE.terry.name)).toHaveCount(0);
    await kiosk.context().close();

    await page.goto("/admin/employees");
    await page.locator('input[placeholder^="Search name, email, ID"]').fill(PEOPLE.terry.name);
    await expect(page.getByRole("row").filter({ hasText: PEOPLE.terry.name })).toHaveCount(0);
    await page.getByLabel(/show inactive/i).click();
    await expect(page.getByRole("row").filter({ hasText: PEOPLE.terry.name })).toContainText("INACTIVE");
    await page.goto(await personUrl("terry"));
    await page.getByRole("button", { name: /^reactivate$/i }).click();
    await expect(toast(page, "Employee reactivated")).toBeVisible();
    expect((await personRow("terry")).employmentStatus).toBe("ACTIVE");
    await portal.reload();
    await expect(portal.getByRole("status").filter({ hasText: /inactive and read-only/i })).toHaveCount(0);
    await portal.context().close();
  });

  test("contract crew pause closes open breaks without ending the assignment and activation preserves dates", async ({ page, browser }) => {
    const worker = await makeWorker({ name: "Inactive lifecycle worker", endDaysAgo: -14 });
    const entry = await makeOpenEntry(worker.id, 2);
    await db.contractTimeEntry.update({ where: { id: entry.id }, data: { status: "ON_BREAK" } });
    await db.contractTimeBreak.create({ data: { timeEntryId: entry.id, startTime: new Date(Date.now() - 20 * 60_000) } });
    await page.goto(workersUrl(worker.name));
    await page.getByRole("row").filter({ hasText: worker.name }).getByRole("button", { name: /^make inactive$/i }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^make inactive$/i }).click();
    await expect(toast(page, /made inactive/i)).toBeVisible();
    const paused = await db.contractWorker.findUniqueOrThrow({ where: { id: worker.id } });
    expect(paused.status).toBe("INACTIVE");
    expect(paused.startDate).toEqual(worker.startDate);
    expect(paused.endDate).toEqual(worker.endDate);
    const closed = await db.contractTimeEntry.findUniqueOrThrow({ where: { id: entry.id }, include: { breaks: true } });
    expect(closed.clockOut).not.toBeNull();
    expect(closed.approvalStatus).toBe("PENDING");
    expect(closed.breaks[0].endTime).not.toBeNull();
    expect(await db.contractTimeEntry.count({ where: { contractWorkerId: worker.id } })).toBe(1);
    await page.goto(`/admin/contract-workers?tab=workers&status=INACTIVE&q=${encodeURIComponent(worker.name)}`);
    await expect(page.getByRole("row").filter({ hasText: worker.name })).toContainText("Inactive");
    const kiosk = await openCrewKiosk(browser, 39);
    await kiosk.getByPlaceholder(/search by name or cw id/i).fill(worker.name);
    await expect(kiosk.getByRole("button", { name: worker.name })).toHaveCount(0);
    await kiosk.context().close();
    await page.getByRole("row").filter({ hasText: worker.name }).getByRole("button", { name: /^activate$/i }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^activate$/i }).click();
    await expect(toast(page, /activated/i)).toBeVisible();
    const active = await db.contractWorker.findUniqueOrThrow({ where: { id: worker.id } });
    expect(active.status).toBe("ACTIVE");
    expect(active.startDate).toEqual(worker.startDate);
    expect(active.endDate).toEqual(worker.endDate);
    expect(active.endDate?.toISOString().slice(0, 10)).toBe(businessYmd(-14));
    await page.goto(`/admin/contract-workers?tab=workers&status=ACTIVE&q=${encodeURIComponent(worker.name)}`);
    await expect(page.getByRole("row").filter({ hasText: worker.name })).toBeVisible();
  });
});
