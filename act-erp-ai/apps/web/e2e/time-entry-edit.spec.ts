import { test, expect, type Page } from "@playwright/test";
import { businessYmd, db } from "./support/db";
import { expectNoCrash, failServerActions, toast } from "./support/helpers";
import { ADMIN_STATE, EMPLOYEE } from "./support/test-data";

test.use({ storageState: ADMIN_STATE });

// Yesterday's date as the list prints it. Other specs add their own Erin entries and
// stale/auto-closed shifts, so never rely on "first row" or on the default tab.
const yesterdayText = new Date(`${businessYmd(1)}T00:00:00Z`).toLocaleDateString("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
});

/** Opens the edit dialog for Erin's seeded entry from yesterday. */
async function openEdit(page: Page) {
  await page.goto(
    `/admin/time-tracking?tab=entries&from=${businessYmd(3)}&to=${businessYmd(0)}&q=${encodeURIComponent(EMPLOYEE.name)}`,
  );
  await page
    .getByRole("listitem")
    .filter({ hasText: yesterdayText })
    .filter({ hasText: "Manual" })
    .getByRole("button", { name: /edit time entry for/i })
    .click();
  const dialog = page.getByRole("dialog", { name: /edit time entry/i });
  await expect(dialog).toBeVisible();
  return dialog;
}

const seededEntry = () =>
  db.timeEntry.findFirstOrThrow({
    where: {
      employee: { employeeId: EMPLOYEE.employeeId },
      source: "MANUAL",
      approvalStatus: "PENDING",
      date: new Date(`${businessYmd(1)}T00:00:00Z`),
    },
  });

test.describe("admin: manual time entry edit", () => {
  test("changing times needs a reason", async ({ page }) => {
    const dialog = await openEdit(page);
    await dialog.getByRole("button", { name: /save changes/i }).click();
    await expect(toast(page, /enter a reason/i)).toBeVisible();
    expect((await seededEntry()).editReason).toBeNull();
  });

  test("clock-out before clock-in is rejected with a clear message", async ({ page }) => {
    const dialog = await openEdit(page);
    const [clockIn, clockOut] = await dialog.locator('input[type="datetime-local"]').all();
    const inValue = await clockIn!.inputValue();
    await clockOut!.fill(`${inValue.slice(0, 10)}T01:00`); // earlier than clock-in
    await dialog.getByPlaceholder(/forgot to clock out/i).fill("Testing a bad edit");
    const before = await seededEntry();
    await dialog.getByRole("button", { name: /save changes/i }).click();
    await expect(toast(page, /clock.?out|after|before/i)).toBeVisible();
    expect((await seededEntry()).totalWorkMin).toBe(before.totalWorkMin);
  });

  test("server failure while saving shows an error and keeps the old times", async ({ page }) => {
    const dialog = await openEdit(page);
    await dialog.getByPlaceholder(/forgot to clock out/i).fill("Network will fail");
    await failServerActions(page, "abort");
    await dialog.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect((await seededEntry()).editReason).toBeNull();
  });

  test("admin corrects the clock-out time with a reason", async ({ page }) => {
    const dialog = await openEdit(page);
    const [clockIn, clockOut] = await dialog.locator('input[type="datetime-local"]').all();
    const day = (await clockIn!.inputValue()).slice(0, 10);
    await clockIn!.fill(`${day}T09:00`);
    await clockOut!.fill(`${day}T18:30`);
    await dialog.getByPlaceholder(/forgot to clock out/i).fill("Employee forgot to clock out");
    await dialog.getByRole("button", { name: /save changes/i }).click();
    await expect(toast(page, /times updated|updated|saved/i)).toBeVisible();

    const entry = await seededEntry();
    expect(entry.totalWorkMin).toBe(570); // 9:00 to 18:30, no breaks
    expect(entry.editReason).toBe("Employee forgot to clock out");
    expect(entry.lastEditedById).not.toBeNull();
  });
});
