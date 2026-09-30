import { describe, expect, it } from "vitest";
import {
  allowedTransitions,
  businessYearRange,
  canReopen,
  canTransition,
  validateClaimAmount,
  validatePaidAmount,
} from "./reimbursement";

describe("reimbursement transitions", () => {
  it("allows the forward path", () => {
    expect(canTransition("PENDING", "UNDER_REVIEW")).toBe(true);
    expect(canTransition("PENDING", "APPROVED")).toBe(true);
    expect(canTransition("PENDING", "REJECTED")).toBe(true);
    expect(canTransition("UNDER_REVIEW", "APPROVED")).toBe(true);
    expect(canTransition("UNDER_REVIEW", "REJECTED")).toBe(true);
    expect(canTransition("APPROVED", "PAID")).toBe(true);
    expect(canTransition("APPROVED", "REJECTED")).toBe(true);
  });

  it("blocks skipping and going backwards", () => {
    expect(canTransition("PENDING", "PAID")).toBe(false);
    expect(canTransition("UNDER_REVIEW", "PAID")).toBe(false);
    expect(canTransition("UNDER_REVIEW", "PENDING")).toBe(false);
    expect(canTransition("APPROVED", "UNDER_REVIEW")).toBe(false);
    expect(canTransition("APPROVED", "PENDING")).toBe(false);
  });

  it("PAID is terminal and REJECTED only reopens explicitly", () => {
    expect(allowedTransitions("PAID")).toEqual([]);
    expect(allowedTransitions("REJECTED")).toEqual([]);
    expect(canTransition("REJECTED", "APPROVED")).toBe(false);
    expect(canTransition("PAID", "REJECTED")).toBe(false);
    expect(canReopen("REJECTED")).toBe(true);
    expect(canReopen("PAID")).toBe(false);
    expect(canReopen("PENDING")).toBe(false);
  });

  it("does not allow a no-op transition", () => {
    expect(canTransition("APPROVED", "APPROVED")).toBe(false);
  });
});

describe("validateClaimAmount", () => {
  it("rejects zero, negative, NaN", () => {
    expect(validateClaimAmount(0).ok).toBe(false);
    expect(validateClaimAmount(-5).ok).toBe(false);
    expect(validateClaimAmount(Number.NaN).ok).toBe(false);
  });
  it("rejects absurd amounts and sub-cent precision", () => {
    expect(validateClaimAmount(1_000_000).ok).toBe(false);
    expect(validateClaimAmount(10.005).ok).toBe(false);
  });
  it("accepts normal amounts", () => {
    expect(validateClaimAmount(0.01).ok).toBe(true);
    expect(validateClaimAmount(123.45).ok).toBe(true);
    expect(validateClaimAmount(50_000).ok).toBe(true);
  });
});

describe("validatePaidAmount", () => {
  it("requires 0 < paid <= amount", () => {
    expect(validatePaidAmount(0, 100).ok).toBe(false);
    expect(validatePaidAmount(-1, 100).ok).toBe(false);
    expect(validatePaidAmount(100.01, 100).ok).toBe(false);
    expect(validatePaidAmount(100, 100).ok).toBe(true);
  });
  it("partial payment needs a note", () => {
    expect(validatePaidAmount(60, 100).ok).toBe(false);
    expect(validatePaidAmount(60, 100, "  ").ok).toBe(false);
    expect(validatePaidAmount(60, 100, "Personal portion excluded").ok).toBe(true);
  });
});

describe("businessYearRange", () => {
  it("starts at local midnight Jan 1 Central (06:00 UTC)", () => {
    const r = businessYearRange(2026);
    expect(r.start.toISOString()).toBe("2026-01-01T06:00:00.000Z");
    expect(r.end.toISOString()).toBe("2027-01-01T06:00:00.000Z");
  });
  it("puts a Dec 31 9pm Central payment in the old year and a Jan 1 1am payment in the new", () => {
    const r = businessYearRange(2026);
    const dec31Late = new Date("2027-01-01T03:00:00.000Z"); // Dec 31 9pm CST
    const jan1Early = new Date("2027-01-01T07:00:00.000Z"); // Jan 1 1am CST
    expect(dec31Late < r.end).toBe(true);
    expect(jan1Early < r.end).toBe(false);
  });
});
