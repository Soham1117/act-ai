import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { db } from "./support/db";
import { openKiosk, toast } from "./support/helpers";
import { makeWorker } from "./support/contract";
import { KIOSK_CREW_SLUG, JOB_CODE } from "./support/test-data";

test("contract crew with a permanent PIN still clocks in and out with private punch photos", async ({browser}) => {
  const worker = await makeWorker({name: `HR attendance ${Date.now()}`});
  await db.contractWorker.update({where: {id: worker.id}, data: {kioskPinHash: await bcrypt.hash("4826", 4)}});
  const page = await openKiosk(browser, KIOSK_CREW_SLUG, {cookieSuffix: "-crew"});
  await page.getByRole("button", {name: /contract crew/i}).click();
  const pick = async () => {
    await page.getByPlaceholder(/search by name or cw id/i).fill(worker.name);
    await page.getByRole("button", {name: new RegExp(worker.name)}).first().click();
    await page.locator('input[type="password"]').fill("4826");
  };
  try {
    await pick();
    await expect(page.getByRole("button", {name: /break|lunch/i})).toHaveCount(0);
    await page.getByRole("button", {name: /^clock in$/i}).click();
    await expect(toast(page, /clocked in/i)).toBeVisible();
    const open = await db.contractTimeEntry.findFirstOrThrow({where: {contractWorkerId: worker.id}});
    expect(open.status).toBe("ACTIVE"); expect(open.jobCode).toBe(JOB_CODE.code);
    await expect.poll(async () => (await db.contractTimeEntry.findUniqueOrThrow({where: {id: open.id}})).clockInPhotoKey).toBeTruthy();
    await pick();
    await page.getByRole("button", {name: /^clock out$/i}).click();
    await expect(toast(page, /clocked out/i)).toBeVisible();
    const closed = await db.contractTimeEntry.findUniqueOrThrow({where: {id: open.id}});
    expect(closed.clockOut).not.toBeNull(); expect(closed.status).not.toBe("ACTIVE");
    expect(closed.clockOutPhotoKey).toBeTruthy();
    expect(await db.contractTimeEntry.count({where: {contractWorkerId: worker.id}})).toBe(1);
  } finally {
    await page.context().close();
    await db.contractTimeEntry.deleteMany({where: {contractWorkerId: worker.id}});
    await db.contractWorker.delete({where: {id: worker.id}});
  }
});
