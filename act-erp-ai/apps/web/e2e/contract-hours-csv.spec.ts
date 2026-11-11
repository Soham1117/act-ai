import { test, expect, type Page } from "@playwright/test";
import { businessYmd } from "./support/db";
import { delayServerActions, expectNoCrash, failServerActions, toast } from "./support/helpers";
import { ADMIN_STATE } from "./support/test-data";
import { hoursUrl, makeAgency, makeEntry, makeWorker, tamperActions } from "./support/contract";
import { personRows, readPeriodWorkbook, weekStartCell } from "./support/xlsx";
import { SERVER_ERROR } from "./support/action-errors";

test.use({ storageState: ADMIN_STATE });

async function openHours(page: Page, agencyId: string, extra = "", from = businessYmd(6), to = businessYmd(0)) {
  await page.goto(hoursUrl(`&hagency=${agencyId}${extra}`, from, to));
  await expect(page.getByRole("button", { name: /download excel/i })).toBeVisible();
}
async function download(page: Page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: /download excel/i }).click();
  return readPeriodWorkbook(await pending);
}
const mdy = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return `${m}/${d}/${y}`;
};

test.describe("admin hours: Excel export", () => {
  test("uses the Period (Detail) layout, one row per worker per week, rejected hours excluded", async ({ page }) => {
    const agency = await makeAgency();
    const w1 = await makeWorker({ agencyId: agency.id, name: "Csv Alpha" });
    const w2 = await makeWorker({ agencyId: agency.id, name: "Csv Beta" });
    // Two punches on one day (approved + pending): 4h + 4.5h = 8:30.
    await makeEntry(w1.id, { daysAgo: 2, in: "08:00", out: "12:00", approval: "APPROVED" });
    await makeEntry(w1.id, { daysAgo: 2, in: "13:00", out: "17:30" });
    // A rejected day adds no hours.
    await makeEntry(w1.id, { daysAgo: 3, in: "09:00", out: "17:00", approval: "REJECTED", notes: "dup" });
    await makeEntry(w2.id, { daysAgo: 2, in: "06:00", out: "14:15", approval: "APPROVED" });
    await openHours(page, agency.id);
    const { filename, sheets, rows } = await download(page);
    await expect(toast(page, /excel downloaded/i)).toBeVisible();
    expect(filename).toBe(`contract-hours-${businessYmd(6)}-to-${businessYmd(0)}.xlsx`);
    expect(sheets).toHaveLength(1);
    expect(rows.slice(0, 3)).toEqual([
      ["Period (Detail)"],
      [`For the period of ${mdy(businessYmd(6))} to ${mdy(businessYmd(0))}`],
      ["Name", "Week Start", "Hours", "Regular", "Overtime 1"],
    ]);
    const week = weekStartCell(businessYmd(2));
    expect(personRows(rows, "Csv Alpha")).toEqual([
      ["Csv Alpha", week, "8:30", "8:30", "0:00"],
      ["Totals for Csv Alpha:", "", "8:30", "8:30", "0:00"],
    ]);
    expect(personRows(rows, "Csv Beta")).toEqual([
      ["Csv Beta", week, "8:15", "8:15", "0:00"],
      ["Totals for Csv Beta:", "", "8:15", "8:15", "0:00"],
    ]);
    expect(rows.at(-1)).toEqual(["Control Totals:", "", "16:45", "16:45", "0:00"]);
  });

  test("respects the date range and the agency filter, but not the approval filter", async ({ page }) => {
    const a = await makeAgency();
    const b = await makeAgency();
    const wa = await makeWorker({ agencyId: a.id, name: "Csv InRange" });
    const wb = await makeWorker({ agencyId: b.id, name: "Csv OtherAgency" });
    await makeEntry(wa.id, { daysAgo: 1 }); // pending, in range
    await makeEntry(wa.id, { daysAgo: 20, approval: "APPROVED" }); // out of range
    await makeEntry(wb.id, { daysAgo: 1 });

    await openHours(page, a.id, "&approval=APPROVED");
    const onlyA = (await download(page)).rows;
    // The pending day is exported: the approval filter does not apply to the export.
    expect(personRows(onlyA, "Csv InRange")).toHaveLength(2);
    expect(personRows(onlyA, "Csv OtherAgency")).toHaveLength(0);

    // No agency filter: both agencies appear.
    await page.goto(hoursUrl("", businessYmd(2), businessYmd(0)));
    const all = (await download(page)).rows;
    expect(personRows(all, "Csv InRange")).toHaveLength(2);
    expect(personRows(all, "Csv OtherAgency")).toHaveLength(2);

    // Widening the range brings the old entry in (a second week row).
    await openHours(page, a.id, "", businessYmd(25), businessYmd(0));
    expect(personRows((await download(page)).rows, "Csv InRange")).toHaveLength(3);
  });

  test("an empty range shows a message and downloads nothing", async ({ page }) => {
    const agency = await makeAgency();
    await openHours(page, agency.id);
    await expect(page.getByText(/no entries in this range/i)).toBeVisible();
    let downloaded = false;
    page.on("download", () => {
      downloaded = true;
    });
    await page.getByRole("button", { name: /download excel/i }).click();
    await expect(toast(page, /no entries in this range, so there is nothing to export\./i)).toBeVisible();
    await expect(page.getByRole("button", { name: /download excel/i })).toBeEnabled();
    expect(downloaded).toBe(false);
    await expect(toast(page, /excel downloaded/i)).toHaveCount(0);
  });

  test("spreadsheet formulas in names stay plain text", async ({ page }) => {
    const agency = await makeAgency();
    const name = '=HYPERLINK("http://evil.test","x")';
    const w = await makeWorker({ agencyId: agency.id, name });
    await makeEntry(w.id, { daysAgo: 1 });
    await openHours(page, agency.id);
    const { rows, xml } = await download(page);
    expect(personRows(rows, name)[0]![0]).toBe(name);
    expect(xml).not.toContain("<f>");
  });

  test("the server refuses an invalid date range", async ({ page }) => {
    const agency = await makeAgency();
    await openHours(page, agency.id);
    await tamperActions(page, (b) => b.replace(/"\d{4}-\d{2}-\d{2}"/, '"2026-02-30"'));
    await page.getByRole("button", { name: /download excel/i }).click();
    await expect(toast(page, /choose a valid date range/i)).toBeVisible();
    await expect(toast(page, /excel downloaded/i)).toHaveCount(0);
  });

  test("server failure while exporting shows an error and no file", async ({ page }) => {
    const agency = await makeAgency();
    await openHours(page, agency.id);
    let downloaded = false;
    page.on("download", () => (downloaded = true));
    await failServerActions(page, "500");
    await page.getByRole("button", { name: /download excel/i }).click();
    await expect(toast(page, SERVER_ERROR)).toBeVisible();
    await expectNoCrash(page);
    expect(downloaded).toBe(false);
  });

  test("double-clicking Download Excel exports once", async ({ page }) => {
    const agency = await makeAgency();
    const w = await makeWorker({ agencyId: agency.id });
    await makeEntry(w.id, { daysAgo: 1 });
    await openHours(page, agency.id);
    const slow = await delayServerActions(page, 1200);
    const btn = page.getByRole("button", { name: /download excel/i });
    const files: string[] = [];
    page.on("download", (d) => files.push(d.suggestedFilename()));
    await btn.click();
    await expect(btn).toBeDisabled();
    await btn.click({ force: true, timeout: 1000 }).catch(() => undefined);
    await expect(toast(page, /excel downloaded/i)).toBeVisible();
    expect(slow.count()).toBe(1);
    expect(files).toHaveLength(1);
  });
});
