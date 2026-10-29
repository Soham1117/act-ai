import { expect, test } from "@playwright/test";
import { db } from "./support/db";
import { ADMIN_STATE } from "./support/test-data";
import { SS, empDbId, fmtDate, loginState } from "./support/self-service";

test.use({ storageState: ADMIN_STATE });

let oliveId: string;
let benId: string;
let oliveState: string;
const policyIds: string[] = [];
const assessmentIds: string[] = [];

test.beforeAll(async ({ browser }) => {
  oliveId = await empDbId(SS.olive);
  benId = await empDbId(SS.ben);
  oliveState = await loginState(browser, SS.olive, "hr-benefits-olive");
});

test.afterEach(async () => {
  await db.benefitEligibilityAssessment.deleteMany({
    where: { id: { in: assessmentIds.splice(0) } },
  });
  await db.benefitEligibilityPolicy.deleteMany({
    where: { id: { in: policyIds.splice(0) } },
  });
});

test("admin confirms policy versions and service credit without changing enrollment or timeclock rows", async ({
  page,
}) => {
  const enrollmentCount = await db.benefitEnrollment.count();
  const retirementCount = await db.retirementElection.count();
  const clockRows = await db.timeEntry.findMany({ orderBy: { id: "asc" } });
  await page.goto("/admin/benefits");
  await page.getByRole("link", { name: "Eligibility review", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Benefit eligibility", exact: true }),
  ).toBeVisible();

  for (const benefitType of ["MEDICAL", "RETIREMENT_401K"] as const) {
    await page.locator("#policy-benefit").selectOption(benefitType);
    await page.locator("#policy-from").fill("2020-01-01");
    await page
      .getByRole("checkbox", { name: /I checked the current plan terms/ })
      .check();
    await page.locator("#policy-reason").fill("E2E current plan and boundary reviewed");
    await page.getByRole("button", { name: "Save policy version", exact: true }).click();
    await expect(
      page.getByText("Policy version saved", { exact: true }).first(),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (
            await db.benefitEligibilityPolicy.findUnique({
              where: {
                benefitType_effectiveFrom: {
                  benefitType,
                  effectiveFrom: new Date("2020-01-01T00:00:00Z"),
                },
              },
            })
          )?.confirmed,
      )
      .toBe(true);
    const policy = await db.benefitEligibilityPolicy.findUniqueOrThrow({
      where: {
        benefitType_effectiveFrom: {
          benefitType,
          effectiveFrom: new Date("2020-01-01T00:00:00Z"),
        },
      },
    });
    policyIds.push(policy.id);
    expect(policy.confirmed).toBe(true);
    await expect
      .poll(async () =>
        page
          .getByRole("checkbox", { name: /I checked the current plan terms/ })
          .isChecked(),
      )
      .toBe(false);
    await page.locator("#assessment-employee").selectOption(oliveId);
    await page.locator("#assessment-benefit").selectOption(benefitType);
    await page.locator("#assessment-class").selectOption("ELIGIBLE");
    await page
      .locator("#assessment-service")
      .fill(benefitType === "MEDICAL" ? "2026-10-28" : "2026-02-26");
    await page
      .locator("#assessment-notes")
      .fill("E2E employee group and service credit confirmed");
    await page.getByRole("button", { name: "Save HR assessment", exact: true }).click();
    await expect(
      page
        .getByText("HR assessment saved; enrollments unchanged", { exact: true })
        .first(),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (
            await db.benefitEligibilityAssessment.findUnique({
              where: { employeeId_benefitType: { employeeId: oliveId, benefitType } },
            })
          )?.classification,
      )
      .toBe("ELIGIBLE");
    const assessment = await db.benefitEligibilityAssessment.findUniqueOrThrow({
      where: { employeeId_benefitType: { employeeId: oliveId, benefitType } },
    });
    assessmentIds.push(assessment.id);
    await page
      .getByLabel("Employee name or ID", { exact: true })
      .fill(SS.olive.employeeId);
    await page.locator("#eligibility-benefit-filter").selectOption(benefitType);
    await page.locator("#eligibility-state-filter").selectOption("NOT_ELIGIBLE");
    await expect(page.getByText("No employees match these filters.", { exact: true })).toBeVisible();
    await page.locator("#eligibility-state-filter").selectOption("");
    await expect(
      page.getByRole("status").filter({ hasText: "Showing 1 of 1 matching records." }),
    ).toBeVisible();
    const row = page
      .getByRole("region", { name: "Upcoming and review list", exact: true })
      .locator(`tr[data-employee-id="${oliveId}"][data-benefit-type="${benefitType}"]`);
    await expect(row).toContainText(SS.olive.name);
    await expect(row).toContainText(SS.olive.employeeId);
    await expect(row).toContainText(
      fmtDate(benefitType === "MEDICAL" ? "2027-01-01" : "2027-04-01"),
    );
  }
  expect(await db.benefitEnrollment.count()).toBe(enrollmentCount);
  expect(await db.retirementElection.count()).toBe(retirementCount);
  expect(await db.timeEntry.findMany({ orderBy: { id: "asc" } })).toEqual(clockRows);
  expect(
    await db.auditLog.count({
      where: {
        action: "benefits.eligibility.assessment.save",
        resource: { in: assessmentIds.map((id) => `BenefitEligibilityAssessment:${id}`) },
      },
    }),
  ).toBe(2);
});

test("employee sees only their eligibility projection and cannot open admin review", async ({
  browser,
}) => {
  const admin = await db.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  const policy = await db.benefitEligibilityPolicy.create({
    data: {
      benefitType: "MEDICAL",
      rule: "INSURANCE_60_DAYS",
      effectiveFrom: new Date("2020-01-01"),
      confirmed: true,
      confirmedAt: new Date(),
      confirmedById: admin.id,
    },
  });
  policyIds.push(policy.id);
  for (const [employeeId, serviceDate] of [
    [oliveId, "2026-10-28"],
    [benId, "2030-02-26"],
  ]) {
    const assessment = await db.benefitEligibilityAssessment.create({
      data: {
        employeeId,
        benefitType: "MEDICAL",
        classification: "ELIGIBLE",
        serviceDate: new Date(serviceDate),
        confirmedAt: new Date(),
        confirmedById: admin.id,
        notes: "Private HR assessment evidence should not appear in the employee view",
      },
    });
    assessmentIds.push(assessment.id);
  }
  const context = await browser.newContext({ storageState: oliveState });
  const page = await context.newPage();
  await page.goto("/dashboard/benefits");
  const summary = page.getByRole("region", {
    name: "Enrollment eligibility",
    exact: true,
  });
  await expect(summary).toContainText(fmtDate("2027-01-01"));
  await expect(summary).not.toContainText("2030");
  await expect(
    page.getByText(
      "Private HR assessment evidence should not appear in the employee view",
    ),
  ).toHaveCount(0);
  await expect(page.locator('a[href^="/api/company-documents/"]')).toHaveCount(0);
  await page.goto("/admin/benefits/eligibility");
  await expect(page).not.toHaveURL(/\/admin\/benefits\/eligibility/);
  await context.close();
});
