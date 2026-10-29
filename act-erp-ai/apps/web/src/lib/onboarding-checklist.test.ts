import { describe, expect, it } from "vitest";
import { assertChecklistOwner, assertEvidenceOwner, canAssignTemplate, checklistComplete, handbookReceiptText } from "./onboarding-checklist";

describe("onboarding checklist boundaries", () => {
  const template = { status: "APPROVED", purpose: "ONBOARDING_TEMPLATE", document: { category: "ONBOARDING", isArchived: false } };
  it("allows only approved onboarding/handbook templates", () => {
    expect(canAssignTemplate(template)).toBe(true);
    expect(canAssignTemplate({ ...template, document: { ...template.document, category: "HANDBOOK" } })).toBe(true);
    for (const status of ["DRAFT", "REVOKED"]) expect(canAssignTemplate({ ...template, status })).toBe(false);
    expect(canAssignTemplate({ ...template, purpose: "HR_ONLY" })).toBe(false);
    expect(canAssignTemplate({ ...template, document: { ...template.document, isArchived: true } })).toBe(false);
    expect(canAssignTemplate({ ...template, document: { ...template.document, category: "PAYROLL_COMPLIANCE" } })).toBe(false);
  });
  it("requires both a real employee context and exact item/evidence ownership", () => {
    expect(() => assertChecklistOwner({ employeeId: "a" }, "a")).not.toThrow();
    expect(() => assertChecklistOwner({ employeeId: "a" }, "b")).toThrow();
    expect(() => assertChecklistOwner({ employeeId: null }, null)).toThrow();
    expect(() => assertEvidenceOwner({ employeeId: "b" }, "a")).toThrow();
    expect(() => assertEvidenceOwner(null, "a")).toThrow();
  });
  it("does not treat uploads or acknowledgments as HR acceptance", () => {
    expect(checklistComplete([{ required: true, status: "SUBMITTED" }])).toBe(false);
    expect(checklistComplete([{ required: true, status: "NEEDS_CORRECTION" }])).toBe(false);
    expect(checklistComplete([{ required: true, status: "ACCEPTED" }, { required: true, status: "NOT_APPLICABLE" }])).toBe(true);
    expect(checklistComplete([{ required: false, status: "NOT_STARTED" }])).toBe(true);
  });
  it("binds handbook receipt text to the reviewed title and version", () => {
    expect(handbookReceiptText("Employee handbook", 2)).toContain("Employee handbook, version 2");
    expect(handbookReceiptText("Employee handbook", 2)).not.toEqual(handbookReceiptText("Employee handbook", 3));
  });
});
