import { test, expect, type Page } from "@playwright/test";
import { db } from "./support/db";
import { openKiosk, toast } from "./support/helpers";
import { makeWorker, typeCrewPin } from "./support/contract";
import { ADMIN_STATE, EMPLOYEE, KIOSK_CREW_SLUG } from "./support/test-data";

test.use({ storageState: ADMIN_STATE });

/** datetime-local value (Central) for `minutesAgo` before now. */
function centralLocal(minutesAgo: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(Date.now() - minutesAgo * 60_000));
  const v = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${v("year")}-${v("month")}-${v("day")}T${v("hour")}:${v("minute")}`;
}

async function fillMissedClockIn(page: Page, minutesAgo: number) {
  await page.getByLabel("Clock in", { exact: true }).fill(centralLocal(minutesAgo));
  await expect(page.getByLabel(/clock out \(empty if still working\)/i)).toHaveValue("");
  await expect(page.getByText("Approve immediately")).toHaveCount(0);
}

test("contract worker: admin adds a missed clock-in, then the worker clocks out at the kiosk", async ({ page, browser }) => {
  const worker = await makeWorker();
  await page.goto(`/admin/contract-workers/${worker.id}`);
  await page.getByRole("button", { name: "Add entry", exact: true }).click();
  await fillMissedClockIn(page, 90);
  await page.getByLabel(/reason/i).fill("Forgot to clock in");
  await page.getByRole("button", { name: "Clock in", exact: true }).click();
  await expect(toast(page, /clocked in\. the worker clocks out at the kiosk/i)).toBeVisible();

  const [open] = await db.contractTimeEntry.findMany({ where: { contractWorkerId: worker.id } });
  expect(open?.status).toBe("ACTIVE");
  expect(open?.clockOut).toBeNull();
  expect(open?.editReason).toBe("Missed clock-in: Forgot to clock in");
  expect(Math.abs(Date.now() - 90 * 60_000 - open!.clockIn.getTime())).toBeLessThan(2 * 60_000);
  expect(await db.auditLog.count({ where: { action: "contract.time.missed_clock_in", resource: `ContractTimeEntry:${open!.id}` } })).toBe(1);

  // A second missed clock-in while the shift is open is refused.
  await page.getByRole("button", { name: "Add entry", exact: true }).click();
  await fillMissedClockIn(page, 30);
  await page.getByLabel(/reason/i).fill("Duplicate attempt");
  await page.getByRole("button", { name: "Clock in", exact: true }).click();
  await expect(toast(page, /already clocked in/i)).toBeVisible();

  // The worker clocks out at the kiosk as usual.
  const kiosk = await openKiosk(browser, KIOSK_CREW_SLUG, { cookieSuffix: "-crew" });
  await kiosk.getByRole("button", { name: /contract crew/i }).click();
  await kiosk.getByRole("button", { name: new RegExp(worker.name) }).first().click();
  await typeCrewPin(kiosk);
  await kiosk.getByRole("button", { name: /^clock out$/i }).click();
  await expect(toast(kiosk, /clocked out ·/i)).toBeVisible();
  const done = await db.contractTimeEntry.findUniqueOrThrow({ where: { id: open!.id } });
  expect(done.clockOut).not.toBeNull();
  expect(done.totalWorkMin).toBeGreaterThanOrEqual(89);
  await kiosk.context().close();
});

test("employee: admin adds a missed clock-in that stays open for the employee to clock out", async ({ page }) => {
  const employee = await db.employee.findUniqueOrThrow({ where: { employeeId: EMPLOYEE.employeeId } });
  await db.timeEntry.deleteMany({ where: { employeeId: employee.id, status: { in: ["ACTIVE", "ON_BREAK"] } } });
  try {
    await page.goto(`/admin/hours?employee=${employee.id}`);
    await page.getByRole("button", { name: "Add entry", exact: true }).click();
    await fillMissedClockIn(page, 45);
    await page.getByLabel(/reason/i).fill("Forgot to clock in");
    await page.getByRole("button", { name: "Clock in", exact: true }).click();
    await expect(toast(page, /clocked in\. the employee clocks out as usual/i)).toBeVisible();
    const open = await db.timeEntry.findFirstOrThrow({
      where: { employeeId: employee.id, status: "ACTIVE" },
    });
    expect(open.clockOut).toBeNull();
    expect(open.source).toBe("MANUAL");
    expect(open.editReason).toBe("Missed clock-in: Forgot to clock in");

    // A future clock-in is refused.
    await db.timeEntry.delete({ where: { id: open.id } });
    await page.getByRole("button", { name: "Add entry", exact: true }).click();
    await fillMissedClockIn(page, -60);
    await page.getByLabel(/reason/i).fill("Future");
    await page.getByRole("button", { name: "Clock in", exact: true }).click();
    await expect(toast(page, /can't be in the future/i)).toBeVisible();
  } finally {
    await db.timeEntry.deleteMany({ where: { employeeId: employee.id, editReason: { startsWith: "Missed clock-in:" } } });
  }
});
