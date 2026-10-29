import type { ParsedPaystub } from "./paystub-parser";

export type EmployeeCandidate = { id: string; name: string; ssnLast4: string | null };

export type MatchResult = {
  employeeId: string | null;
  confidence: "high" | "medium" | "low" | "none";
  reason: string;
  /** Stub name agrees with the matched (or conflicting) roster name. */
  nameOk: boolean;
  /** Stub SSN last-4 agrees with the matched roster employee. */
  ssnOk: boolean;
};

function nameTokens(name: string): string[] {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['’\.]/g, "")
    .replace(/[()]/g, " ")
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter(Boolean);
}

function removeOne(list: string[], value: string): boolean {
  const index = list.indexOf(value);
  if (index === -1) return false;
  list.splice(index, 1);
  return true;
}

/**
 * Compare names for paystub matching. Multi-letter tokens must agree;
 * single-letter middle initials are optional and may stand in for a full
 * middle name (LOWELL T WILLIAMS ↔ Lowell Williams / Lowell Tristan Williams).
 * Conflicting initials (Jane A vs Jane B) still fail.
 */
function namesLikelyMatch(a: string, b: string): boolean {
  const tokensA = nameTokens(a);
  const tokensB = nameTokens(b);
  const wordsA = tokensA.filter((token) => token.length > 1);
  const wordsB = tokensB.filter((token) => token.length > 1);
  const initialsA = tokensA.filter((token) => token.length === 1);
  const initialsB = tokensB.filter((token) => token.length === 1);

  const remainingA = [...wordsA];
  const remainingB = [...wordsB];
  let sharedWords = 0;
  for (const word of [...remainingA]) {
    if (removeOne(remainingB, word)) {
      removeOne(remainingA, word);
      sharedWords++;
    }
  }

  const leftoverInitialsA = [...initialsA];
  const leftoverInitialsB = [...initialsB];

  for (const word of [...remainingA]) {
    const initIndex = leftoverInitialsB.findIndex(
      (init) => word.startsWith(init) && word.length > 1,
    );
    if (initIndex === -1) continue;
    leftoverInitialsB.splice(initIndex, 1);
    removeOne(remainingA, word);
    sharedWords++;
  }
  for (const word of [...remainingB]) {
    const initIndex = leftoverInitialsA.findIndex(
      (init) => word.startsWith(init) && word.length > 1,
    );
    if (initIndex === -1) continue;
    leftoverInitialsA.splice(initIndex, 1);
    removeOne(remainingB, word);
    sharedWords++;
  }

  if (remainingA.length > 0 || remainingB.length > 0) return false;
  if (sharedWords < 2) return false;

  // Leftover initials on both sides must agree; initials on only one side are OK.
  if (leftoverInitialsA.length > 0 && leftoverInitialsB.length > 0) {
    if (leftoverInitialsA.length !== leftoverInitialsB.length) return false;
    const sortedA = [...leftoverInitialsA].sort();
    const sortedB = [...leftoverInitialsB].sort();
    return sortedA.every((init, index) => init === sortedB[index]);
  }
  return true;
}

function result(
  employeeId: string | null,
  confidence: MatchResult["confidence"],
  reason: string,
  nameOk: boolean,
  ssnOk: boolean,
): MatchResult {
  return { employeeId, confidence, reason, nameOk, ssnOk };
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
    return result(null, "none", "No identifying fields extracted from this file.", false, false);
  }

  const ssnMatches =
    parsed.ssnLast4 && /^\d{4}$/.test(parsed.ssnLast4)
      ? roster.filter((e) => e.ssnLast4 === parsed.ssnLast4)
      : [];
  const nameMatches = parsed.employeeName
    ? roster.filter((e) => namesLikelyMatch(parsed.employeeName!, e.name))
    : [];

  if (ssnMatches.length === 1) {
    const candidate = ssnMatches[0];
    const nameAgrees = parsed.employeeName
      ? namesLikelyMatch(parsed.employeeName, candidate.name)
      : false;
    if (nameAgrees && nameMatches.length === 1) {
      return result(candidate.id, "high", "SSN last 4 and name both match.", true, true);
    }
    if (nameMatches.length === 1 && nameMatches[0].id !== candidate.id) {
      return result(
        null,
        "low",
        "The name and SSN last 4 point to different employees — select and confirm manually.",
        false,
        false,
      );
    }
    return result(
      candidate.id,
      "medium",
      "SSN last 4 matches one employee, but the name on the stub doesn't clearly match — please confirm.",
      false,
      true,
    );
  }

  if (ssnMatches.length > 1) {
    if (nameMatches.length === 1 && ssnMatches.some((e) => e.id === nameMatches[0].id)) {
      return result(
        nameMatches[0].id,
        "medium",
        `SSN last 4 matches ${ssnMatches.length} employees, but the name narrows it to one — please confirm.`,
        true,
        true,
      );
    }
    return result(
      null,
      "low",
      `SSN last 4 matches ${ssnMatches.length} employees and the name doesn't disambiguate — select manually.`,
      false,
      false,
    );
  }

  if (nameMatches.length === 1) {
    return result(
      nameMatches[0].id,
      "medium",
      "Matched by name only — SSN last 4 didn't match any employee on file — please confirm.",
      true,
      false,
    );
  }
  if (nameMatches.length > 1) {
    return result(
      null,
      "low",
      `Name matches ${nameMatches.length} employees — select manually.`,
      false,
      false,
    );
  }

  return result(null, "none", "No employee on file matches this stub — select manually.", false, false);
}
