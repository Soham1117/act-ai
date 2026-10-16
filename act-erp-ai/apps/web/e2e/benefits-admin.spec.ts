import { test, expect, type Locator, type Page } from "@playwright/test";
import { db } from "./support/db";
import { delayServerActions, expectNoCrash, failServerActions, toast } from "./support/helpers";
import { ADMIN_STATE } from "./support/test-data";
import { SS, answerNextDialog, dateOnly, empDbId, labelled, loginState, pick, ymdFromToday } from "./support/self-service";

// Benefits, admin side: plan catalog (/admin/benefits) and per-employee enrolment (employee page). Employee: Bea.
test.use({ storageState: ADMIN_STATE });

let beaId: string;

async function clean() {
  await db.benefitEnrollment.deleteMany({ where: { employeeId: beaId } });
  await db.retirementElection.deleteMany({ where: { employeeId: beaId } });
  await db.notificationRecipient.deleteMany({ where: { employeeId: beaId } });
  await db.benefitPlan.deleteMany({ where: { name: { startsWith: "AdmPlan" }, rolledFromId: { not: null } } });
  await db.benefitPlan.deleteMany({ where: { name: { startsWith: "AdmPlan" } } });
  await db.employee.update({ where: { id: beaId }, data: { ssnLast4: null } });
}
test.beforeAll(async () => {
  beaId = await empDbId(SS.bea);
});
test.beforeEach(clean);
test.afterAll(async () => {
  await clean();
  // markAllVerifiedToday is global: put Ben's seeded confirmation dates back.
  const stamp = dateOnly(ymdFromToday(-10));
  const ben = await empDbId(SS.ben);
  await db.benefitEnrollment.updateMany({ where: { employeeId: ben, endDate: null }, data: { confirmedAsOf: stamp } });
  await db.retirementElection.updateMany({ where: { employeeId: ben, endDate: null }, data: { confirmedAsOf: stamp } });
});

type Tier = "EMPLOYEE_ONLY" | "FAMILY";
async function plan(
  name: string,
  type: "MEDICAL" | "DENTAL" | "VISION" | "RETIREMENT_401K" | "LIFE" = "MEDICAL",
  opts: { tiers?: Tier[]; start?: string; end?: string; active?: boolean } = {},
) {
  return db.benefitPlan.create({
    data: {
      type,
      name,
      carrierName: "Adm Carrier",
      planYearStart: dateOnly(opts.start ?? "2020-01-01"),
      planYearEnd: dateOnly(opts.end ?? "2099-12-31"),
      costPeriod: "PER_PAYCHECK",
      isActive: opts.active ?? true,
      tiers:
        type === "RETIREMENT_401K"
          ? undefined
          : { create: (opts.tiers ?? ["EMPLOYEE_ONLY", "FAMILY"]).map((t) => ({ tier: t, employeeCost: t === "FAMILY" ? 80 : 30, employerCost: t === "FAMILY" ? 200 : 100 })) },
    },
  });
}
async function enrollment(planId: string, over: { status?: "PENDING" | "ENROLLED" | "WAIVED"; tier?: Tier; effective?: string; end?: string } = {}) {
  return db.benefitEnrollment.create({
    data: {
      employeeId: beaId,
      planId,
      tier: over.status === "WAIVED" ? null : (over.tier ?? "EMPLOYEE_ONLY"),
      status: over.status ?? "ENROLLED",
      effectiveDate: dateOnly(over.effective ?? ymdFromToday(-5)),
      endDate: over.end ? dateOnly(over.end) : null,
      confirmedAsOf: dateOnly(ymdFromToday(-5)),
    },
  });
}
const notice = (title: string) => db.notification.findFirstOrThrow({ where: { title, recipients: { some: { employeeId: beaId } } } });

// ── Catalog ──────────────────────────────────────────────────────────────

const cardOf = (page: Page, name: string, hasButton: string): Locator =>
  page.locator("div.rounded-lg, div.rounded-xl").filter({ hasText: name }).filter({ has: page.getByRole("button", { name: hasButton }) }).last();
const tierRow = (d: Locator, label: string) => d.locator("div").filter({ hasText: new RegExp(`^${label}$`) }).last();

