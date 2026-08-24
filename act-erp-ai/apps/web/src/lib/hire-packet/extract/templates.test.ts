import { describe, expect, it } from "vitest";
import {
  extractFromTemplate,
  mergeProposals,
  normalizeDate,
} from "./templates";

describe("normalizeDate", () => {
  it("passes through ISO dates", () => {
    expect(normalizeDate("2024-03-15")).toBe("2024-03-15");
  });

  it("converts M/D/YYYY to ISO", () => {
    expect(normalizeDate("3/5/2024")).toBe("2024-03-05");
    expect(normalizeDate("12/31/99")).toBe("2099-12-31");
  });

  it("returns null for garbage", () => {
    expect(normalizeDate("not-a-date")).toBeNull();
  });
});

describe("extractFromTemplate — I-9", () => {
  const i9Text = `
Form I-9 Employment Eligibility Verification
Last Name (Family Name): Smith
First Name (Given Name): Jane
Date of Birth: 01/15/1990
Address: 123 Main St
Springfield, IL 62701
Emergency Contact: John Smith
Social Security Number: ***-**-6789
  `.trim();

  it("extracts name, DOB, address, emergency, SSN last 4", () => {
    const out = extractFromTemplate(i9Text, "i9.pdf", "I9");
    expect(out.name?.value).toBe("Jane Smith");
    expect(out.dateOfBirth?.value).toBe("1990-01-15");
    expect(out.address?.value).toContain("123 Main St");
    expect(out.city?.value).toBe("Springfield");
    expect(out.state?.value).toBe("IL");
    expect(out.zipCode?.value).toBe("62701");
    expect(out.emergencyName?.value).toBe("John Smith");
    expect(out.ssnLast4?.value).toBe("6789");
  });
});

describe("extractFromTemplate — W-4", () => {
  it("maps marital status from filing status text", () => {
    const out = extractFromTemplate(
      "Form W-4\nMarried filing jointly\nEmployee email: jane@example.com",
      "w4.pdf",
      "W4",
    );
    expect(out.maritalStatus?.value).toBe("MARRIED");
    expect(out.personalEmail?.value).toBe("jane@example.com");
  });
});

describe("extractFromTemplate — offer letter", () => {
  it("extracts job title and hire date", () => {
    const out = extractFromTemplate(
      "Dear Jane Smith,\nPosition: Field Technician\nDate of Hire: 6/1/2025",
      "offer.pdf",
      "OFFER_LETTER",
    );
    expect(out.jobTitle?.value).toBe("Field Technician");
    expect(out.dateOfHire?.value).toBe("2025-06-01");
    expect(out.name?.value).toBe("Jane Smith");
  });
});

describe("mergeProposals", () => {
  it("keeps higher-confidence values", () => {
    const merged = mergeProposals([
      { phoneNumber: { value: "5551112222", confidence: "low", sourceFile: "a.pdf", sourceForm: "UNKNOWN" } },
      { phoneNumber: { value: "5553334444", confidence: "high", sourceFile: "i9.pdf", sourceForm: "I9" } },
    ]);
    expect(merged.phoneNumber?.value).toBe("5553334444");
    expect(merged.phoneNumber?.confidence).toBe("high");
  });
});
