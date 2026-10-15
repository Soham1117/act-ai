import { describe, expect, it } from "vitest";
import {
  businessDaysBetween,
  contractWorkerIneligibleReason,
  formatContractWorkerId,
  isContractWorkerEligible,
  isEndingSoon,
  nextContractWorkerIdFrom,
  parseContractWorkerNumber,
} from "./contract-workers";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("contract worker IDs", () => {
  it("zero-pads to four digits", () => {
    expect(formatContractWorkerId(1)).toBe("CW-0001");
    expect(formatContractWorkerId(42)).toBe("CW-0042");
    expect(formatContractWorkerId(12345)).toBe("CW-12345");
  });

  it("parses valid IDs and rejects others", () => {
    expect(parseContractWorkerNumber("CW-0007")).toBe(7);
    expect(parseContractWorkerNumber("cw-12")).toBe(12);
    expect(parseContractWorkerNumber("EMP-2026-0001")).toBeNull();
    expect(parseContractWorkerNumber("CW-")).toBeNull();
  });

  it("picks the next number from existing IDs", () => {
    expect(nextContractWorkerIdFrom([])).toBe("CW-0001");
    expect(nextContractWorkerIdFrom(["CW-0001", "CW-0009", "junk", "CW-0003"])).toBe("CW-0010");
  });
});

describe("isContractWorkerEligible", () => {
  const base = { status: "ACTIVE" as const, startDate: d("2026-10-05"), endDate: d("2026-10-20") };

  it("allows ACTIVE workers inside the window, inclusive of both ends", () => {
    expect(isContractWorkerEligible(base, d("2026-10-05"))).toBe(true);
    expect(isContractWorkerEligible(base, d("2026-10-12"))).toBe(true);
    expect(isContractWorkerEligible(base, d("2026-10-20"))).toBe(true);
  });

  it("blocks before start and after end", () => {
    expect(isContractWorkerEligible(base, d("2026-10-04"))).toBe(false);
    expect(isContractWorkerEligible(base, d("2026-10-21"))).toBe(false);
  });

  it("allows an open-ended contract", () => {
    expect(isContractWorkerEligible({ ...base, endDate: null }, d("2027-01-01"))).toBe(true);
  });

  it("blocks ENDED workers even inside the window", () => {
    expect(isContractWorkerEligible({ ...base, status: "ENDED" }, d("2026-10-12"))).toBe(false);
  });

  it("explains why a worker is blocked", () => {
    expect(contractWorkerIneligibleReason(base, d("2026-10-12"))).toBeNull();
    expect(contractWorkerIneligibleReason(base, d("2026-10-01"))).toMatch(/not started/);
    expect(contractWorkerIneligibleReason(base, d("2026-11-01"))).toMatch(/ended/);
    expect(contractWorkerIneligibleReason({ ...base, status: "ENDED" }, d("2026-10-12"))).toMatch(/ended/);
  });
});

describe("ending soon", () => {
  it("counts only weekdays", () => {
    // Thu 2026-10-15 -> Mon 2026-10-19: Fri + Mon = 2
    expect(businessDaysBetween(d("2026-10-15"), d("2026-10-19"))).toBe(2);
    expect(businessDaysBetween(d("2026-10-15"), d("2026-10-15"))).toBe(0);
  });

  it("flags contracts ending within 7 business days", () => {
    const today = d("2026-10-15");
    expect(isEndingSoon(d("2026-10-26"), today)).toBe(true); // 7 weekdays
    expect(isEndingSoon(d("2026-10-27"), today)).toBe(false); // 8 weekdays
    expect(isEndingSoon(null, today)).toBe(false);
    expect(isEndingSoon(d("2026-10-14"), today)).toBe(false); // already past
  });
});
