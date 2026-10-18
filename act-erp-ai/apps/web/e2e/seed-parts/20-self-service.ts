/**
 * Seed data for the employee self-service specs (leave, reimbursements, requests,
 * benefits, documents, notifications, settings). Creates one dedicated employee per
 * area (see e2e/support/self-service-data.ts) plus the benefit plans and a
 * few rows belonging to "somebody else" that must stay private.
 * Specs create their own per-test rows through Prisma, so nothing else is seeded here.
 */
import type { SeedContext } from "../seed";
import {
  SS,
  SS_DEPARTMENT,
  SS_EMPTY_DEPARTMENT,
  SS_OLIVE_DOC_TITLE,
  SS_OLIVE_RECEIPT,
  SS_PLAN_401K,
  SS_PLAN_DENTAL,
  SS_PLAN_MEDICAL,
} from "../support/self-service-data";

export default async function seedSelfService(ctx: SeedContext) {
  const { db, makeEmployee, daysAgo, at, admin } = ctx;

  const dept = await db.department.create({ data: { name: SS_DEPARTMENT, code: "E2ESS" } });
  await db.department.create({ data: { name: SS_EMPTY_DEPARTMENT, code: "E2EEM" } });
  const jobCode = await db.jobCode.findFirstOrThrow({ where: { isDefault: true } });

  const made: Record<string, { id: string }> = {};
  for (const [key, u] of Object.entries(SS)) {
    const readOnly = key === "rory";
    const e = await makeEmployee({
      employeeId: u.employeeId,
      name: u.name,
      email: u.email,
      password: u.password,
      status: readOnly ? "TERMINATED" : "ACTIVE",
      terminationDate: readOnly ? daysAgo(5) : undefined, // inside the 60-day read-only grace
    });
    made[key] = e;
    // Every ACTIVE employee needs approved hours in the closed pay period, or the
    // payroll "ready to export" check (payroll-csv.spec.ts) would turn blocking.
    if (!readOnly) {
      await db.timeEntry.create({
        data: {
          employeeId: e.id,
          date: daysAgo(55),
          clockIn: at(daysAgo(55), 14),
          clockOut: at(daysAgo(55), 22),
          totalWorkMin: 480,
          status: "APPROVED",
          jobCode: jobCode.code,
          source: "MANUAL",
          approvalStatus: "APPROVED",
          approvalDate: new Date(),
        },
      });
    }
  }
  await db.employee.update({ where: { id: made.nina!.id }, data: { departmentId: dept.id } });

  // ── Benefit catalog ──────────────────────────────────────────────────
  const y = new Date().getUTCFullYear();
  const planYearStart = new Date(Date.UTC(y - 1, 0, 1));
  const planYearEnd = new Date(Date.UTC(y + 1, 11, 31));
  const medical = await db.benefitPlan.create({
    data: {
      type: "MEDICAL",
      name: SS_PLAN_MEDICAL,
      carrierName: "E2E Health Co",
      groupNumber: "GRP-E2E-1",
      carrierPhone: "800-555-0100",
      planYearStart,
      planYearEnd,
      costPeriod: "PER_PAYCHECK",
      createdById: admin.id,
      tiers: {
        create: [
          { tier: "EMPLOYEE_ONLY", employeeCost: 50, employerCost: 300 },
          { tier: "FAMILY", employeeCost: 150, employerCost: 500 },
        ],
      },
    },
  });
  const dental = await db.benefitPlan.create({
    data: {
      type: "DENTAL",
      name: SS_PLAN_DENTAL,
      carrierName: "E2E Dental Co",
      planYearStart,
      planYearEnd,
      costPeriod: "MONTHLY",
      createdById: admin.id,
      tiers: { create: [{ tier: "EMPLOYEE_ONLY", employeeCost: 12.5, employerCost: 20 }] },
    },
  });
  const k401 = await db.benefitPlan.create({
    data: {
      type: "RETIREMENT_401K",
      name: SS_PLAN_401K,
      carrierName: "E2E Retirement Co",
      planYearStart,
      planYearEnd,
      costPeriod: "PER_PAYCHECK",
      matchDescription: "100% of the first 3%",
      vestingDescription: "Fully vested after 2 years",
      createdById: admin.id,
    },
  });

  // Ben: fixed coverage that benefits.spec.ts only reads.
  await db.benefitEnrollment.create({
    data: {
      employeeId: made.ben!.id,
      planId: medical.id,
      tier: "EMPLOYEE_ONLY",
      status: "ENROLLED",
      effectiveDate: daysAgo(100),
      memberId: "MBR-BEN-001",
      confirmedAsOf: daysAgo(10),
      createdById: admin.id,
    },
  });
  await db.benefitEnrollment.create({
    data: {
      employeeId: made.ben!.id,
      planId: dental.id,
      tier: "EMPLOYEE_ONLY",
      status: "ENROLLED",
      effectiveDate: daysAgo(100),
      confirmedAsOf: daysAgo(10),
      createdById: admin.id,
    },
  });
  await db.retirementElection.create({
    data: {
      employeeId: made.ben!.id,
      planId: k401.id,
      status: "ENROLLED",
      preTaxPercent: 5,
      rothPercent: 2,
      effectiveDate: daysAgo(100),
      confirmedAsOf: daysAgo(10),
      createdById: admin.id,
    },
  });
  // A past, ended vision row so "Past coverage" has content.
  const vision = await db.benefitPlan.create({
    data: {
      type: "VISION",
      name: "E2E Vision Old",
      carrierName: "E2E Vision Co",
      planYearStart,
      planYearEnd,
      costPeriod: "PER_PAYCHECK",
      createdById: admin.id,
      tiers: { create: [{ tier: "EMPLOYEE_ONLY", employeeCost: 5, employerCost: 5 }] },
    },
  });
  await db.benefitEnrollment.create({
    data: {
      employeeId: made.ben!.id,
      planId: vision.id,
      tier: "EMPLOYEE_ONLY",
      status: "ENROLLED",
      effectiveDate: daysAgo(300),
      endDate: daysAgo(200),
      confirmedAsOf: daysAgo(200),
      createdById: admin.id,
    },
  });

  // ── Olive: data that nobody else may see ─────────────────────────────
  const claim = await db.reimbursement.create({
    data: {
      employeeId: made.olive!.id,
      title: "Olive Secret Claim",
      category: "TRAVEL",
      amount: 12.34,
      description: "Private to Olive",
      expenseDate: daysAgo(3),
    },
  });
  await db.reimbursementReceipt.create({
    data: {
      reimbursementId: claim.id,
      fileName: `${made.olive!.id}/seed-${SS_OLIVE_RECEIPT}`,
      originalName: SS_OLIVE_RECEIPT,
      fileUrl: `reimbursement-receipts/${made.olive!.id}/seed-${SS_OLIVE_RECEIPT}`,
      fileSize: 10,
      mimeType: "application/pdf",
    },
  });
  await db.request.create({
    data: {
      employeeId: made.olive!.id,
      type: "OTHER",
      title: "Olive Secret Request",
      description: "Private to Olive",
    },
  });
  await db.document.create({
    data: {
      employeeId: made.olive!.id,
      title: SS_OLIVE_DOC_TITLE,
      fileName: `${made.olive!.id}/seed-olive.pdf`,
      fileType: "application/pdf",
      fileUrl: `documents/${made.olive!.id}/seed-olive.pdf`,
      documentType: "PERSONAL",
      uploadedById: admin.id,
    },
  });
  await db.notification.create({
    data: {
      type: "COMPANY",
      title: "Olive Secret Notice",
      message: "Only for Olive",
      recipients: { create: [{ employeeId: made.olive!.id }] },
    },
  });
}
