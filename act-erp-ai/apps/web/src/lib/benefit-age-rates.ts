/**
 * Age-banded medical employee costs (after employer contribution).
 * Pure helpers — no DB. Spec: docs/superpowers/specs/2026-10-29-benefits-catalog-age-rates-design.md
 */

export type AgeRateBand = {
  ageFrom: number;
  ageTo: number;
  monthlyEmployeeCost: number;
  perPay26EmployeeCost: number;
};

/** Attained age in whole years as of `asOf` (UTC date). */
export function attainedAgeYears(dateOfBirth: Date, asOf: Date): number {
  let age = asOf.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const monthDiff = asOf.getUTCMonth() - dateOfBirth.getUTCMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && asOf.getUTCDate() < dateOfBirth.getUTCDate())
  ) {
    age -= 1;
  }
  return age;
}

export function findAgeRateBand(
  bands: AgeRateBand[],
  age: number,
): AgeRateBand | null {
  if (!Number.isFinite(age) || age < 0) return null;
  return bands.find((b) => age >= b.ageFrom && age <= b.ageTo) ?? null;
}

export function validateAgeBands(
  bands: AgeRateBand[],
): { ok: true } | { ok: false; error: string } {
  if (bands.length === 0) return { ok: true };
  const sorted = [...bands].sort((a, b) => a.ageFrom - b.ageFrom);
  for (const b of sorted) {
    if (b.ageFrom > b.ageTo) {
      return { ok: false, error: `Invalid band ${b.ageFrom}–${b.ageTo}: ageFrom must be ≤ ageTo.` };
    }
    if (b.monthlyEmployeeCost < 0 || b.perPay26EmployeeCost < 0) {
      return { ok: false, error: "Age-band costs cannot be negative." };
    }
  }
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (cur.ageFrom <= prev.ageTo) {
      return {
        ok: false,
        error: `Overlapping age bands ${prev.ageFrom}–${prev.ageTo} and ${cur.ageFrom}–${cur.ageTo}.`,
      };
    }
  }
  return { ok: true };
}

export function resolveMedicalEmployeeCost(
  bands: AgeRateBand[],
  dateOfBirth: Date | null | undefined,
  asOf: Date,
): AgeRateBand | null {
  if (!dateOfBirth || Number.isNaN(dateOfBirth.getTime())) return null;
  const age = attainedAgeYears(dateOfBirth, asOf);
  return findAgeRateBand(bands, age);
}
