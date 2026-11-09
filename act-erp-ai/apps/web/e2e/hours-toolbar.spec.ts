import { test, expect } from "@playwright/test";
import { ADMIN_STATE } from "./support/test-data";

test.use({ storageState: ADMIN_STATE });

test("period dropdown and compact toolbar work across both workforces", async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === "mobile-chrome";
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1920, height: 1080 });
  for (const scope of ["employees", "contract-workers"]) {
    const path = scope === "employees" ? "/admin/hours" : "/admin/hours/contract-workers";
    await page.goto(path);
    const period = page.getByRole("combobox", { name: "Period", exact: true });
    await expect(period).toBeVisible();
    const from = page.getByLabel("From date", { exact: true });
    const add = page.getByRole("button", { name: "Add entry", exact: true });
    if (!mobile) {
      const controls = [period, from, page.getByLabel("To date", { exact: true }), page.getByRole("button", { name: "Update", exact: true }), add, page.getByRole("link", { name: "Bulk entry", exact: true }).last()];
      const bottoms = await Promise.all(controls.map(async control => { const box = await control.boundingBox(); return box!.y + box!.height; }));
      expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThanOrEqual(1);
    }
    await period.click();
    await expect(page.getByRole("option", { name: "Open week", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`${scope}-period-open.png`), fullPage: false });
    const choice = page.getByRole("option").last();
    const selectedLabel = await choice.innerText();
    await choice.click();
    await expect(page).toHaveURL(url => url.pathname === path && url.searchParams.has("from") && url.searchParams.has("to"));
    await expect(period).toContainText(selectedLabel);
    await add.click();
    await expect(page.getByRole("heading", { name: scope === "employees" ? "Add manual time entry" : "Add contract hours", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`${scope}-toolbar.png`), fullPage: true });
  }
});


