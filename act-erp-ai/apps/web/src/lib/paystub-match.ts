import type { ParsedPaystub } from "./paystub-parser";

export type EmployeeCandidate = { id: string; name: string; ssnLast4: string | null };

export type MatchResult = {
  employeeId: string | null;
  confidence: "high" | "medium" | "low" | "none";
  reason: string;
};

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** True if every word in `a` appears somewhere in `b` (order-independent —
 * handles "Sohamkumar R Patel" vs a roster entry stored as "Patel, Sohamkumar R" etc). */
function namesLikelyMatch(a: string, b: string): boolean {
  const wordsA = normalizeName(a).split(" ").filter((w) => w.length > 1);
  const normB = normalizeName(b);
  if (wordsA.length === 0) return false;
  return wordsA.every((w) => normB.includes(w));
}

/**
 * Matches a parsed paystub to exactly one employee, or explains why it
 * can't. Never guesses past what SSN-last-4 and name actually support —
 * `ssnLast4` alone has a real collision rate at this company's headcount
 * (noted on the schema), so a bare last-4 match without a name match, or a
 * last-4 collision across multiple employees, is only ever "medium" or
 * lower and must be confirmed by a human before anything is saved.
 */
export function matchEmployee(
  parsed: ParsedPaystub,
  roster: EmployeeCandidate[],
): MatchResult {
  if (!parsed.ssnLast4 && !parsed.employeeName) {
    return { employeeId: null, confidence: "none", reason: "No identifying fields extracted from this file." };
  }

  const ssnMatches = parsed.ssnLast4
    ? roster.filter((e) => e.ssnLast4 === parsed.ssnLast4)
    : [];
  const nameMatches = parsed.employeeName
    ? roster.filter((e) => namesLikelyMatch(parsed.employeeName!, e.name))
    : [];

  if (ssnMatches.length === 1) {
    const candidate = ssnMatches[0];
    const nameAgrees = parsed.employeeName ? namesLikelyMatch(parsed.employeeName, candidate.name) : false;
    if (nameAgrees) {
      return { employeeId: candidate.id, confidence: "high", reason: "SSN last 4 and name both match." };
    }
    return {
      employeeId: candidate.id,
      confidence: "medium",
      reason: "SSN last 4 matches one employee, but the name on the stub doesn't clearly match — please confirm.",
    };
  }

  if (ssnMatches.length > 1) {
    if (nameMatches.length === 1 && ssnMatches.some((e) => e.id === nameMatches[0].id)) {
      return {
        employeeId: nameMatches[0].id,
        confidence: "medium",
        reason: `SSN last 4 matches ${ssnMatches.length} employees, but the name narrows it to one — please confirm.`,
      };
    }
    return {
      employeeId: null,
      confidence: "low",
      reason: `SSN last 4 matches ${ssnMatches.length} employees and the name doesn't disambiguate — select manually.`,
    };
  }

  // No SSN match (or none extracted) — fall back to name only.
  if (nameMatches.length === 1) {
    return {
      employeeId: nameMatches[0].id,
      confidence: "medium",
      reason: "Matched by name only — SSN last 4 didn't match any employee on file — please confirm.",
    };
  }
  if (nameMatches.length > 1) {
    return {
      employeeId: null,
      confidence: "low",
      reason: `Name matches ${nameMatches.length} employees — select manually.`,
    };
  }

  return { employeeId: null, confidence: "none", reason: "No employee on file matches this stub — select manually." };
}
