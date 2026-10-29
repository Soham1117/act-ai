import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  transaction: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

import {
  endBenefitEligibilityPolicy,
  saveBenefitEligibilityAssessment,
  saveBenefitEligibilityPolicy,
  saveBenefitPlanMetadata,
} from "./actions/benefit-eligibility";

const updatedAt = new Date("2026-10-28T12:00:00.000Z");
const policy = {
  id: "policy",
  benefitType: "MEDICAL",
  effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  effectiveTo: null,
  confirmed: false,
  updatedAt,
};
function fakeTransaction() {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    employee: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ dateOfHire: new Date("2026-10-28T00:00:00Z") }),
    },
    benefitEligibilityPolicy: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ id: "policy" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    benefitEligibilityAssessment: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ id: "assessment" }),
    },
    benefitPlan: {
      findUnique: vi
        .fn()
        .mockResolvedValue({
          id: "plan",
          type: "MEDICAL",
          planYearStart: new Date("2026-01-01"),
          updatedAt,
        }),
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    companyDocumentVersion: { findUnique: vi.fn().mockResolvedValue(null) },
  };
  mocks.transaction.mockImplementation(async (fn) => fn(tx));
  return tx;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({
    id: "00000000-0000-4000-8000-000000000001",
    email: "admin@example.test",
  });
});

describe("benefit eligibility action boundaries", () => {
  it("checks admin permission before reading or changing any data", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("Forbidden"));
    const calls = [
      () =>
        saveBenefitEligibilityPolicy({
          benefitType: "MEDICAL",
          effectiveFrom: "2026-01-01",
          confirmed: true,
          reason: "Reviewed",
        }),
      () =>
        endBenefitEligibilityPolicy({
          id: "policy",
          effectiveTo: "2027-01-01",
          expectedUpdatedAt: updatedAt.toISOString(),
          reason: "Renewal",
        }),
      () =>
        saveBenefitEligibilityAssessment({
          employeeId: "other",
          benefitType: "MEDICAL",
          classification: "ELIGIBLE",
          notes: "Reviewed",
        }),
      () =>
        saveBenefitPlanMetadata({
          id: "plan",
          expectedUpdatedAt: updatedAt.toISOString(),
        }),
    ];
    for (const call of calls) await expect(call()).rejects.toThrow("Forbidden");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("rejects invalid calendar dates before opening a transaction", async () => {
    const result = await saveBenefitEligibilityPolicy({
      benefitType: "MEDICAL",
      effectiveFrom: "2026-02-30",
      confirmed: false,
      reason: "Draft",
    });
    expect(result.ok).toBe(false);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("does not overwrite an already confirmed policy", async () => {
    const tx = fakeTransaction();
    tx.benefitEligibilityPolicy.findUnique.mockResolvedValue({
      ...policy,
      confirmed: true,
    });
    const result = await saveBenefitEligibilityPolicy({
      benefitType: "MEDICAL",
      effectiveFrom: "2026-01-01",
      confirmed: true,
      reason: "Changed",
    });
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("preserved"),
    });
    expect(tx.benefitEligibilityPolicy.upsert).not.toHaveBeenCalled();
  });
  it("does not create overlapping policies", async () => {
    const tx = fakeTransaction();
    tx.benefitEligibilityPolicy.findFirst.mockResolvedValue(policy);
    const result = await saveBenefitEligibilityPolicy({
      benefitType: "MEDICAL",
      effectiveFrom: "2026-11-01",
      confirmed: true,
      reason: "New version",
    });
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("overlaps"),
    });
    expect(tx.benefitEligibilityPolicy.upsert).not.toHaveBeenCalled();
  });
  it("saves a confirmed policy and audit together without touching coverage or timeclock delegates", async () => {
    const tx = fakeTransaction();
    const result = await saveBenefitEligibilityPolicy({
      benefitType: "DENTAL",
      effectiveFrom: "2026-11-01",
      confirmed: true,
      reason: "Current dental plan checked",
    });
    expect(result).toEqual({ ok: true, id: "policy" });
    expect(tx.benefitEligibilityPolicy.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          benefitType: "DENTAL",
          rule: "INSURANCE_60_DAYS",
          confirmed: true,
        }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
  });
  it("detects a stale assessment rather than replacing another admin's decision", async () => {
    const tx = fakeTransaction();
    tx.benefitEligibilityAssessment.findUnique.mockResolvedValue({
      id: "assessment",
      updatedAt,
    });
    const result = await saveBenefitEligibilityAssessment({
      employeeId: "employee",
      benefitType: "MEDICAL",
      classification: "ELIGIBLE",
      notes: "Confirmed",
    });
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("changed"),
    });
    expect(tx.benefitEligibilityAssessment.upsert).not.toHaveBeenCalled();
  });
  it("captures an HR-confirmed service date without rewriting an employee hire date", async () => {
    const tx = fakeTransaction();
    const result = await saveBenefitEligibilityAssessment({
      employeeId: "employee",
      benefitType: "RETIREMENT_401K",
      classification: "ELIGIBLE",
      serviceDate: "2026-02-26",
      notes: "Prior credited service confirmed",
    });
    expect(result).toEqual({ ok: true, id: "assessment" });
    expect(tx.benefitEligibilityAssessment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          serviceDate: new Date("2026-02-26T00:00:00Z"),
          classification: "ELIGIBLE",
        }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
  });
  it("requires a real service date when confirming eligibility", async () => {
    const tx = fakeTransaction();
    tx.employee.findUnique.mockResolvedValue({ dateOfHire: null });
    const result = await saveBenefitEligibilityAssessment({
      employeeId: "employee",
      benefitType: "MEDICAL",
      classification: "ELIGIBLE",
      notes: "Confirmed",
    });
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("service date"),
    });
    expect(tx.benefitEligibilityAssessment.upsert).not.toHaveBeenCalled();
  });
  it("refuses a private or unapproved company document as a benefits resource", async () => {
    const tx = fakeTransaction();
    tx.companyDocumentVersion.findUnique.mockResolvedValue({
      status: "DRAFT",
      purpose: "HR_ONLY",
      document: { category: "PAYROLL_COMPLIANCE", isArchived: false },
    });
    const result = await saveBenefitPlanMetadata({
      id: "plan",
      resourceVersionId: "private-tax-file",
      expectedUpdatedAt: updatedAt.toISOString(),
    });
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("approved benefits resource"),
    });
    expect(tx.benefitPlan.updateMany).not.toHaveBeenCalled();
  });
  it("prevents concurrent metadata edits and duplicate active base plans", async () => {
    const tx = fakeTransaction();
    tx.benefitPlan.findFirst.mockResolvedValue({ id: "another-base" });
    const result = await saveBenefitPlanMetadata({
      id: "plan",
      planDesignation: "BASE",
      expectedUpdatedAt: updatedAt.toISOString(),
    });
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("base medical plan already exists"),
    });
    expect(tx.benefitPlan.updateMany).not.toHaveBeenCalled();
  });
});
