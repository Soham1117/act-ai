import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { test, expect, type Page } from "@playwright/test";
import { db } from "./support/db";
import { ct, PT, sessionFor } from "./support/payroll-time";
import { ADMIN_STATE, JOB_CODE } from "./support/test-data";

test.use({ storageState: ADMIN_STATE });

async function fixture() {
  const key = randomUUID();
  const date = new Date("2024-08-05T00:00:00Z");
  const employee = await db.employee.create({ data: {
    employeeId: `L3-${key}`, name: `Aleksandra Wiśniewska-Kowalczyk 李 ${key.slice(0, 8)}`,
    gender: "OTHER", compensationType: "HOURLY_RATE",
    user: { create: { name: "Watch L3 fixture", username: `watch-l3-${key}`, role: "EMPLOYEE" } },
  } });
  const entry = await db.timeEntry.create({ data: {
    employeeId: employee.id, date, clockIn: ct("2024-08-05", "08:00"),
    jobCode: JOB_CODE.code, status: "ACTIVE", source: "KIOSK", approvalStatus: "PENDING",
    breaks: { create: { startTime: ct("2024-08-05", "12:00"), endTime: ct("2024-08-05", "12:30"), durationMin: 30, type: "BREAK" } },
  } });
  await db.schedule.create({ data: { employeeId: employee.id, date, startTime: "08:00", endTime: "17:00", jobCode: JOB_CODE.code } });
  const finding = await db.watchFinding.create({ data: {
    ruleId: "time.missing-clock-out", fingerprint: `time.missing-clock-out:${entry.id}`,
    subjectType: "TimeEntry", subjectId: entry.id, employeeId: employee.id,
    title: `${employee.name} has no clock-out`, detail: "Recorded clock-in without a clock-out.", severity: "WARN", evidence: {},
  } });
  return { employee, entry, finding, async cleanup() {
    await db.watchProposal.deleteMany({ where: { entryId: entry.id } });
    await db.watchFinding.delete({ where: { id: finding.id } });
    await db.employee.delete({ where: { id: employee.id } });
    await db.user.delete({ where: { id: employee.userId } });
  } };
}

async function draft(page: Page, name: string) {
  await page.goto("/admin/watch");
  await page.getByLabel("Search flags").fill(name);
  await page.getByRole("button", { name: `${name} has no clock-out`, exact: true }).click();
  await page.getByRole("button", { name: "Draft clock-out correction", exact: true }).click();
  await page.getByLabel("Reason for correction").fill("Supervisor confirmed the missed clock-out; review the scheduled end.");
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/watch\/proposals$/);
  return page.getByRole("article", { name: `Correction for ${name}`, exact: true });
}

test("drafts change no punches; confirmed concurrent approvals apply once and safe undo restores the entry", async ({ page, context }, testInfo) => {
  const f = await fixture();
  try {
    const row = await draft(page, f.employee.name);
    expect((await db.timeEntry.findUniqueOrThrow({ where: { id: f.entry.id } })).clockOut).toBeNull();
    await expect(row.getByRole("button", { name: "Approve correction", exact: true })).toBeDisabled();
    await expect(row).toContainText("8h 30m");
    await expect(row).toContainText("0h 30m");
    await row.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("watch-draft.png"), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    const second = await context.newPage();
    await second.goto("/admin/watch/proposals");
    const other = second.getByRole("article", { name: `Correction for ${f.employee.name}`, exact: true });
    await row.getByRole("checkbox").check();
    await other.getByRole("checkbox").check();
    await Promise.all([row.getByRole("button", { name: "Approve correction", exact: true }).click(), other.getByRole("button", { name: "Approve correction", exact: true }).click()]);
    await expect.poll(async () => (await db.watchProposal.findFirstOrThrow({ where: { entryId: f.entry.id } })).status).toBe("APPLIED");
    const applied = await db.timeEntry.findUniqueOrThrow({ where: { id: f.entry.id } });
    expect(applied.clockOut).toEqual(ct("2024-08-05", "17:00"));
    expect(applied.totalWorkMin).toBe(510);
    expect(applied.approvalStatus).toBe("PENDING");
    const proposal = await db.watchProposal.findFirstOrThrow({ where: { entryId: f.entry.id } });
    expect(await db.auditLog.count({ where: { action: "watch.proposal.apply", resource: `WatchProposal:${proposal.id}` } })).toBe(1);
    await second.close();
    await page.getByRole("button", { name: /^History/ }).click();
    await row.getByRole("button", { name: "Undo correction", exact: true }).click();
    await expect.poll(async () => (await db.watchProposal.findUniqueOrThrow({ where: { id: proposal.id } })).status).toBe("UNDONE");
    const restored = await db.timeEntry.findUniqueOrThrow({ where: { id: f.entry.id }, include: { breaks: true } });
    expect(restored.clockOut).toBeNull();
    expect(restored.status).toBe("ACTIVE");
    expect(restored.breaks[0]!.durationMin).toBe(30);
  } finally { await f.cleanup(); }
});

