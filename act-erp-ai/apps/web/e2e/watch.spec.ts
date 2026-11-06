import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { businessYmd, db } from "./support/db";
import { chicago } from "./support/contract";
import { toast } from "./support/helpers";
import { ADMIN_STATE, JOB_CODE } from "./support/test-data";

test.use({ storageState: ADMIN_STATE });

async function longShift(name = "Watch Long Shift") {
  const key = randomUUID();
  const employee = await db.employee.create({ data: {
    employeeId: `WATCH-${key}`, name: `${name} ${key.slice(0, 8)}`,
    gender: "OTHER", compensationType: "HOURLY_RATE",
    user: { create: { name, username: `watch-${key}`, role: "EMPLOYEE" } },
  } });
  const date = businessYmd(7);
  const clockIn = chicago(date, "05:00");
  const entry = await db.timeEntry.create({ data: {
    employeeId: employee.id, date: new Date(`${date}T00:00:00Z`), clockIn,
    clockOut: new Date(clockIn.getTime() + 17 * 3_600_000), totalWorkMin: 1020,
    jobCode: JOB_CODE.code, source: "MANUAL", status: "COMPLETED", approvalStatus: "PENDING",
  } });
  const finding = await db.watchFinding.create({ data: {
    ruleId: "time.impossible-shift", fingerprint: `time.impossible-shift:${entry.id}`,
    subjectType: "TimeEntry", subjectId: entry.id, employeeId: employee.id,
    title: `${employee.name}: long shift`, detail: `${date}: 17 hours`,
    severity: "CRITICAL", evidence: {},
  } });
  return { employee, entry, finding, date };
}

async function openFlag(page: Page, name: string) {
  await page.getByLabel("Search flags").fill(name);
  await page.getByRole("button", { name: new RegExp(name) }).click();
}

test("reviewing keeps a real issue visible; approving a long shift lets recheck resolve it", async ({ page }) => {
  const { employee, entry, finding, date } = await longShift();
  await page.goto("/admin/watch");
  await openFlag(page, employee.name);
  await page.getByRole("button", { name: "Mark reviewed", exact: true }).click();
  await expect(toast(page, /marked reviewed/i)).toBeVisible();
  await expect(page.getByText("Reviewed · unresolved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(employee.name) }).click();
  await page.getByRole("button", { name: "Recheck and resolve", exact: true }).click();
  await expect(toast(page, /still flagged/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the fix page" })).toHaveAttribute("href", `/admin/hours?employee=${employee.id}&from=${date}&to=${date}`);
  expect((await db.watchFinding.findUniqueOrThrow({ where: { id: finding.id } })).status).toBe("ACKNOWLEDGED");

  await db.timeEntry.update({ where: { id: entry.id }, data: { approvalStatus: "APPROVED", status: "APPROVED" } });
  await page.getByRole("button", { name: "Recheck and resolve", exact: true }).click();
  await expect(toast(page, /issue is resolved/i)).toBeVisible();
  await expect(page.getByText("All clear. Nothing needs you.")).toBeVisible();
  expect((await db.watchFinding.findUniqueOrThrow({ where: { id: finding.id } })).status).toBe("RESOLVED");
  const saved = await db.timeEntry.findUniqueOrThrow({ where: { id: entry.id } });
  expect(saved.totalWorkMin).toBe(1020);
  expect(saved.clockOut).toEqual(entry.clockOut);
  expect(await db.auditLog.count({ where: { action: "watch.finding.resolve", resource: `WatchFinding:${finding.id}` } })).toBe(1);
});

test("a corrected acknowledged entry clears on Check now", async ({ page }) => {
  const { employee, entry, finding } = await longShift();
  await db.watchFinding.update({ where: { id: finding.id }, data: { status: "ACKNOWLEDGED" } });
  await db.timeEntry.update({ where: { id: entry.id }, data: { clockOut: new Date(entry.clockIn.getTime() + 8 * 3_600_000), totalWorkMin: 480 } });
  await page.goto("/admin/watch");
  await page.getByRole("button", { name: "Check now", exact: true }).click();
  await expect(toast(page, /checked\./i)).toBeVisible();
  await page.getByLabel("Search flags").fill(employee.name);
  await expect(page.getByRole("button", { name: /shift longer than/i })).toHaveCount(0);
  expect((await db.watchFinding.findUniqueOrThrow({ where: { id: finding.id } })).status).toBe("RESOLVED");
});

test("simultaneous checks claim only one run", async ({ page, context }) => {
  const second = await context.newPage();
  await Promise.all([page.goto("/admin/watch"), second.goto("/admin/watch")]);
  const before = await db.watchRun.count();
  await Promise.all([
    page.getByRole("button", { name: "Check now", exact: true }).click(),
    second.getByRole("button", { name: "Check now", exact: true }).click(),
  ]);
  await expect.poll(async () => [
    await toast(page, /checked\.|already in progress/i).textContent(),
    await toast(second, /checked\.|already in progress/i).textContent(),
  ].join(" ")).toMatch(/already in progress/i);
  await expect.poll(() => db.watchRun.count()).toBe(before + 1);
  await expect.poll(() => db.watchRun.count({ where: { finishedAt: null } })).toBe(0);
  await second.close();
});

test("a keyboard user can open and dismiss a legitimate reviewed exception", async ({ page }, testInfo) => {
  const { employee, finding } = await longShift("Aleksandra Wiśniewska-Kowalczyk 李 — Houston overnight crew");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/watch");
  await page.getByLabel("Search flags").fill(employee.name);
  const title = page.getByRole("button", { name: new RegExp(employee.name) });
  await title.focus();
  await page.keyboard.press("Enter");
  await expect(title).toHaveAttribute("aria-expanded", "true");
  const note = "Confirmed by the supervisor. " + "Overnight coverage was scheduled and reviewed. ".repeat(10);
  await page.getByLabel("Note", { exact: true }).fill(note.slice(0, 500));
  await expect(page.getByLabel("Note", { exact: true })).toHaveAttribute("maxlength", "500");
  await page.screenshot({ path: testInfo.outputPath("watch-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: testInfo.outputPath("watch-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Not a problem", exact: true }).click();
  await expect(toast(page, /not a problem/i)).toBeVisible();
  await page.getByRole("button", { name: /^Dismissed \(/ }).click();
  await expect(page.getByRole("button", { name: new RegExp(employee.name) })).toBeVisible();
  const saved = await db.watchFinding.findUniqueOrThrow({ where: { id: finding.id } });
  expect(saved.status).toBe("DISMISSED");
  expect(saved.handledNote).toBe(note.slice(0, 500).trim());
});
