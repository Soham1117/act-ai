import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import AdmZip from "adm-zip";
import { test, expect, type Page } from "@playwright/test";
import { businessYmd, db } from "./support/db";
import { chicago, makeAgency, makeEntry, makeWorker } from "./support/contract";
import { toast } from "./support/helpers";
import { ADMIN_STATE, JOB_CODE } from "./support/test-data";

test.use({ storageState: ADMIN_STATE });

async function download(page: Page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Excel", exact: true }).click();
  const file = await pending;
  const zip = new AdmZip(await readFile((await file.path())!));
  return {
    filename: file.suggestedFilename(),
    summary: zip.readAsText("xl/worksheets/sheet1.xml"),
    daily: zip.readAsText("xl/worksheets/sheet2.xml"),
  };
}

async function employee(name: string) {
  const key = randomUUID();
  return db.employee.create({
    data: {
      employeeId: `EXPORT-${key.slice(0, 8)}`,
      name,
      gender: "OTHER",
      compensationType: "HOURLY_RATE",
      user: { create: { name, username: `export-${key}`, role: "EMPLOYEE" } },
    },
  });
}

async function punch(employeeId: string, daysAgo: number, minutes: number) {
  const date = businessYmd(daysAgo);
  const clockIn = chicago(date, "08:00");
  return db.timeEntry.create({
    data: {
      employeeId,
      date: new Date(`${date}T00:00:00Z`),
      clockIn,
      clockOut: new Date(clockIn.getTime() + minutes * 60_000),
      totalWorkMin: minutes,
      jobCode: JOB_CODE.code,
      source: "MANUAL",
      approvalStatus: "APPROVED",
      status: "APPROVED",
    },
  });
}

test("employee export contains only that person's hours and uses the dates currently selected", async ({
  page,
}, testInfo) => {
  const selected = await employee("Aleksandra Wiśniewska-Kowalczyk 李 — Overnight Operations");
  const other = await employee("Other Person Must Not Export");
  await punch(selected.id, 2, 240);
  await punch(selected.id, 1, 300);
  await punch(selected.id, 3, 600);
  await punch(other.id, 1, 480);
  await page.goto(
    `/admin/hours?employee=${selected.id}&from=${businessYmd(2)}&to=${businessYmd(1)}`,
  );
  await page.getByRole("button", { name: "Download Excel", exact: true }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("employee-export.png") });
  const bothDays = await download(page);
  expect(bothDays.filename).toBe(
    `employee-hours-${selected.employeeId}-${businessYmd(2)}-to-${businessYmd(1)}.xlsx`,
  );
  expect(bothDays.summary).toContain('<c r="C4" s="0"><v>9</v></c>');
  expect(bothDays.summary).toContain(selected.name);
  expect(bothDays.summary).not.toContain(other.name);
  expect(bothDays.daily).not.toContain(businessYmd(3));

  // Change the date picker without pressing Update. The download must use it.
  await page.getByRole("button", { name: "From date", exact: true }).click();
  const day = new Date(`${businessYmd(1)}T12:00:00`).toLocaleDateString("en-US");
  await page.locator(`button[data-day="${day}"]`).click();
  const oneDay = await download(page);
  expect(oneDay.filename).toContain(`${businessYmd(1)}-to-${businessYmd(1)}`);
  expect(oneDay.summary).toContain('<c r="C4" s="0"><v>5</v></c>');
  expect(oneDay.daily).not.toContain(businessYmd(2));
  const beforePreset = page.url();
  await page.getByRole("link", { name: "Open week", exact: true }).click();
  await page.waitForURL((url) => url.href !== beforePreset);
  const range = new URL(page.url()).searchParams;
  await expect(page.getByRole("button", { name: "From date", exact: true })).toContainText(new Date(`${range.get("from")}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }));
  const preset = await download(page);
  expect(preset.filename).toBe(`employee-hours-${selected.employeeId}-${range.get("from")}-to-${range.get("to")}.xlsx`);
});

test("contract worker export is scoped from the profile and follows worker/date changes without Apply", async ({
  page,
}, testInfo) => {
  const agency = await makeAgency();
  const selected = await makeWorker({
    agencyId: agency.id,
    name: "María Fernanda Rodríguez-Hernández — Contract Crew",
  });
  const other = await makeWorker({
    agencyId: agency.id,
    name: "Separate Contract Export",
  });
  await makeEntry(selected.id, {
    daysAgo: 2,
    in: "08:00",
    out: "16:00",
    approval: "APPROVED",
  });
  await makeEntry(selected.id, {
    daysAgo: 1,
    in: "08:00",
    out: "15:00",
    approval: "APPROVED",
  });
  await makeEntry(selected.id, {
    daysAgo: 3,
    in: "08:00",
    out: "17:00",
    approval: "APPROVED",
  });
  await makeEntry(other.id, {
    daysAgo: 1,
    in: "08:00",
    out: "12:00",
    approval: "APPROVED",
  });
  await page.goto(`/admin/contract-workers/${selected.id}`);
  await page.getByRole("link", { name: "View and export hours", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`worker=${selected.id}`));
  await page.locator("#cw-h-from").fill(businessYmd(2));
  await page.locator("#cw-h-to").fill(businessYmd(1));
  await page.getByRole("button", { name: "Download Excel", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("contract-export.png") });
  const first = await download(page);
  expect(first.filename).toBe(
    `contract-hours-${selected.workerId}-${businessYmd(2)}-to-${businessYmd(1)}.xlsx`,
  );
  expect(first.summary).toContain('<c r="D4" s="0"><v>15</v></c>');
  expect(first.summary).not.toContain(other.name);
  expect(first.daily).not.toContain(businessYmd(3));
  await page.getByRole("combobox", { name: "Worker", exact: true }).click();
  await page
    .getByRole("option", { name: `${other.name} (${other.workerId})`, exact: true })
    .click();
  const second = await download(page);
  expect(second.filename).toContain(other.workerId);
  expect(second.summary).toContain('<c r="D4" s="0"><v>4</v></c>');
  expect(second.summary).not.toContain(selected.name);
});

test("empty employee ranges download nothing, and reversed contract dates are rejected", async ({
  page,
}) => {
  const selected = await employee("Employee With No Hours");
  await page.goto(
    `/admin/hours?employee=${selected.id}&from=${businessYmd(2)}&to=${businessYmd(1)}`,
  );
  let downloaded = false;
  page.on("download", () => {
    downloaded = true;
  });
  await page.getByRole("button", { name: "Download Excel", exact: true }).click();
  await expect(toast(page, /nothing to export/i)).toBeVisible();
  expect(downloaded).toBe(false);
  await page.goto("/admin/contract-workers?tab=hours");
  await page.locator("#cw-h-from").fill(businessYmd(0));
  await page.locator("#cw-h-to").fill(businessYmd(2));
  await page.getByRole("button", { name: "Download Excel", exact: true }).click();
  await expect(toast(page, /choose a valid date range/i)).toBeVisible();
  expect(downloaded).toBe(false);
});
