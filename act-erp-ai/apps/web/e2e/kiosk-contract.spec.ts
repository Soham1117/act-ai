import { test, expect, type Page } from "@playwright/test";
import { db } from "./support/db";
import { expectNoCrash, failServerActions, openKiosk, toast } from "./support/helpers";
import { CONTRACT_WORKER, JOB_CODE, KIOSK_CREW_SLUG } from "./support/test-data";

async function openCrew(browser: import("@playwright/test").Browser) {
  const page = await openKiosk(browser, KIOSK_CREW_SLUG, { cookieSuffix: "-crew" });
  await page.getByRole("button", { name: /contract crew/i }).click();
  await expect(page.getByText(/agency staff/i).first()).toBeVisible();
  return page;
}

const pickWorker = (page: Page, name = CONTRACT_WORKER.name) =>
  page.getByRole("button", { name: new RegExp(name) }).first().click();

const entries = () =>
  db.contractTimeEntry.findMany({
    where: { contractWorker: { workerId: CONTRACT_WORKER.workerId } },
  });

test.describe("kiosk: contract crew clock in/out", () => {
  test("worker clocks in and out with no break buttons; photos are sent", async ({ browser }) => {
    const page = await openCrew(browser);

    // Clock in
    await pickWorker(page);
    await expect(page.locator("video")).toBeVisible();
    await expect(page.getByRole("button", { name: /break|lunch/i })).toHaveCount(0);
    const photoRequest = page.waitForRequest(
      (r) => r.method() === "POST" && (r.postData() ?? "").includes("data:image/jpeg"),
      { timeout: 20_000 },
    );
    await page.getByRole("button", { name: /^clock in$/i }).click();
    await photoRequest;
    await expect(toast(page, /clocked in at/i)).toBeVisible();
    const [open] = await entries();
    expect(open?.status).toBe("ACTIVE");
    expect(open?.jobCode).toBe(JOB_CODE.code);

    // Clock out (still no break buttons while on shift)
    await pickWorker(page);
    await expect(page.getByRole("button", { name: /break|lunch/i })).toHaveCount(0);
    await page.getByRole("button", { name: /^clock out$/i }).click();
    await expect(toast(page, /clocked out at/i)).toBeVisible();
    const [done] = await entries();
    expect(done?.clockOut).not.toBeNull();
    expect(done?.status).not.toBe("ACTIVE");
    await page.context().close();
  });

  test("searching for someone who is not on the list says so", async ({ browser }) => {
    const page = await openCrew(browser);
    await page.getByPlaceholder(/search by name or cw id/i).fill("zzz-nobody");
    await expect(page.getByText(/no contract workers match that search/i)).toBeVisible();
    await page.context().close();
  });

  test("network failure while punching shows an error and records nothing", async ({
    browser,
  }) => {
    const page = await openCrew(browser);
    const before = (await entries()).length;
    await pickWorker(page);
    await failServerActions(page, "abort");
    await page.getByRole("button", { name: /^clock (in|out)$/i }).click();
    await expect(page.getByText(/something went wrong|try again/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect((await entries()).length).toBe(before);
    await page.context().close();
  });
});
