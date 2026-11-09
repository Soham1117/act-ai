import { test, expect } from "@playwright/test";
import { ADMIN_STATE } from "./support/test-data";
import { businessYmd, db } from "./support/db";
import { makeAgency, makeWorker, makeEntry } from "./support/contract";

test.use({ storageState: ADMIN_STATE });
const path = "/admin/hours/contract-workers";

test("switching workforces keeps the dates and legacy contract links keep all filters", async ({ page }) => {
  const from = businessYmd(3);
  const to = businessYmd(0);
  await page.goto(`/admin/hours?from=${from}&to=${to}`);
  await page.getByRole("navigation", { name: "Hours workforce" }).getByRole("link", { name: "Contract workers", exact: true }).click();
  await expect(page).toHaveURL(`${new URL(page.url()).origin}${path}?from=${from}&to=${to}`);
  await expect(page.getByRole("region", { name: "Contract workers picker" })).toBeVisible();
  await page.getByRole("navigation", { name: "Hours workforce" }).getByRole("link", { name: "Employees", exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/admin/hours" && url.searchParams.get("from") === from && url.searchParams.get("to") === to);
  await page.goto(`/admin/contract-workers?tab=hours&from=${from}&to=${to}&hagency=legacy-agency&worker=legacy-worker&approval=REJECTED`);
  await expect(page).toHaveURL((url) => url.pathname === path);
  const params = new URL(page.url()).searchParams;
  expect(Object.fromEntries(params)).toEqual({ from, to, hagency: "legacy-agency", worker: "legacy-worker", approval: "REJECTED" });
});

test("contract hours keeps approval and export behavior and handles long names and empty searches", async ({ page }, testInfo) => {
  const agency = await makeAgency({ name: "Long staffing agency " + "Worldwide".repeat(8) });
  const worker = await makeWorker({ agencyId: agency.id, name: "Alexandria " + "Verylongfamilyname".repeat(8) });
  const entry = await makeEntry(worker.id, { daysAgo: 1 });
  const from = businessYmd(3);
  const to = businessYmd(0);
  try {
    await page.goto(`${path}?from=${from}&to=${to}&hagency=${agency.id}`);
    const picker = page.getByRole("region", { name: "Contract workers picker" });
    await picker.getByRole("link", { name: new RegExp(worker.name) }).click();
    await expect(page).toHaveURL(new RegExp(`worker=${worker.id}`));
    await expect(page.getByRole("button", { name: "Download Excel", exact: true })).toBeVisible();
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download Excel", exact: true }).click();
    expect((await downloading).suggestedFilename()).toMatch(/\.xlsx$/);
    await page.getByRole("button", { name: "Add entry", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Add contract hours" })).toBeVisible();
    const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(horizontalOverflow).toBe(false);
    await page.screenshot({ path: testInfo.outputPath("contract-hours-open.png"), fullPage: true });
    await page.goto(`${path}?from=${from}&to=${to}&hagency=${agency.id}`);
    await page.getByRole("button", { name: `Approve entry for ${worker.name}`, exact: true }).click();
    await expect.poll(async () => (await db.contractTimeEntry.findUniqueOrThrow({ where: { id: entry.id } })).approvalStatus).toBe("APPROVED");
    await picker.getByRole("textbox", { name: "Search contract workers" }).fill("no-matching-worker-xyz");
    await picker.getByRole("button", { name: "Go", exact: true }).click();
    await expect(page.getByText("No matches. Try another search.")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  } finally {
    await db.contractWorker.delete({ where: { id: worker.id } });
    await db.staffingAgency.delete({ where: { id: agency.id } });
  }
});