async function newPlan(page: Page) {
  await page.goto("/admin/benefits");
  await page.getByRole("button", { name: "New plan" }).click();
  return page.getByRole("dialog", { name: "New plan" });
}
async function fillPlan(d: Locator, name = "AdmPlan New", start = "2026-01-01", end = "2026-12-31") {
  await labelled(d, "Plan name").fill(name);
  await labelled(d, "Carrier").fill("Adm Carrier");
  await labelled(d, "Plan year start").fill(start);
  await labelled(d, "Plan year end").fill(end);
}

test.describe("admin benefits: plan catalog", () => {
  test("creates a plan with tier prices: row, tiers, audit and card", async ({ page }) => {
    const d = await newPlan(page);
    await fillPlan(d);
    await labelled(d, "Group number").fill("G-77");
    await tierRow(d, "Employee only").getByPlaceholder("Employee").fill("40");
    await tierRow(d, "Employee only").getByPlaceholder("Employer").fill("210.5");
    await tierRow(d, "Family").getByPlaceholder("Employee").fill("120");
    await tierRow(d, "Family").getByPlaceholder("Employer").fill("400");
    await d.getByRole("button", { name: "Create plan" }).click();
    await expect(toast(page, "Plan created")).toBeVisible();
    const p = await db.benefitPlan.findFirstOrThrow({ where: { name: "AdmPlan New" }, include: { tiers: true } });
    expect(p).toMatchObject({ type: "MEDICAL", carrierName: "Adm Carrier", groupNumber: "G-77", isActive: true });
    expect(p.tiers.map((t) => [t.tier, Number(t.employeeCost), Number(t.employerCost)]).sort()).toEqual([
      ["EMPLOYEE_ONLY", 40, 210.5],
      ["FAMILY", 120, 400],
    ]);
    expect(await db.auditLog.count({ where: { action: "benefits.create_plan", resource: `BenefitPlan:${p.id}` } })).toBe(1);
    await expect(page.getByText("$40.00 employee · $210.50 employer")).toBeVisible();
  });

  test("a 401(k) plan has match and vesting text instead of tiers", async ({ page }) => {
    const d = await newPlan(page);
    await fillPlan(d, "AdmPlan 401k");
    await labelled(d, "Type").click();
    await page.getByRole("option", { name: "RETIREMENT 401K" }).click();
    await expect(d.getByText("Tier pricing")).toHaveCount(0);
    await labelled(d, /Employer match/).fill("50% of 6%");
    await d.getByRole("button", { name: "Create plan" }).click();
    await expect(toast(page, "Plan created")).toBeVisible();
    const p = await db.benefitPlan.findFirstOrThrow({ where: { name: "AdmPlan 401k" }, include: { tiers: true } });
    expect(p.matchDescription).toBe("50% of 6%");
    expect(p.tiers).toHaveLength(0);
  });

  test("form checks: half-priced tier, end before start, one-letter name, bad portal URL", async ({ page }) => {
    const d = await newPlan(page);
    await fillPlan(d);
    await tierRow(d, "Family").getByPlaceholder("Employee").fill("120");
    await d.getByRole("button", { name: "Create plan" }).click();
    await expect(toast(page, "Enter both employee and employer prices for Family, or clear both to remove the tier.")).toBeVisible();
    await tierRow(d, "Family").getByPlaceholder("Employee").fill("");
    await labelled(d, "Plan year end").fill("2025-12-31");
    await d.getByRole("button", { name: "Create plan" }).click();
    await expect(toast(page, "The plan year must end after it starts.")).toBeVisible();
    await labelled(d, "Plan year end").fill("2026-12-31");
    await labelled(d, "Plan name").fill("A");
    await d.getByRole("button", { name: "Create plan" }).click();
    await expect(toast(page, /Check name/)).toBeVisible();
    await labelled(d, "Plan name").fill("AdmPlan Bad URL");
    await labelled(d, "Carrier portal URL").fill("not a url");
    await d.getByRole("button", { name: "Create plan" }).click();
    await expect(toast(page, /Check carrierPortalUrl/)).toBeVisible();
    expect(await db.benefitPlan.count({ where: { name: { startsWith: "AdmPlan" } } })).toBe(0);
  });

  test("editing a plan changes its name and removes an unused tier; the type cannot change", async ({ page }) => {
    const p = await plan("AdmPlan Edit");
    await page.goto("/admin/benefits");
    await cardOf(page, "AdmPlan Edit", "Edit").getByRole("button", { name: "Edit" }).click();
    const d = page.getByRole("dialog", { name: "Edit plan" });
    await expect(labelled(d, "Type")).toBeDisabled();
    await labelled(d, "Plan name").fill("AdmPlan Edited");
    await tierRow(d, "Family").getByPlaceholder("Employee").fill("");
    await tierRow(d, "Family").getByPlaceholder("Employer").fill("");
    await d.getByRole("button", { name: "Save" }).click();
    await expect(toast(page, "Plan updated")).toBeVisible();
    const after = await db.benefitPlan.findUniqueOrThrow({ where: { id: p.id }, include: { tiers: true } });
    expect(after.name).toBe("AdmPlan Edited");
    expect(after.tiers.map((t) => t.tier)).toEqual(["EMPLOYEE_ONLY"]);
    expect(await db.auditLog.count({ where: { action: "benefits.update_plan", resource: `BenefitPlan:${p.id}` } })).toBe(1);
  });

  test("a tier that employees are enrolled in cannot be removed", async ({ page }) => {
    const p = await plan("AdmPlan InUse");
    await enrollment(p.id, { tier: "FAMILY" });
    await page.goto("/admin/benefits");
    await cardOf(page, "AdmPlan InUse", "Edit").getByRole("button", { name: "Edit" }).click();
    const d = page.getByRole("dialog", { name: "Edit plan" });
    await tierRow(d, "Family").getByPlaceholder("Employee").fill("");
    await tierRow(d, "Family").getByPlaceholder("Employer").fill("");
    await d.getByRole("button", { name: "Save" }).click();
    await expect(toast(page, /Can't remove a tier that employees are enrolled in: Family \(1\)/)).toBeVisible();
    expect(await db.benefitPlanTier.count({ where: { planId: p.id } })).toBe(2);
  });

  test("deactivating a plan keeps history and takes it out of the enrolment picker", async ({ page }) => {
    const p = await plan("AdmPlan Retire Me", "VISION");
    await page.goto("/admin/benefits");
    answerNextDialog(page);
    await cardOf(page, "AdmPlan Retire Me", "Deactivate").getByRole("button", { name: "Deactivate" }).click();
    await expect(toast(page, "Plan deactivated")).toBeVisible();
    expect((await db.benefitPlan.findUniqueOrThrow({ where: { id: p.id } })).isActive).toBe(false);
    await expect(page.getByText("Inactive").first()).toBeVisible();
    expect(await db.auditLog.count({ where: { action: "benefits.deactivate_plan", resource: `BenefitPlan:${p.id}` } })).toBe(1);
    await page.goto(`/admin/employees/${beaId}`);
    await page.getByRole("tab", { name: "Benefits" }).click();
    await page.getByRole("button", { name: "Enroll" }).click();
    await labelled(page.getByRole("dialog", { name: "New enrollment" }), "Plan").click();
    await expect(page.getByRole("option", { name: /AdmPlan Retire Me/ })).toHaveCount(0);
  });

  test("rolling a plan forward creates next year's plan and moves open enrolments onto it", async ({ page }) => {
    const oldEnd = ymdFromToday(30);
    const p = await plan("AdmPlan Roll", "DENTAL", { end: oldEnd });
    const old = await enrollment(p.id, { tier: "FAMILY" });
    await page.goto("/admin/benefits");
    await cardOf(page, "AdmPlan Roll", "Roll forward").getByRole("button", { name: "Roll forward" }).click();
    const d = page.getByRole("dialog", { name: /Roll forward AdmPlan Roll/ });
    await expect(labelled(d, "New plan year start")).toHaveValue(oldEnd);
    await labelled(d, "New plan year end").fill(ymdFromToday(400));
    await d.getByRole("button", { name: "Roll forward" }).click();
    await expect(toast(page, "Rolled forward — 1 enrollment(s) mirrored to the new plan year")).toBeVisible();

    const next = await db.benefitPlan.findFirstOrThrow({ where: { rolledFromId: p.id }, include: { tiers: true } });
    expect(next.name).toBe("AdmPlan Roll");
    expect(next.tiers.map((t) => t.tier).sort()).toEqual(["EMPLOYEE_ONLY", "FAMILY"]); // prices copied
    expect((await db.benefitPlan.findUniqueOrThrow({ where: { id: p.id } })).isActive).toBe(false);
    expect((await db.benefitEnrollment.findUniqueOrThrow({ where: { id: old.id } })).endDate?.toISOString().slice(0, 10)).toBe(oldEnd);
    const moved = await db.benefitEnrollment.findFirstOrThrow({ where: { planId: next.id, employeeId: beaId } });
    expect(moved).toMatchObject({ tier: "FAMILY", status: "ENROLLED", endDate: null });
    expect(moved.effectiveDate.toISOString().slice(0, 10)).toBe(oldEnd);
    await notice("Benefits renewed");
    expect(await db.auditLog.count({ where: { action: "benefits.roll_forward_plan_year", resource: `BenefitPlan:${next.id}` } })).toBe(1);
    await expect(cardOf(page, "AdmPlan Roll", "Roll forward")).toHaveCount(1); // only the new year's plan can be rolled again
  });

  test("roll forward refuses a start before the current year ends, a bad range, and a second roll", async ({ page }) => {
    const oldEnd = ymdFromToday(30);
    const p = await plan("AdmPlan Roll2", "VISION", { end: oldEnd });
    await page.goto("/admin/benefits");
    await cardOf(page, "AdmPlan Roll2", "Roll forward").getByRole("button", { name: "Roll forward" }).click();
    const d = page.getByRole("dialog", { name: /Roll forward AdmPlan Roll2/ });
    await labelled(d, "New plan year end").fill(ymdFromToday(10));
    await d.getByRole("button", { name: "Roll forward" }).click();
    await expect(toast(page, "The new plan year must end after it starts.")).toBeVisible();
    await labelled(d, "New plan year start").fill(ymdFromToday(10));
    await labelled(d, "New plan year end").fill(ymdFromToday(300));
    await d.getByRole("button", { name: "Roll forward" }).click();
    await expect(toast(page, `The new plan year can't start before the current one ends (${oldEnd}).`)).toBeVisible();
    // Somebody else rolls it first (page is stale): second attempt is refused.
    await db.benefitPlan.create({
      data: { type: "VISION", name: "AdmPlan Roll2 next", carrierName: "x", planYearStart: dateOnly(oldEnd), planYearEnd: dateOnly(ymdFromToday(400)), rolledFromId: p.id },
    });
    await labelled(d, "New plan year start").fill(oldEnd);
    await labelled(d, "New plan year end").fill(ymdFromToday(400));
    await d.getByRole("button", { name: "Roll forward" }).click();
    await expect(toast(page, /This plan was already rolled forward/)).toBeVisible();
    expect(await db.benefitPlan.count({ where: { rolledFromId: p.id } })).toBe(1);
  });

  test("Mark all verified today stamps every open enrolment", async ({ page }) => {
    const p = await plan("AdmPlan Verify");
    const e = await enrollment(p.id);
    await db.benefitEnrollment.update({ where: { id: e.id }, data: { confirmedAsOf: dateOnly(ymdFromToday(-200)) } });
    await page.goto("/admin/benefits");
    answerNextDialog(page);
    await page.getByRole("button", { name: "Mark all verified today" }).click();
    await expect(toast(page, /Marked verified: \d+ enrollment\(s\), \d+ election\(s\)/)).toBeVisible();
    expect((await db.benefitEnrollment.findUniqueOrThrow({ where: { id: e.id } })).confirmedAsOf.toISOString().slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
    expect(await db.auditLog.count({ where: { action: "benefits.mark_all_verified" } })).toBeGreaterThan(0);
  });

  test("an employee cannot open the admin benefits page", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: await loginState(browser, SS.bea, "bea") });
    const p = await ctx.newPage();
    await p.goto("/admin/benefits");
    await expect(p).not.toHaveURL(/\/admin\/benefits/);
    await ctx.close();
  });
});

