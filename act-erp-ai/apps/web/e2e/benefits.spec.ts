import { test, expect } from "@playwright/test";
import { db } from "./support/db";
import { ADMIN_STATE, BASE_URL } from "./support/test-data";
import {
  SS,
  SS_OLIVE_DOC_TITLE,
  dateOnly,
  empDbId,
  fmtDate,
  loginState,
  pdfFile,
  putFakeS3,
  statValue,
  ymdFromToday,
} from "./support/self-service";

// Benefits, employee view. Ben has seeded coverage: medical (employee only, $50/paycheck),
// dental ($12.50/month), 401(k) 5% pre-tax + 2% Roth, and an ended vision plan.
test.use({ storageState: "e2e/.auth/ben.json" });

let benId: string;

test.beforeAll(async ({ browser }) => {
  await loginState(browser, SS.ben, "ben");
  benId = await empDbId(SS.ben);
});

async function reset() {
  await db.benefitEnrollment.deleteMany({ where: { employeeId: benId, plan: { name: { startsWith: "Temp " } } } });
  await db.benefitPlan.deleteMany({ where: { name: { startsWith: "Temp " } } });
  await db.document.deleteMany({ where: { employeeId: benId } });
  const stamp = dateOnly(ymdFromToday(-10));
  await db.benefitEnrollment.updateMany({ where: { employeeId: benId, endDate: null }, data: { confirmedAsOf: stamp } });
  await db.retirementElection.updateMany({ where: { employeeId: benId, endDate: null }, data: { confirmedAsOf: stamp } });
}
test.beforeEach(reset);
test.afterAll(reset);

type PlanType = "LIFE" | "HSA" | "FSA" | "DISABILITY_STD" | "DISABILITY_LTD" | "OTHER";
/** A throw-away plan plus Ben's enrolment in it (removed again by reset()). */
async function temp(
  type: PlanType,
  over: { status?: "PENDING" | "ENROLLED" | "WAIVED"; effective?: string; end?: string; planEnd?: string; confirmed?: string; override?: number; tier?: boolean } = {},
) {
  const plan = await db.benefitPlan.create({
    data: {
      type,
      name: `Temp ${type}`,
      carrierName: "Temp Carrier",
      planYearStart: dateOnly("2020-01-01"),
      planYearEnd: dateOnly(over.planEnd ?? "2099-12-31"),
      costPeriod: "PER_PAYCHECK",
      tiers: { create: [{ tier: "EMPLOYEE_ONLY", employeeCost: 7, employerCost: 9 }] },
    },
  });
  await db.benefitEnrollment.create({
    data: {
      employeeId: benId,
      planId: plan.id,
      tier: over.status === "WAIVED" ? null : "EMPLOYEE_ONLY",
      status: over.status ?? "ENROLLED",
      effectiveDate: dateOnly(over.effective ?? ymdFromToday(-30)),
      endDate: over.end ? dateOnly(over.end) : null,
      employeeCostOverride: over.override,
      confirmedAsOf: dateOnly(over.confirmed ?? ymdFromToday(-10)),
    },
  });
}

test("shows the coverage cards, costs with their period, 401(k) and freshness", async ({ page }) => {
  await page.goto("/dashboard/benefits");
  await expect(statValue(page, "Plans enrolled")).toHaveText("2");
  await expect(statValue(page, "Your cost per paycheck")).toHaveText("$50.00");
  await expect(page.getByText("+ $12.50 per month (Dental)")).toBeVisible();
  await expect(statValue(page, "401(k) deferral")).toHaveText("5% pre-tax + 2% Roth");
  await expect(statValue(page, "Confirmed as of")).toHaveText(fmtDate(ymdFromToday(-10)));

  const medical = page.locator("div.rounded-lg, div.rounded-xl").filter({ hasText: "E2E Medical PPO" }).filter({ hasText: "Member ID" }).last();
  await expect(medical).toContainText("Employee only");
  await expect(medical).toContainText("MBR-BEN-001");
  await expect(medical).toContainText("GRP-E2E-1");
  await expect(medical).toContainText("$50.00 per paycheck");
  await expect(medical).toContainText("$300.00 per paycheck");
  await expect(medical.getByRole("link", { name: "800-555-0100" })).toHaveAttribute("href", "tel:800-555-0100");
  await expect(page.getByText("$12.50 per month").first()).toBeVisible();
  await expect(page.getByText("100% of the first 3%")).toBeVisible();
  await expect(page.getByText("Fully vested after 2 years")).toBeVisible();
  await expect(page.getByText("E2E Vision Old — coverage ended")).toBeVisible();
});

test("an enrolment with a cost override shows the override, not the tier price", async ({ page }) => {
  await temp("DISABILITY_LTD", { override: 99 });
  await page.goto("/dashboard/benefits");
  const card = page.locator("div.rounded-lg, div.rounded-xl").filter({ hasText: "Temp DISABILITY_LTD" }).filter({ hasText: "Member ID" }).last();
  await expect(card).toContainText("$99.00 per paycheck");
  await expect(card).toContainText("$9.00 per paycheck");
  await expect(statValue(page, "Your cost per paycheck")).toHaveText("$149.00"); // 50 + 99
});

