import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildPayrollReadiness } from "@/server/queries/payroll-slip";

const employees = [
  { id: "clean", employeeId: "EMP-001", name: "Clean Employee", department: null },
  { id: "missing", employeeId: "EMP-002", name: "Missing Employee", department: { name: "Floor" } },
  { id: "issues", employeeId: "EMP-003", name: "Issue Employee", department: null },
];

describe("payroll readiness", () => {
  it("includes every active employee and categorizes unresolved time", () => {
    const readiness = buildPayrollReadiness(employees, [
      {
        employeeId: "clean",
        clockOut: new Date("2026-09-02T22:00:00Z"),
        status: "APPROVED",
        approvalStatus: "APPROVED",
        autoClosed: false,
        totalWorkMin: 480,
      },
      {
        employeeId: "issues",
        clockOut: null,
        status: "ACTIVE",
        approvalStatus: "PENDING",
        autoClosed: true,
        totalWorkMin: 0,
      },
      {
        employeeId: "issues",
        clockOut: new Date("2026-09-03T22:00:00Z"),
        status: "REJECTED",
        approvalStatus: "REJECTED",
        autoClosed: false,
        totalWorkMin: 420,
      },
    ]);

    expect(readiness.employees).toHaveLength(3);
    expect(readiness.employees.find((employee) => employee.employeeRowId === "clean")?.exceptions)
      .toEqual([]);
    expect(readiness.employees.find((employee) => employee.employeeRowId === "missing")?.exceptions)
      .toEqual(["ZERO_HOURS"]);
    expect(readiness.employees.find((employee) => employee.employeeRowId === "issues")?.exceptions)
      .toEqual(["ZERO_HOURS", "OPEN", "PENDING", "REJECTED", "AUTO_CLOSED"]);
    expect(readiness.summary).toEqual({
      ZERO_HOURS: 2,
      OPEN: 1,
      PENDING: 1,
      REJECTED: 1,
      AUTO_CLOSED: 1,
    });
    expect(readiness.blocking).toBe(true);
  });

  it("is clean when every employee has approved closed time", () => {
    const readiness = buildPayrollReadiness(employees.slice(0, 1), [
      {
        employeeId: "clean",
        clockOut: new Date("2026-09-02T22:00:00Z"),
        status: "APPROVED",
        approvalStatus: "APPROVED",
        autoClosed: false,
        totalWorkMin: 480,
      },
    ]);

    expect(readiness.blocking).toBe(false);
    expect(readiness.employees[0]?.approvedMinutes).toBe(480);
  });

  it("gates export and audits a reasoned override with the exception summary", () => {
    const source = readFileSync(
      new URL("../app/(admin)/admin/payroll/[periodId]/actions.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("if (readiness.blocking && reason.length < 10)");
    expect(source).toContain('action: "payroll.export_override"');
    expect(source).toContain("reason,");
    expect(source).toContain("exceptionSummary: result.readiness.summary");
    expect(source).toContain('isolationLevel: "RepeatableRead"');
    expect(source.indexOf("if (readiness.blocking && reason.length < 10)")).toBeLessThan(
      source.indexOf("payrollSlipsToCsv("),
    );
  });
});
