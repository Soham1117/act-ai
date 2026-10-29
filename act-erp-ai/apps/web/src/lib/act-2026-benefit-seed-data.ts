/**
 * Idempotent seed constants for ACT 2026-07-01 plan year.
 * Medical employee costs are AFTER ACT contribution (Renewal_Ltr.pdf).
 * Vision monthly EE rates from PLANS_FOR_MEDICAL/image.png.
 */

export const ACT_2026_PLAN_YEAR = {
  start: "2026-07-01",
  end: "2027-06-30",
} as const;

/** Inclusive age bands matching renewal letter rows, expanded between listed ages. */
export const ACT_2026_AGE_BANDS = [
  { ageFrom: 0, ageTo: 14 },
  { ageFrom: 15, ageTo: 15 },
  { ageFrom: 16, ageTo: 16 },
  { ageFrom: 17, ageTo: 17 },
  { ageFrom: 18, ageTo: 18 },
  { ageFrom: 19, ageTo: 19 },
  { ageFrom: 20, ageTo: 20 },
  { ageFrom: 21, ageTo: 24 },
  { ageFrom: 25, ageTo: 29 },
  { ageFrom: 30, ageTo: 34 },
  { ageFrom: 35, ageTo: 39 },
  { ageFrom: 40, ageTo: 44 },
  { ageFrom: 45, ageTo: 49 },
  { ageFrom: 50, ageTo: 54 },
  { ageFrom: 55, ageTo: 59 },
  { ageFrom: 60, ageTo: 63 },
  { ageFrom: 64, ageTo: 120 },
] as const;

type MetalRates = { monthly: number[]; perPay26: number[] };

/** Parallel to ACT_2026_AGE_BANDS — Silver / Gold / Platinum columns from renewal letter. */
export const ACT_2026_MEDICAL_RATES: Record<"silver" | "gold" | "platinum", MetalRates> = {
  silver: {
    monthly: [99.03, 107.84, 111.2, 114.57, 118.19, 121.82, 125.57, 129.45, 129.97, 146.93, 158.19, 165.44, 186.93, 231.2, 288.68, 351.34, 388.36],
    perPay26: [45.71, 49.77, 51.32, 52.88, 54.55, 56.22, 57.96, 59.75, 59.99, 67.81, 73.01, 76.36, 86.28, 106.71, 133.24, 162.16, 179.24],
  },
  gold: {
    monthly: [152.48, 166.05, 171.22, 176.41, 181.99, 187.57, 193.02, 199.33, 200.13, 226.25, 243.58, 252.52, 287.84, 356.0, 444.51, 540.99, 598.0],
    perPay26: [70.38, 76.64, 79.02, 81.42, 84.0, 86.57, 89.09, 92.0, 92.37, 104.42, 112.42, 116.55, 132.85, 164.31, 205.16, 249.69, 276.0],
  },
  platinum: {
    monthly: [236.07, 251.06, 257.08, 265.11, 273.74, 282.38, 291.34, 300.59, 301.82, 350.26, 377.09, 394.38, 437.84, 545.14, 688.48, 837.52, 925.78],
    perPay26: [108.96, 115.88, 118.65, 122.36, 126.34, 130.33, 134.46, 138.73, 139.3, 161.66, 174.04, 182.02, 202.08, 251.6, 317.76, 386.55, 427.28],
  },
};

export const ACT_2026_MEDICAL_PLANS = [
  {
    key: "silver" as const,
    planCode: "S9J7ADT",
    planDesignation: "BASE",
    name: "BCBS Blue Advantage Silver HMO (S9J7ADT)",
    carrierName: "Blue Cross and Blue Shield of Texas",
    carrierPhone: "1-877-299-2377",
    carrierPortalUrl: "https://www.bcbstx.com/go/bahmo",
    notes:
      "Company base plan effective 2026-07-01. ACT pays 70% of employee-only Silver premium; employee pays remaining 30% of EE premium and 100% of dependent coverage. Age-band costs below are employee net after ACT contribution (Renewal_Ltr). Gold enrollees auto-move to Silver on 2026-07-01 unless a new enrollment form is submitted by 2026-06-26.",
  },
  {
    key: "gold" as const,
    planCode: "G9E5ADT",
    planDesignation: "BUY_UP",
    name: "BCBS Blue Advantage Gold HMO (G9E5ADT)",
    carrierName: "Blue Cross and Blue Shield of Texas",
    carrierPhone: "1-877-299-2377",
    carrierPortalUrl: "https://www.bcbstx.com/go/bahmo",
    notes:
      "Buy-up plan. Employee pays additional premium via payroll. Age-band costs are employee net amounts from the 2026-2027 renewal letter.",
  },
  {
    key: "platinum" as const,
    planCode: "P611ADT",
    planDesignation: "BUY_UP",
    name: "BCBS Blue Advantage Platinum HMO (P611ADT)",
    carrierName: "Blue Cross and Blue Shield of Texas",
    carrierPhone: "1-877-299-2377",
    carrierPortalUrl: "https://www.bcbstx.com/go/bahmo",
    notes:
      "Buy-up plan. Employee pays additional premium via payroll. Age-band costs are employee net amounts from the 2026-2027 renewal letter.",
  },
] as const;

export const ACT_2026_VISION_PLAN = {
  planCode: "TX050150EZL1",
  planDesignation: "BASE",
  name: "Avēsis Vision (TX050150EZL1)",
  carrierName: "Avēsis / Fidelity Security Life",
  groupNumber: "10771-1372",
  carrierPhone: "855-214-6777",
  carrierPortalUrl: "https://www.avesis.com",
  notes: "Employee-paid monthly rates from official Avēsis plan summary (image.png). Exam/lenses every 12 months; frames every 24 months.",
  tiers: [
    { tier: "EMPLOYEE_ONLY" as const, employeeCost: 7.36, employerCost: 0 },
    { tier: "EMPLOYEE_SPOUSE" as const, employeeCost: 13.93, employerCost: 0 },
    { tier: "EMPLOYEE_CHILDREN" as const, employeeCost: 15.17, employerCost: 0 },
    { tier: "FAMILY" as const, employeeCost: 19.52, employerCost: 0 },
  ],
};

export function ageRatesForMetal(key: keyof typeof ACT_2026_MEDICAL_RATES) {
  const rates = ACT_2026_MEDICAL_RATES[key];
  return ACT_2026_AGE_BANDS.map((band, i) => ({
    ageFrom: band.ageFrom,
    ageTo: band.ageTo,
    monthlyEmployeeCost: rates.monthly[i]!,
    perPay26EmployeeCost: rates.perPay26[i]!,
  }));
}