test("a waived benefit says the employee declined it", async ({ page }) => {
  await temp("LIFE", { status: "WAIVED" });
  await page.goto("/dashboard/benefits");
  await expect(page.getByText(/You declined Temp LIFE coverage for the 2020 plan year/)).toBeVisible();
  await expect(statValue(page, "Plans enrolled")).toHaveText("2");
});

test("coverage that starts in the future is marked, and does not count as enrolled yet", async ({ page }) => {
  const start = ymdFromToday(40);
  await temp("HSA", { effective: start });
  await page.goto("/dashboard/benefits");
  await expect(page.getByText(`Starts ${fmtDate(start)}`)).toBeVisible();
  await expect(statValue(page, "Plans enrolled")).toHaveText("2");
});

test("an enrolment HR has not confirmed yet shows Pending confirmation", async ({ page }) => {
  await temp("FSA", { status: "PENDING" });
  await page.goto("/dashboard/benefits");
  await expect(page.getByText("Pending confirmation")).toBeVisible();
  await expect(statValue(page, "Plans enrolled")).toHaveText("2");
});

test("a plan year that ended with no renewal is not shown as current coverage", async ({ page }) => {
  await temp("DISABILITY_STD", { planEnd: "2021-12-31" });
  await page.goto("/dashboard/benefits");
  await expect(page.getByText(/this plan year has ended/)).toBeVisible();
  await expect(page.getByText(/Renewal information hasn't been entered yet/)).toBeVisible();
});

test("old confirmation dates are flagged for re-verification", async ({ page }) => {
  await temp("OTHER", { confirmed: ymdFromToday(-120) });
  await page.goto("/dashboard/benefits");
  await expect(page.getByText("120d ago — ask HR to re-verify")).toBeVisible();
});

test("ended coverage under the same type moves to Past coverage", async ({ page }) => {
  const plan = await db.benefitPlan.findFirstOrThrow({ where: { name: "E2E Dental Basic" } });
  const old = await db.benefitEnrollment.create({
    data: { employeeId: benId, planId: plan.id, tier: "EMPLOYEE_ONLY", status: "ENROLLED", effectiveDate: dateOnly(ymdFromToday(-400)), endDate: dateOnly(ymdFromToday(-120)), confirmedAsOf: dateOnly(ymdFromToday(-120)) },
  });
  try {
    await page.goto("/dashboard/benefits");
    await expect(page.getByText("Past coverage")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "E2E Dental Basic" }).filter({ hasText: "→" })).toContainText(fmtDate(ymdFromToday(-120)));
  } finally {
    await db.benefitEnrollment.delete({ where: { id: old.id } });
  }
});

test("plan documents: only benefits documents addressed to this employee, and they open", async ({ page, browser }) => {
  const f = pdfFile("booklet.pdf");
  const adminUser = await db.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  const doc = await db.document.create({
    data: { employeeId: benId, title: "Ben Plan Booklet", fileName: `${benId}/booklet.pdf`, fileType: "application/pdf", fileUrl: "x", documentType: "BENEFITS", uploadedById: adminUser.id },
  });
  await db.document.create({
    data: { employeeId: benId, title: "Ben personal note", fileName: `${benId}/n.pdf`, fileType: "application/pdf", fileUrl: "x", documentType: "PERSONAL", uploadedById: adminUser.id },
  });
  await putFakeS3(`documents/${doc.fileName}`, f.buffer, "application/pdf");
  await page.goto("/dashboard/benefits");
  await expect(page.getByText("Ben Plan Booklet")).toBeVisible();
  await expect(page.getByText("Ben personal note")).toHaveCount(0); // not a benefits document
  await expect(page.getByText(SS_OLIVE_DOC_TITLE)).toHaveCount(0);
  const res = await page.request.get(`/api/documents/${doc.id}/file`);
  expect(res.status()).toBe(200);
  expect(Buffer.compare(await res.body(), f.buffer)).toBe(0);
  const admin = await browser.newContext({ storageState: ADMIN_STATE });
  expect((await admin.request.get(`${BASE_URL}/api/documents/${doc.id}/file`)).status()).toBe(200);
  await admin.close();
});

test("an employee with no benefits on file sees an explanation, not an empty page", async ({ browser }) => {
  const state = await loginState(browser, SS.olive, "olive-benefits");
  const ctx = await browser.newContext({ storageState: state });
  const page = await ctx.newPage();
  await page.goto("/dashboard/benefits");
  await expect(page.getByText("No benefits information on file")).toBeVisible();
  await expect(page.getByText("E2E Medical PPO")).toHaveCount(0);
  await ctx.close();
});

test("'Something look wrong?' opens the request form on Benefits inquiry", async ({ page }) => {
  await page.goto("/dashboard/benefits");
  await page.getByRole("link", { name: "Something look wrong?" }).first().click();
  await expect(page).toHaveURL(/\/dashboard\/requests\?type=BENEFITS_INQUIRY/);
  await expect(page.getByRole("dialog", { name: "New request" })).toBeVisible();
});

test("other employees' coverage never appears", async ({ page }) => {
  await page.goto("/dashboard/benefits");
  await expect(page.getByText("MBR-BEA")).toHaveCount(0);
  await expect(page.getByText(SS.bea.name)).toHaveCount(0);
});
