import { test, expect, type Page } from "@playwright/test";
import { businessYmd, db } from "./support/db";
import { expectNoCrash, failServerActions, toast } from "./support/helpers";
import {
  ADMIN_STATE,
  CONTRACT_WORKER_APPROVE,
  CONTRACT_WORKER_REJECT,
} from "./support/test-data";

test.use({ storageState: ADMIN_STATE });

async function openHours(page: Page) {
  // Explicit range: the default is the current Mon-Sun week, which may not include "yesterday".
  await page.goto(`/admin/contract-workers?tab=hours&from=${businessYmd(3)}&to=${businessYmd(0)}`);
  await expect(page.getByRole("button", { name: /download csv/i })).toBeVisible();
}

const statusOf = async (workerId: string) =>
  (
    await db.contractTimeEntry.findFirstOrThrow({
      where: { contractWorker: { workerId }, date: { lt: new Date() } },
      orderBy: { date: "desc" },
    })
  ).approvalStatus;

test.describe("admin: contract worker hours", () => {
  test("server failure while approving shows an error and changes nothing", async ({ page }) => {
    await openHours(page);
    await failServerActions(page, "abort");
    await page
      .getByRole("button", { name: `Approve entry for ${CONTRACT_WORKER_APPROVE.name}` })
      .click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect(await statusOf(CONTRACT_WORKER_APPROVE.workerId)).toBe("PENDING");
  });

  test("admin approves a pending entry", async ({ page }) => {
    await openHours(page);
    await page
      .getByRole("button", { name: `Approve entry for ${CONTRACT_WORKER_APPROVE.name}` })
      .click();
    await expect(toast(page, /entry approved/i)).toBeVisible();
    expect(await statusOf(CONTRACT_WORKER_APPROVE.workerId)).toBe("APPROVED");
  });

  test("rejecting needs a reason; with a reason the entry is rejected", async ({ page }) => {
    await openHours(page);
    await page
      .getByRole("button", { name: `Reject entry for ${CONTRACT_WORKER_REJECT.name}` })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: /^reject$/i })).toBeDisabled();
    expect(await statusOf(CONTRACT_WORKER_REJECT.workerId)).toBe("PENDING");

    await dialog.getByLabel(/reason/i).fill("Hours do not match the agency sheet");
    await dialog.getByRole("button", { name: /^reject$/i }).click();
    await expect(toast(page, /entry rejected/i)).toBeVisible();
    expect(await statusOf(CONTRACT_WORKER_REJECT.workerId)).toBe("REJECTED");
    const entry = await db.contractTimeEntry.findFirstOrThrow({
      where: { contractWorker: { workerId: CONTRACT_WORKER_REJECT.workerId } },
    });
    expect(entry.approvalNotes).toContain("agency sheet");
  });
});