// ── Per-employee enrolment ───────────────────────────────────────────────

async function openBenefits(page: Page) {
  await page.goto(`/admin/employees/${beaId}`);
  await page.getByRole("tab", { name: "Benefits" }).click();
}
async function openEnroll(page: Page) {
  await openBenefits(page);
  await page.getByRole("button", { name: "Enroll" }).click();
  return page.getByRole("dialog", { name: "New enrollment" });
}
async function fillEnroll(page: Page, d: Locator, o: { plan: RegExp; status?: string; tier?: string; effective?: string; member?: string }) {
  await pick(page, d, "Plan", o.plan);
  if (o.status) await pick(page, d, "Status", o.status);
  if (o.tier) await pick(page, d, "Tier", o.tier);
  await labelled(d, "Effective date").fill(o.effective ?? ymdFromToday(-5));
  if (o.member) await labelled(d, "Member ID").fill(o.member);
}
const saveEnroll = (d: Locator) => d.getByRole("button", { name: "Save" });
const rowOf = (page: Page, text: string) => page.getByRole("listitem").filter({ hasText: text });

test.describe("admin benefits: enrolling an employee", () => {
  test("enrols in a plan: row, notification, audit and employee-page badge", async ({ page }) => {
    const p = await plan("AdmPlan Med");
    const d = await openEnroll(page);
    await fillEnroll(page, d, { plan: /AdmPlan Med/, tier: "Family", member: "MBR-BEA-9" });
    await saveEnroll(d).click();
    await expect(toast(page, "Enrollment saved")).toBeVisible();
    const e = await db.benefitEnrollment.findFirstOrThrow({ where: { employeeId: beaId } });
    expect(e).toMatchObject({ planId: p.id, tier: "FAMILY", status: "ENROLLED", memberId: "MBR-BEA-9", endDate: null });
    expect(await db.auditLog.count({ where: { action: "benefits.create_enrollment", resource: `BenefitEnrollment:${e.id}` } })).toBe(1);
    expect((await notice("Benefits updated")).message).toBe("Your AdmPlan Med enrollment was entered (enrolled).");
    await expect(rowOf(page, "AdmPlan Med")).toContainText("current");
    await expect(rowOf(page, "AdmPlan Med")).toContainText("MBR-BEA-9");
  });

  test("a pending enrolment is confirmed with one click; the employee is told", async ({ page }) => {
    await plan("AdmPlan Pend");
    const d = await openEnroll(page);
    await fillEnroll(page, d, { plan: /AdmPlan Pend/, status: "PENDING", tier: "Employee only" });
    await saveEnroll(d).click();
    await expect(toast(page, "Enrollment saved")).toBeVisible();
    expect((await notice("Benefits updated")).message).toContain("pending confirmation");
    await rowOf(page, "AdmPlan Pend").getByRole("button", { name: "Confirm enrollment" }).click();
    await expect(toast(page, "Confirmed")).toBeVisible();
    expect((await db.benefitEnrollment.findFirstOrThrow({ where: { employeeId: beaId } })).status).toBe("ENROLLED");
    await notice("Enrollment confirmed");
  });

  test("waiving a benefit stores no tier", async ({ page }) => {
    await plan("AdmPlan Waive");
    const d = await openEnroll(page);
    await pick(page, d, "Plan", /AdmPlan Waive/);
    await pick(page, d, "Status", "WAIVED");
    await expect(d.getByText("Tier", { exact: true })).toHaveCount(0);
    await labelled(d, "Effective date").fill(ymdFromToday(-5));
    await saveEnroll(d).click();
    await expect(toast(page, "Enrollment saved")).toBeVisible();
    expect(await db.benefitEnrollment.findFirstOrThrow({ where: { employeeId: beaId } })).toMatchObject({ status: "WAIVED", tier: null });
    expect((await notice("Benefits updated")).message).toBe("Your waiver of AdmPlan Waive was recorded.");
    await expect(rowOf(page, "AdmPlan Waive")).toContainText("waived");
  });

  test("a second open row of the same benefit type is refused", async ({ page }) => {
    const p = await plan("AdmPlan Dup");
    await enrollment(p.id);
    const d = await openEnroll(page);
    await fillEnroll(page, d, { plan: /AdmPlan Dup/, tier: "Employee only" });
    await saveEnroll(d).click();
    await expect(toast(page, /This employee already has a medical row covering an overlapping date range/)).toBeVisible();
    expect(await db.benefitEnrollment.count({ where: { employeeId: beaId } })).toBe(1);
  });

  test("a tier the plan has no price for is refused", async ({ page }) => {
    await plan("AdmPlan OneTier", "DENTAL", { tiers: ["EMPLOYEE_ONLY"] });
    const d = await openEnroll(page);
    await fillEnroll(page, d, { plan: /AdmPlan OneTier/, tier: "Family" });
    await saveEnroll(d).click();
    await expect(toast(page, "AdmPlan OneTier has no price for the Family tier. Add it to the plan first.")).toBeVisible();
    expect(await db.benefitEnrollment.count({ where: { employeeId: beaId } })).toBe(0);
  });

  test("a member ID that looks like a Social Security number is refused (sharper message when it matches the SSN on file)", async ({ page }) => {
    await plan("AdmPlan Ssn");
    await db.employee.update({ where: { id: beaId }, data: { ssnLast4: "1234" } });
    const d = await openEnroll(page);
    await fillEnroll(page, d, { plan: /AdmPlan Ssn/, tier: "Employee only", member: "987651234" });
    await saveEnroll(d).click();
    await expect(toast(page, /whose last 4 digits match this employee's SSN on file/)).toBeVisible();
    await labelled(d, "Member ID").fill("987650000");
    await saveEnroll(d).click();
    await expect(toast(page, /looks like a Social Security Number rather than a carrier member ID/)).toBeVisible();
    expect(await db.benefitEnrollment.count({ where: { employeeId: beaId } })).toBe(0);
  });

  test("Save is disabled without an effective date", async ({ page }) => {
    await plan("AdmPlan NoDate");
    const d = await openEnroll(page);
    await expect(saveEnroll(d)).toBeDisabled();
  });

  test("changes tier: old row ends on the new date, a new row starts; same or earlier date is refused", async ({ page }) => {
    const p = await plan("AdmPlan Tier");
    const old = await enrollment(p.id, { tier: "EMPLOYEE_ONLY" });
    await openBenefits(page);
    await rowOf(page, "AdmPlan Tier").getByRole("button", { name: "Change tier" }).click();
    const d = page.getByRole("dialog", { name: /Change tier — AdmPlan Tier/ });
    await pick(page, d, "New tier", "Family");
    await labelled(d, "Effective date").fill(ymdFromToday(-5)); // same day as the current row
    await d.getByRole("button", { name: "Change tier" }).click();
    await expect(toast(page, "The new tier's effective date must be after the current enrollment's effective date. Pick a later date and try again.")).toBeVisible();
    await labelled(d, "Effective date").fill(ymdFromToday(10));
    await d.getByRole("button", { name: "Change tier" }).click();
    await expect(toast(page, "Tier changed — old row ended, new row created")).toBeVisible();
    const rows = await db.benefitEnrollment.findMany({ where: { employeeId: beaId }, orderBy: { effectiveDate: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.id).toBe(old.id);
    expect(rows[0]!.endDate?.toISOString().slice(0, 10)).toBe(ymdFromToday(10));
    expect(rows[1]).toMatchObject({ tier: "FAMILY", status: "ENROLLED", endDate: null });
    expect((await notice("Benefits tier changed")).message).toContain("Family");
  });

  test("ends an enrolment; an end date before it started, or a second end, is refused", async ({ page }) => {
    const p = await plan("AdmPlan End");
    const e = await enrollment(p.id);
    await openBenefits(page);
    await rowOf(page, "AdmPlan End").getByRole("button", { name: "End" }).click();
    const d = page.getByRole("dialog", { name: "End enrollment" });
    await labelled(d, "End date").fill(ymdFromToday(-30));
    await d.getByRole("button", { name: "End enrollment" }).click();
    await expect(toast(page, `The end date can't be before the effective date (${ymdFromToday(-5)}).`)).toBeVisible();
    await labelled(d, "End date").fill(ymdFromToday(0));
    await labelled(d, "Notes").fill("Left the company");
    await d.getByRole("button", { name: "End enrollment" }).click();
    await expect(toast(page, "Enrollment ended")).toBeVisible();
    const after = await db.benefitEnrollment.findUniqueOrThrow({ where: { id: e.id } });
    expect(after.endDate?.toISOString().slice(0, 10)).toBe(ymdFromToday(0));
    expect(after.notes).toBe("Left the company");
    await notice("Benefits coverage ending");
    // Stale second end from another tab.
    await db.benefitEnrollment.update({ where: { id: e.id }, data: { endDate: null } });
    await page.reload();
    await page.getByRole("tab", { name: "Benefits" }).click();
    await rowOf(page, "AdmPlan End").getByRole("button", { name: "End" }).click();
    await db.benefitEnrollment.update({ where: { id: e.id }, data: { endDate: dateOnly(ymdFromToday(0)) } });
    await labelled(page.getByRole("dialog", { name: "End enrollment" }), "End date").fill(ymdFromToday(1));
    await page.getByRole("dialog", { name: "End enrollment" }).getByRole("button", { name: "End enrollment" }).click();
    await expect(toast(page, new RegExp(`That enrollment already ended on ${ymdFromToday(0)}`))).toBeVisible();
  });

  test("confirming an enrolment that was already confirmed elsewhere is refused", async ({ page }) => {
    const p = await plan("AdmPlan Conf");
    const e = await enrollment(p.id, { status: "PENDING" });
    await openBenefits(page);
    await db.benefitEnrollment.update({ where: { id: e.id }, data: { status: "ENROLLED" } });
    await rowOf(page, "AdmPlan Conf").getByRole("button", { name: "Confirm enrollment" }).click();
    await expect(toast(page, "Only a pending enrollment can be confirmed. Refresh the page.")).toBeVisible();
  });

  test("an enrolment deleted meanwhile says it no longer exists", async ({ page }) => {
    const p = await plan("AdmPlan Gone");
    const e = await enrollment(p.id, { status: "PENDING" });
    await openBenefits(page);
    await db.benefitEnrollment.delete({ where: { id: e.id } });
    await rowOf(page, "AdmPlan Gone").getByRole("button", { name: "Confirm enrollment" }).click();
    await expect(toast(page, "That enrollment no longer exists. Refresh the page and try again.")).toBeVisible();
  });
});

test.describe("admin benefits: 401(k) elections", () => {
  async function openElection(page: Page) {
    await openBenefits(page);
    await page.getByRole("button", { name: "401(k) election" }).click();
    return page.getByRole("dialog", { name: "New 401(k) election" });
  }
  const save = (d: Locator) => d.getByRole("button", { name: "Save" });

  test("elects a percentage deferral", async ({ page }) => {
    const p = await plan("AdmPlan K1", "RETIREMENT_401K");
    const d = await openElection(page);
    await pick(page, d, "Plan", /AdmPlan K1/);
    await labelled(d, "Effective date").fill(ymdFromToday(-5));
    await labelled(d, "Pre-tax %").fill("6");
    await labelled(d, "Roth %").fill("2");
    await save(d).click();
    await expect(toast(page, "Election saved")).toBeVisible();
    const el = await db.retirementElection.findFirstOrThrow({ where: { employeeId: beaId } });
    expect(el).toMatchObject({ planId: p.id, status: "ENROLLED", flatAmountPerPay: null });
    expect([Number(el.preTaxPercent), Number(el.rothPercent)]).toEqual([6, 2]);
    expect((await notice("Benefits updated")).message).toBe("Your AdmPlan K1 401(k) election was entered.");
    await expect(rowOf(page, "AdmPlan K1")).toContainText("6% pre-tax + 2% Roth");
  });

  test("elects a flat amount per paycheck", async ({ page }) => {
    await plan("AdmPlan K2", "RETIREMENT_401K");
    const d = await openElection(page);
    await pick(page, d, "Plan", /AdmPlan K2/);
    await labelled(d, "Effective date").fill(ymdFromToday(-5));
    await pick(page, d, "Deferral type", "Flat amount per paycheck");
    await labelled(d, "Flat amount per paycheck").fill("75.25");
    await save(d).click();
    await expect(toast(page, "Election saved")).toBeVisible();
    const el = await db.retirementElection.findFirstOrThrow({ where: { employeeId: beaId } });
    expect([Number(el.flatAmountPerPay), el.preTaxPercent, el.rothPercent]).toEqual([75.25, null, null]);
  });

  test("percentages adding up to more than 100 are refused", async ({ page }) => {
    await plan("AdmPlan K3", "RETIREMENT_401K");
    const d = await openElection(page);
    await pick(page, d, "Plan", /AdmPlan K3/);
    await labelled(d, "Effective date").fill(ymdFromToday(-5));
    await labelled(d, "Pre-tax %").fill("80");
    await labelled(d, "Roth %").fill("30");
    await save(d).click();
    await expect(toast(page, /Pre-tax and Roth deferral percentages can't add up to more than 100%/)).toBeVisible();
    expect(await db.retirementElection.count({ where: { employeeId: beaId } })).toBe(0);
  });

  test("a second open election is refused; a pending one can be confirmed and then ended", async ({ page }) => {
    const p = await plan("AdmPlan K4", "RETIREMENT_401K");
    await db.retirementElection.create({
      data: { employeeId: beaId, planId: p.id, status: "PENDING", preTaxPercent: 3, effectiveDate: dateOnly(ymdFromToday(-5)), confirmedAsOf: dateOnly(ymdFromToday(-5)) },
    });
    const d = await openElection(page);
    await pick(page, d, "Plan", /AdmPlan K4/);
    await labelled(d, "Effective date").fill(ymdFromToday(-2));
    await labelled(d, "Pre-tax %").fill("4");
    await save(d).click();
    await expect(toast(page, /This employee already has a retirement 401k row covering an overlapping date range/)).toBeVisible();
    await d.getByRole("button", { name: "Cancel" }).click();

    await rowOf(page, "AdmPlan K4").getByRole("button", { name: "Confirm election" }).click();
    await expect(toast(page, "Confirmed")).toBeVisible();
    expect((await db.retirementElection.findFirstOrThrow({ where: { employeeId: beaId } })).status).toBe("ENROLLED");
    await notice("401(k) election confirmed");

    await rowOf(page, "AdmPlan K4").getByRole("button", { name: "End" }).click();
    const end = page.getByRole("dialog", { name: "End 401(k) election" });
    await labelled(end, "Stop deferral date").fill(ymdFromToday(-30));
    await end.getByRole("button", { name: "End election" }).click();
    await expect(toast(page, `The end date can't be before the effective date (${ymdFromToday(-5)}).`)).toBeVisible();
    await labelled(end, "Stop deferral date").fill(ymdFromToday(0));
    await end.getByRole("button", { name: "End election" }).click();
    await expect(toast(page, "Election ended")).toBeVisible();
    expect((await db.retirementElection.findFirstOrThrow({ where: { employeeId: beaId } })).endDate?.toISOString().slice(0, 10)).toBe(ymdFromToday(0));
    await notice("401(k) election ended");
  });
});

test.describe("admin benefits: failures and double submits", () => {
  test("connection dropped while enrolling: error shown, nothing saved", async ({ page }) => {
    await plan("AdmPlan F1");
    const d = await openEnroll(page);
    await fillEnroll(page, d, { plan: /AdmPlan F1/, tier: "Employee only" });
    await failServerActions(page, "abort");
    await saveEnroll(d).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect(await db.benefitEnrollment.count({ where: { employeeId: beaId } })).toBe(0);
  });

  test("server error (500) while creating a plan: nothing saved", async ({ page }) => {
    const d = await newPlan(page);
    await fillPlan(d, "AdmPlan F2");
    await failServerActions(page, "500");
    await d.getByRole("button", { name: "Create plan" }).click();
    await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
    expect(await db.benefitPlan.count({ where: { name: "AdmPlan F2" } })).toBe(0);
  });

  test("stale deployment while ending an enrolment: nothing changes", async ({ page }) => {
    const p = await plan("AdmPlan F3");
    const e = await enrollment(p.id);
    await openBenefits(page);
    await rowOf(page, "AdmPlan F3").getByRole("button", { name: "End" }).click();
    const d = page.getByRole("dialog", { name: "End enrollment" });
    await labelled(d, "End date").fill(ymdFromToday(0));
    await failServerActions(page, "stale");
    await d.getByRole("button", { name: "End enrollment" }).click();
    await expect(page.getByText(/something went wrong|refresh|newer version/i).first()).toBeVisible();
    await expectNoCrash(page);
    expect((await db.benefitEnrollment.findUniqueOrThrow({ where: { id: e.id } })).endDate).toBeNull();
  });

  test("double click on Save enrols once", async ({ page }) => {
    await plan("AdmPlan F4");
    const d = await openEnroll(page);
    await fillEnroll(page, d, { plan: /AdmPlan F4/, tier: "Employee only" });
    const slow = await delayServerActions(page, 1500);
    await saveEnroll(d).dblclick();
    await expect(toast(page, "Enrollment saved")).toBeVisible();
    expect(slow.count()).toBe(1);
    expect(await db.benefitEnrollment.count({ where: { employeeId: beaId } })).toBe(1);
  });

  test("double click on Roll forward rolls once", async ({ page }) => {
    const oldEnd = ymdFromToday(30);
    const p = await plan("AdmPlan F5", "VISION", { end: oldEnd });
    await page.goto("/admin/benefits");
    await cardOf(page, "AdmPlan F5", "Roll forward").getByRole("button", { name: "Roll forward" }).click();
    const d = page.getByRole("dialog", { name: /Roll forward AdmPlan F5/ });
    await labelled(d, "New plan year end").fill(ymdFromToday(400));
    const slow = await delayServerActions(page, 1500);
    await d.getByRole("button", { name: "Roll forward" }).dblclick();
    await expect(toast(page, /Rolled forward/)).toBeVisible();
    expect(slow.count()).toBe(1);
    expect(await db.benefitPlan.count({ where: { rolledFromId: p.id } })).toBe(1);
  });
});
