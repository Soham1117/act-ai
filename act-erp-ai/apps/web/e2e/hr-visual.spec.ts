import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { ADMIN_STATE } from "./support/test-data";

test.use({storageState: ADMIN_STATE});
test("HR pages remain usable on desktop and a narrow phone", async ({page}) => {
  const out = "D:/Deployed Projects/ACT Sprout/tmp/persona-hr-release/qa";
  await mkdir(out, {recursive: true});
  for (const width of [1366, 390]) {
    await page.setViewportSize({width, height: 900});
    await page.goto("/admin/documents/company");
    await page.getByRole("button", {name: "Upload company document", exact: true}).click();
    await expect(page.getByLabel("Title", {exact: true})).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({path: `${out}/company-${width}.png`, fullPage: true, caret: "initial"});
    await page.goto("/admin/benefits/eligibility");
    await expect(page.getByRole("heading", {name: "Benefit eligibility", exact: true})).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({path: `${out}/eligibility-${width}.png`, caret: "initial"});
    await page.goto("/admin/onboarding/checklists");
    await expect(page.getByRole("heading", {name: "Onboarding checklists", exact: true})).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({path: `${out}/onboarding-${width}.png`, fullPage: true, caret: "initial"});
  }
});
