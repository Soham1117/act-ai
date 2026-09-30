import { describe, expect, it } from "vitest";
import {
  combineAddressLines,
  nextEmployeeIdFrom,
  resolveEmailHireMode,
} from "./employee-create";

describe("combineAddressLines", () => {
  it("keeps both populated street lines", () => {
    expect(combineAddressLines("123 Main St", "Suite 200")).toBe(
      "123 Main St, Suite 200",
    );
  });

  it("trims values and omits blank lines", () => {
    expect(combineAddressLines(" 123 Main St ", " ")).toBe("123 Main St");
    expect(combineAddressLines("", undefined)).toBeNull();
  });
});

describe("resolveEmailHireMode", () => {
  it("creates when no user exists for the email", () => {
    expect(resolveEmailHireMode(null)).toBe("create");
  });

  it("links when a user exists but has no employee (bootstrap admin)", () => {
    expect(resolveEmailHireMode({ employeeId: null })).toBe("link");
  });

  it("conflicts when the email already belongs to an employee", () => {
    expect(resolveEmailHireMode({ employeeId: "emp_1" })).toBe("conflict");
  });
});

describe("nextEmployeeIdFrom", () => {
  it("starts at 0001", () => {
    expect(nextEmployeeIdFrom([], 2026)).toBe("EMP-2026-0001");
  });
  it("uses the max suffix, not the count", () => {
    expect(nextEmployeeIdFrom(["EMP-2026-0001", "EMP-2026-0007"], 2026)).toBe("EMP-2026-0008");
  });
  it("ignores other years and malformed ids", () => {
    expect(nextEmployeeIdFrom(["EMP-2025-0099", "EMP-2026-abc", "ACT001"], 2026)).toBe(
      "EMP-2026-0001",
    );
  });
});
