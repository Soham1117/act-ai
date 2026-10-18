import { test, expect, type Page } from "@playwright/test";
import { businessYmd } from "./support/db";
import { delayServerActions, expectNoCrash, failServerActions, toast } from "./support/helpers";
import { ADMIN_STATE } from "./support/test-data";
import {
  downloadText,
  hoursUrl,
  makeAgency,
  makeEntry,
  makeWorker,
  parseCsv,
  tamperActions,
} from "./support/contract";
import { SERVER_ERROR } from "./support/action-errors";

test.use({ storageState: ADMIN_STATE });

const HEADER = [
  "Agency",
  "Worker ID",
  "Name",
  "Date",
  "Clock in",
  "Clock out",
  "Break min",
  "Work hours",
  "Job code",
  "Approval",
];

async function openHours(page: Page, agencyId: string, extra = "", from = businessYmd(6), to = businessYmd(0)) {
  await page.goto(hoursUrl(`&hagency=${agencyId}${extra}`, from, to));
  await expect(page.getByRole("button", { name: /download csv/i })).toBeVisible();
}
const download = (page: Page) =>
  downloadText(page, () => page.getByRole("button", { name: /download csv/i }).click());

test.describe("admin hours: CSV export", () => {
  test("exports one row per worker per day with merged punches, rejected hours excluded", async ({ page }) => {
    const agency = await makeAgency();
    const w1 = await makeWorker({ agencyId: agency.id, name: "Csv Alpha" });
    const w2 = await makeWorker({ agencyId: agency.id, name: "Csv Beta" });
    // Two punches on one day: merged into one row, 4h + 4.5h = 8.50, mixed approval.
    await makeEntry(w1.id, { daysAgo: 2, in: "08:00", out: "12:00", approval: "APPROVED" });
    await makeEntry(w1.id, { daysAgo: 2, in: "13:00", out: "17:30" });
    // A rejected day adds no hours.
    await makeEntry(w1.id, { daysAgo: 3, in: "09:00", out: "17:00", approval: "REJECTED", notes: "dup" });
    await makeEntry(w2.id, { daysAgo: 2, in: "06:00", out: "14:15", approval: "APPROVED" });
    await openHours(page, agency.id);
    const { filename, text } = await download(page);
    await expect(toast(page, /csv downloaded/i)).toBeVisible();
    expect(filename).toBe(`contract-hours-${businessYmd(6)}-to-${businessYmd(0)}.csv`);
    const rows = parseCsv(text);
    expect(rows[0]).toEqual(HEADER);
    const key = (r: string[]) => `${r[1]}|${r[3]}`; // order across workers follows the random worker id
    const sorted = (rs: string[][]) => [...rs].sort((a, b) => key(a).localeCompare(key(b)));
    expect(sorted(rows.slice(1))).toEqual(sorted([
      [agency.name, w1.workerId, "Csv Alpha", businessYmd(3), "9:00 AM", "5:00 PM", "0", "0.00", "E2E100", "REJECTED"],
      [agency.name, w1.workerId, "Csv Alpha", businessYmd(2), "8:00 AM", "5:30 PM", "0", "8.50", "E2E100", "MIXED"],
      [agency.name, w2.workerId, "Csv Beta", businessYmd(2), "6:00 AM", "2:15 PM", "0", "8.25", "E2E100", "APPROVED"],
    ]));
    // RFC 4180 line endings and every field quoted.
    expect(text).toContain("\r\n");
    expect(text.split("\r\n")[0]).toBe(HEADER.map((h) => `"${h}"`).join(","));
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
    const onlyA = parseCsv((await download(page)).text).slice(1);
    expect(onlyA).toHaveLength(1);
    expect(onlyA[0]![2]).toBe("Csv InRange");
    expect(onlyA[0]![9]).toBe("PENDING"); // approval filter does not apply to the export

    // No agency filter: both agencies appear (sorted by agency name).
    await page.goto(hoursUrl("", businessYmd(2), businessYmd(0)));
    const all = parseCsv((await download(page)).text).slice(1);
    const names = all.map((r) => r[2]);
    expect(names).toContain("Csv InRange");
    expect(names).toContain("Csv OtherAgency");
    expect(names).not.toContain("never");

    // Widening the range brings the old entry in.
    await openHours(page, a.id, "", businessYmd(25), businessYmd(0));
    expect(parseCsv((await download(page)).text).slice(1)).toHaveLength(2);
  });

  test("an empty range shows a message and downloads nothing", async ({ page }) => {
    const agency = await makeAgency();
    await openHours(page, agency.id);
    await expect(page.getByText(/no entries in this range/i)).toBeVisible();
    let downloaded = false;
    page.on("download", () => {
      downloaded = true;
    });
    await page.getByRole("button", { name: /download csv/i }).click();
    await expect(toast(page, /no entries in this range, so there is nothing to export\./i)).toBeVisible();
    await expect(page.getByRole("button", { name: /download csv/i })).toBeEnabled();
    expect(downloaded).toBe(false);
    await expect(toast(page, /csv downloaded/i)).toHaveCount(0);
  });

  test("spreadsheet formulas in names are neutralised and quotes are escaped", async ({ page }) => {
    const agency = await makeAgency();
    const w = await makeWorker({ agencyId: agency.id, name: '=HYPERLINK("http://evil.test","x")' });
    await makeEntry(w.id, { daysAgo: 1 });
    await openHours(page, agency.id);
    const { text } = await download(page);
    const [, row] = parseCsv(text);
    expect(row![2]).toBe(`'=HYPERLINK("http://evil.test","x")`);
    expect(text).toContain(`"'=HYPERLINK(""http://evil.test"",""x"")"`);
  });

  test("the server refuses an invalid date range", async ({ page }) => {
    const agency = await makeAgency();
    await openHours(page, agency.id);
    await tamperActions(page, (b) => b.replace(/"\d{4}-\d{2}-\d{2}"/, '"2026-02-30"'));
    await page.getByRole("button", { name: /download csv/i }).click();
    await expect(toast(page, /choose a valid date range/i)).toBeVisible();
    await expect(toast(page, /csv downloaded/i)).toHaveCount(0);
  });

  test("server failure while exporting shows an error and no file", async ({ page }) => {
    const agency = await makeAgency();
    await openHours(page, agency.id);
    let downloaded = false;
    page.on("download", () => (downloaded = true));
    await failServerActions(page, "500");
    await page.getByRole("button", { name: /download csv/i }).click();
    await expect(toast(page, SERVER_ERROR)).toBeVisible();
    await expectNoCrash(page);
    expect(downloaded).toBe(false);
  });

  test("double-clicking Download CSV exports once", async ({ page }) => {
    const agency = await makeAgency();
    const w = await makeWorker({ agencyId: agency.id });
    await makeEntry(w.id, { daysAgo: 1 });
    await openHours(page, agency.id);
    const slow = await delayServerActions(page, 1200);
    const btn = page.getByRole("button", { name: /download csv/i });
    const files: string[] = [];
    page.on("download", (d) => files.push(d.suggestedFilename()));
    await btn.click();
    await expect(btn).toBeDisabled();
    await btn.click({ force: true, timeout: 1000 }).catch(() => undefined);
    await expect(toast(page, /csv downloaded/i)).toBeVisible();
    expect(slow.count()).toBe(1);
    expect(files).toHaveLength(1);
  });
});
