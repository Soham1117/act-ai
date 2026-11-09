import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  audit: vi.fn(),
  counts: vi.fn(),
  database: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    auditLog: { create: vi.fn() },
    payrollCalendar: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/db", () => ({ db: mocks.database }));
vi.mock("@/lib/storage", () => ({ deleteFile: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/payroll-close", () => ({ loadPeriodCounts: mocks.counts }));
vi.mock("@/server/employee-private-data", () => ({ readEmployeePrivateDetails: vi.fn() }));
vi.mock("@/server/paystub-analysis", () => ({}));
vi.mock("@/server/paystub-persistence", () => ({}));
vi.mock("@/lib/paystub-parser", () => ({}));
vi.mock("@/lib/paystub-match", () => ({}));
vi.mock("@/lib/upload-validation", () => ({ validateUpload: vi.fn() }));
vi.mock("pdf-lib", () => ({ PDFDocument: {} }));

import { closePayrollPeriod, reopenPayrollPeriod } from "./payroll";

const past = {
  id: "p1",
  title: "October 3rd Period",
  payPeriodStart: new Date("2026-10-12T00:00:00Z"),
  payPeriodEnd: new Date("2026-10-25T00:00:00Z"),
  closedAt: null as Date | null,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.admin.mockResolvedValue({ id: "admin-1", email: "admin@example.test" });
  mocks.database.$transaction.mockImplementation(async (callback) => callback(mocks.database));
});

describe("closePayrollPeriod", () => {
  it("refuses while entries are pending or open, and changes nothing", async () => {
    mocks.database.payrollCalendar.findUnique.mockResolvedValue(past);
    mocks.counts.mockResolvedValue(new Map([["p1", { pending: 2, open: 1 }]]));
    const res = await closePayrollPeriod("p1");
    expect(res.ok).toBe(false);
    expect(mocks.database.payrollCalendar.updateMany).not.toHaveBeenCalled();
    expect(mocks.database.auditLog.create).not.toHaveBeenCalled();
  });

  it("closes a finished period with nothing outstanding and audits it", async () => {
    mocks.database.payrollCalendar.findUnique.mockResolvedValue(past);
    mocks.counts.mockResolvedValue(new Map([["p1", { pending: 0, open: 0 }]]));
    mocks.database.payrollCalendar.updateMany.mockResolvedValue({ count: 1 });
    const res = await closePayrollPeriod("p1");
    expect(res.ok).toBe(true);
    expect(mocks.database.payrollCalendar.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "p1", closedAt: null } }),
    );
    expect(mocks.database.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "payroll.period.close", actorId: "admin-1", actorEmail: "admin@example.test" }),
    }));
    expect(mocks.counts).toHaveBeenCalledWith([past], mocks.database);
    expect(mocks.database.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(mocks.counts.mock.invocationCallOrder[0]!);
    expect(mocks.counts.mock.invocationCallOrder[0]).toBeLessThan(mocks.database.payrollCalendar.updateMany.mock.invocationCallOrder[0]!);
  });

  it("refuses an already closed period", async () => {
    mocks.database.payrollCalendar.findUnique.mockResolvedValue({ ...past, closedAt: new Date() });
    expect((await closePayrollPeriod("p1")).ok).toBe(false);
    expect(mocks.database.payrollCalendar.updateMany).not.toHaveBeenCalled();
  });

  it("does not update or audit when the locked blocker check fails", async () => {
    mocks.database.payrollCalendar.findUnique.mockResolvedValue(past);
    mocks.counts.mockRejectedValue(new Error("Unavailable"));
    expect((await closePayrollPeriod("p1")).ok).toBe(false);
    expect(mocks.database.$queryRaw).toHaveBeenCalled();
    expect(mocks.database.payrollCalendar.updateMany).not.toHaveBeenCalled();
    expect(mocks.database.auditLog.create).not.toHaveBeenCalled();
  });

  it("refuses a period that is not over yet", async () => {
    mocks.database.payrollCalendar.findUnique.mockResolvedValue({
      ...past,
      payPeriodStart: new Date("2999-01-01T00:00:00Z"),
      payPeriodEnd: new Date("2999-01-14T00:00:00Z"),
    });
    mocks.counts.mockResolvedValue(new Map([["p1", { pending: 0, open: 0 }]]));
    expect((await closePayrollPeriod("p1")).ok).toBe(false);
  });
});

describe("reopenPayrollPeriod", () => {
  it("needs a reason", async () => {
    expect((await reopenPayrollPeriod("p1", " ")).ok).toBe(false);
    expect(mocks.database.payrollCalendar.update).not.toHaveBeenCalled();
  });

  it("clears the close and audits the reason", async () => {
    mocks.database.payrollCalendar.findUnique.mockResolvedValue({ ...past, closedAt: new Date() });
    const res = await reopenPayrollPeriod("p1", "Late correction for Ann");
    expect(res.ok).toBe(true);
    expect(mocks.database.payrollCalendar.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { closedAt: null, closedById: null } }),
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "payroll.period.reopen" }),
    );
  });
});
