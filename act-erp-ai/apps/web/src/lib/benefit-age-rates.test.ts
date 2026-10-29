import { describe, expect, it } from "vitest";
import {
  attainedAgeYears,
  findAgeRateBand,
  resolveMedicalEmployeeCost,
  validateAgeBands,
  type AgeRateBand,
} from "./benefit-age-rates";

const sample: AgeRateBand[] = [
  { ageFrom: 0, ageTo: 14, monthlyEmployeeCost: 99.03, perPay26EmployeeCost: 45.71 },
  { ageFrom: 21, ageTo: 24, monthlyEmployeeCost: 129.45, perPay26EmployeeCost: 59.75 },
  { ageFrom: 25, ageTo: 29, monthlyEmployeeCost: 129.97, perPay26EmployeeCost: 59.99 },
  { ageFrom: 64, ageTo: 120, monthlyEmployeeCost: 388.36, perPay26EmployeeCost: 179.24 },
];

describe("attainedAgeYears", () => {
  it("counts full years before birthday in the as-of year", () => {
    expect(attainedAgeYears(new Date("1990-06-15T00:00:00Z"), new Date("2026-06-14T00:00:00Z"))).toBe(35);
    expect(attainedAgeYears(new Date("1990-06-15T00:00:00Z"), new Date("2026-06-15T00:00:00Z"))).toBe(36);
  });
});

describe("findAgeRateBand", () => {
  it("returns the inclusive band for the age", () => {
    expect(findAgeRateBand(sample, 22)?.monthlyEmployeeCost).toBe(129.45);
    expect(findAgeRateBand(sample, 25)?.monthlyEmployeeCost).toBe(129.97);
    expect(findAgeRateBand(sample, 70)?.monthlyEmployeeCost).toBe(388.36);
  });

  it("returns null when no band matches", () => {
    expect(findAgeRateBand(sample, 40)).toBeNull();
  });
});

describe("validateAgeBands", () => {
  it("rejects overlaps", () => {
    const bad = validateAgeBands([
      { ageFrom: 20, ageTo: 25, monthlyEmployeeCost: 1, perPay26EmployeeCost: 1 },
      { ageFrom: 25, ageTo: 30, monthlyEmployeeCost: 1, perPay26EmployeeCost: 1 },
    ]);
    expect(bad.ok).toBe(false);
  });

  it("accepts contiguous non-overlapping bands", () => {
    expect(validateAgeBands(sample).ok).toBe(true);
  });
});

describe("resolveMedicalEmployeeCost", () => {
  it("returns null without DOB", () => {
    expect(resolveMedicalEmployeeCost(sample, null, new Date("2026-07-01T00:00:00Z"))).toBeNull();
  });

  it("resolves from DOB and as-of date", () => {
    const band = resolveMedicalEmployeeCost(
      sample,
      new Date("2000-01-01T00:00:00Z"),
      new Date("2026-07-01T00:00:00Z"),
    );
    expect(band?.ageFrom).toBe(25);
    expect(band?.monthlyEmployeeCost).toBe(129.97);
  });
});
