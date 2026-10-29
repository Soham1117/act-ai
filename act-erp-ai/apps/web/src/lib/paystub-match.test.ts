import { describe, expect, it } from "vitest";
import { matchEmployee, type EmployeeCandidate } from "./paystub-match";
import type { ParsedPaystub } from "./paystub-parser";

const parsed = (overrides: Partial<ParsedPaystub> = {}): ParsedPaystub => ({
  employeeName: "Jane A Tester",
  ssnLast4: "9999",
  payPeriodStart: "2026-01-05",
  payPeriodEnd: "2026-01-18",
  payDate: "2026-01-22",
  checkNumber: "DD0001",
  netPay: 1000,
  ...overrides,
});

const roster: EmployeeCandidate[] = [
  { id: "emp-1", name: "Jane A Tester", ssnLast4: "9999" },
  { id: "emp-2", name: "John B Smith", ssnLast4: "1111" },
];

describe("matchEmployee", () => {
  it("matches reordered names, punctuation, case, and whitespace", () => {
    expect(
      matchEmployee(parsed({ employeeName: " TESTER, Jane A. " }), roster),
    ).toMatchObject({ employeeId: "emp-1", confidence: "high" });
  });

  it("never treats truncated first names or conflicting middle initials as equal", () => {
    expect(
      matchEmployee(parsed({ employeeName: "Jan Tester", ssnLast4: null }), roster)
        .employeeId,
    ).toBeNull();
    expect(
      matchEmployee(parsed({ employeeName: "Jane B Tester", ssnLast4: null }), roster)
        .employeeId,
    ).toBeNull();
  });

  it("treats a missing or stub-only middle initial as the same person", () => {
    // Roster has middle initial; stub omits it.
    expect(
      matchEmployee(parsed({ employeeName: "Jane Tester" }), roster),
    ).toMatchObject({ employeeId: "emp-1", confidence: "high", nameOk: true });
    // Stub has middle initial; roster does not (common ACT case).
    expect(
      matchEmployee(parsed({ employeeName: "LOWELL T WILLIAMS", ssnLast4: "5555" }), [
        { id: "emp-9", name: "Lowell Williams", ssnLast4: "5555" },
      ]),
    ).toMatchObject({ employeeId: "emp-9", confidence: "high", nameOk: true });
    // Stub initial matches a full middle name on file.
    expect(
      matchEmployee(parsed({ employeeName: "LOWELL T WILLIAMS", ssnLast4: "5555" }), [
        { id: "emp-9", name: "Lowell Tristan Williams", ssnLast4: "5555" },
      ]),
    ).toMatchObject({ employeeId: "emp-9", confidence: "high", nameOk: true });
  });

  it("does not select an employee when name and identifier point to different people", () => {
    expect(matchEmployee(parsed({ employeeName: "John B Smith" }), roster)).toMatchObject(
      { employeeId: null, confidence: "low" },
    );
  });

  it("requires confirmation when the name collides even if last four is unique", () => {
    expect(
      matchEmployee(parsed(), [
        ...roster,
        { id: "emp-3", name: "Jane A Tester", ssnLast4: "2222" },
      ]),
    ).toMatchObject({ employeeId: "emp-1", confidence: "medium" });
  });

  it("does not select from identical name and identifier collisions", () => {
    expect(
      matchEmployee(parsed(), [
        ...roster,
        { id: "emp-3", name: "Jane A Tester", ssnLast4: "9999" },
      ]),
    ).toMatchObject({ employeeId: null, confidence: "low" });
  });
  it("returns high confidence when SSN last 4 and name both match uniquely", () => {
    const result = matchEmployee(parsed(), roster);
    expect(result).toMatchObject({ employeeId: "emp-1", confidence: "high" });
  });

  it("returns medium confidence when SSN last 4 matches but the name looks different", () => {
    const result = matchEmployee(
      parsed({ employeeName: "Someone Else Entirely" }),
      roster,
    );
    expect(result).toMatchObject({ employeeId: "emp-1", confidence: "medium" });
  });

  it("returns low confidence with no pre-selection on an SSN last-4 collision the name can't resolve", () => {
    const collidingRoster: EmployeeCandidate[] = [
      { id: "emp-1", name: "Jane A Tester", ssnLast4: "9999" },
      { id: "emp-3", name: "Someone Unrelated", ssnLast4: "9999" },
    ];
    const result = matchEmployee(
      parsed({ employeeName: "Neither Of These" }),
      collidingRoster,
    );
    expect(result).toMatchObject({ employeeId: null, confidence: "low" });
  });

  it("resolves an SSN last-4 collision via a unique name match", () => {
    const collidingRoster: EmployeeCandidate[] = [
      { id: "emp-1", name: "Jane A Tester", ssnLast4: "9999" },
      { id: "emp-3", name: "Someone Unrelated", ssnLast4: "9999" },
    ];
    const result = matchEmployee(parsed(), collidingRoster);
    expect(result).toMatchObject({ employeeId: "emp-1", confidence: "medium" });
  });

  it("returns none when neither SSN last 4 nor name match anyone", () => {
    const result = matchEmployee(
      parsed({ ssnLast4: "0000", employeeName: "Nobody Here" }),
      roster,
    );
    expect(result).toMatchObject({ employeeId: null, confidence: "none" });
  });

  it("returns none when no identifying fields were extracted at all", () => {
    const result = matchEmployee(parsed({ ssnLast4: null, employeeName: null }), roster);
    expect(result).toMatchObject({ employeeId: null, confidence: "none" });
  });
});
