import { test, expect } from "@playwright/test";
import { db } from "./support/db";
import { SS, SS_OLIVE_DOC_TITLE, empDbId, loginState } from "./support/self-service";

// My details is a read-only view of the signed-in employee's own record (Sam).
test.use({ storageState: "e2e/.auth/sam-details.json" });

test.beforeAll(async ({ browser }) => {
  await loginState(browser, SS.sam, "sam-details");
});

test("shows the signed-in employee's own details across the tabs", async ({ page }) => {
  const id = await empDbId(SS.sam);
  const adminUser = await db.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  const doc = await db.document.create({
    data: { employeeId: id, title: "Sam's offer letter", fileName: `${id}/offer.pdf`, fileType: "application/pdf", fileUrl: "x", documentType: "ONBOARDING", uploadedById: adminUser.id },
  });
  try {
    await page.goto("/dashboard/my-details");
    await expect(page.getByText(SS.sam.name).first()).toBeVisible();
    await expect(page.getByText(SS.sam.email).first()).toBeVisible();
    for (const tab of ["Basic info", "Work", "Time clock", "Leave", "Payroll", "Documents", "Benefits", "Training"]) {
      await page.getByRole("tab", { name: tab }).click();
    }
    await page.getByRole("tab", { name: "Documents" }).click();
    await expect(page.getByText("Sam's offer letter")).toBeVisible();
    await expect(page.getByText(SS_OLIVE_DOC_TITLE)).toHaveCount(0);
    await expect(page.getByText("Olive Other")).toHaveCount(0);
  } finally {
    await db.document.delete({ where: { id: doc.id } });
  }
});

test("has no edit controls (details are changed through a request)", async ({ page }) => {
  await page.goto("/dashboard/my-details");
  await expect(page.getByRole("button", { name: /^(edit|save)$/i })).toHaveCount(0);
  await expect(page.locator("form")).toHaveCount(0);
});

test("needs a signed-in user", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${process.env.E2E_PORT}/dashboard/my-details`);
  await expect(page).toHaveURL(/\/login/);
  await ctx.close();
});
