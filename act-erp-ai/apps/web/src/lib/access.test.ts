import { describe, expect, it } from "vitest";
import { accessLevelFor, TERMINATION_GRACE_DAYS } from "./access";

const now = new Date("2026-06-30T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const emp = (
  employmentStatus: "ACTIVE" | "ON_LEAVE" | "TERMINATED" | "PENDING_REVIEW",
  terminationDate: Date | null = null,
  updatedAt?: Date,
) => ({ employmentStatus, terminationDate, updatedAt });

describe("accessLevelFor", () => {
  it("grace window is 60 days", () => expect(TERMINATION_GRACE_DAYS).toBe(60));

  it("active and on-leave employees are FULL", () => {
    expect(accessLevelFor({ role: "EMPLOYEE", employee: emp("ACTIVE") }, now)).toBe("FULL");
    expect(accessLevelFor({ role: "EMPLOYEE", employee: emp("ON_LEAVE") }, now)).toBe("FULL");
  });

  it("terminated day 0 is READ_ONLY", () => {
    expect(accessLevelFor({ role: "EMPLOYEE", employee: emp("TERMINATED", now) }, now)).toBe(
      "READ_ONLY",
    );
  });

  it("terminated day 60 is still READ_ONLY, day 61 is NONE", () => {
    expect(
      accessLevelFor({ role: "EMPLOYEE", employee: emp("TERMINATED", daysAgo(60)) }, now),
    ).toBe("READ_ONLY");
    expect(
      accessLevelFor({ role: "EMPLOYEE", employee: emp("TERMINATED", daysAgo(61)) }, now),
    ).toBe("NONE");
  });

  it("terminated with no date falls back to updatedAt", () => {
    expect(
      accessLevelFor({ role: "EMPLOYEE", employee: emp("TERMINATED", null, daysAgo(10)) }, now),
    ).toBe("READ_ONLY");
    expect(
      accessLevelFor({ role: "EMPLOYEE", employee: emp("TERMINATED", null, daysAgo(90)) }, now),
    ).toBe("NONE");
  });

  it("pending review is READ_ONLY", () => {
    expect(accessLevelFor({ role: "EMPLOYEE", employee: emp("PENDING_REVIEW") }, now)).toBe(
      "READ_ONLY",
    );
  });

  it("admins are always FULL, even if their employee is terminated", () => {
    expect(
      accessLevelFor({ role: "ADMIN", employee: emp("TERMINATED", daysAgo(400)) }, now),
    ).toBe("FULL");
  });

  it("user with no employee record is FULL", () => {
    expect(accessLevelFor({ role: "EMPLOYEE", employee: null }, now)).toBe("FULL");
  });
});