test("a stale draft stays actionable and rejecting it changes no hours", async ({ page }) => {
  const f = await fixture();
  try {
    const row = await draft(page, f.employee.name);
    await db.timeEntry.update({ where: { id: f.entry.id }, data: { timesheetNotes: "New information after the draft" } });
    await row.getByRole("checkbox").check();
    await row.getByRole("button", { name: "Approve correction", exact: true }).click();
    await expect(row.getByRole("alert")).toContainText("changed");
    expect((await db.timeEntry.findUniqueOrThrow({ where: { id: f.entry.id } })).clockOut).toBeNull();
    await row.getByRole("button", { name: "Reject draft", exact: true }).click();
    await expect.poll(async () => (await db.watchProposal.findFirstOrThrow({ where: { entryId: f.entry.id } })).status).toBe("REJECTED");
    expect((await db.timeEntry.findUniqueOrThrow({ where: { id: f.entry.id } })).clockOut).toBeNull();
  } finally { await f.cleanup(); }
});

test("employees cannot list correction proposals", async ({ browser }) => {
  const context = await sessionFor(browser, "watch-proposal-employee", PT.ella.email);
  try {
    const page = await context.newPage();
    await page.goto("/admin/watch/proposals");
    await expect(page).toHaveURL(/\/unauthorized|\/dashboard/);
    await expect(page.getByRole("button", { name: "Approve correction", exact: true })).toHaveCount(0);
  } finally { await context.close(); }
});

test("scheduled drafts are attributed to Watch, change no punches, and are not recreated after rejection", async ({ page }) => {
  const f = await fixture();
  const oldPolicy = await db.watchRuleConfig.findUnique({ where: { ruleId: "policy" } });
  // This isolated test database must never send a real digest.
  const params = { ...(oldPolicy?.params as Record<string, unknown> ?? {}), digestRecipientEmails: [] };
  await db.watchRuleConfig.upsert({ where: { ruleId: "policy" }, create: { ruleId: "policy", params }, update: { params } });
  async function scheduledCheck() {
    const response = await page.request.post("/api/internal/watch/run", { headers: { authorization: `Bearer ${process.env.WATCH_CRON_TOKEN}` } });
    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result.skipped).toBeUndefined();
    expect(result.errors.filter((e: { ruleId: string }) => e.ruleId === "proposal.missing-clock-out")).toEqual([]);
  }
  try {
    await scheduledCheck();
    const proposal = await db.watchProposal.findFirstOrThrow({ where: { entryId: f.entry.id } });
    expect(proposal.createdById).toBeNull();
    expect(proposal.status).toBe("PENDING");
    expect((await db.timeEntry.findUniqueOrThrow({ where: { id: f.entry.id } })).clockOut).toBeNull();
    expect(await db.auditLog.findFirst({ where: { resource: `WatchProposal:${proposal.id}`, action: "watch.proposal.create" } })).toMatchObject({ actorId: null, actorEmail: "system:watch" });
    await scheduledCheck();
    expect(await db.watchProposal.count({ where: { entryId: f.entry.id } })).toBe(1);
    await page.goto("/admin/watch/proposals");
    const row = page.getByRole("article", { name: `Correction for ${f.employee.name}`, exact: true });
    await expect(row).toContainText("Automatically drafted");
    await expect(row.getByRole("button", { name: "Approve correction", exact: true })).toBeDisabled();
    await row.getByRole("button", { name: "Reject draft", exact: true }).click();
    await expect.poll(async () => (await db.watchProposal.findUniqueOrThrow({ where: { id: proposal.id } })).status).toBe("REJECTED");
    await scheduledCheck();
    expect(await db.watchProposal.count({ where: { entryId: f.entry.id } })).toBe(1);
    expect((await db.timeEntry.findUniqueOrThrow({ where: { id: f.entry.id } })).clockOut).toBeNull();
  } finally {
    await f.cleanup();
    if (oldPolicy) await db.watchRuleConfig.update({ where: { ruleId: "policy" }, data: { params: oldPolicy.params ?? Prisma.DbNull } });
    else await db.watchRuleConfig.delete({ where: { ruleId: "policy" } });
  }
});
