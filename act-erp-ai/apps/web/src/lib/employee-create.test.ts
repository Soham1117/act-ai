import { describe, expect, it } from "vitest";
import { resolveEmailHireMode } from "./employee-create";

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
