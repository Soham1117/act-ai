import { describe, expect, it } from "vitest";
import { createPortalTranslator } from "./core";
import { localizeNotification } from "./notifications";

describe("notification localization", () => {
  const es = createPortalTranslator("es");
  it("preserves historical and authored notification content without a known template", () => {
    const legacy = { title: "Admin's title", message: "Employee-specific instructions" };
    expect(localizeNotification(legacy, es)).toEqual(legacy);
    expect(localizeNotification({ ...legacy, translationKey: "unknown" }, es)).toEqual(legacy);
  });
  it("translates system templates and enums while retaining titles and notes", () => {
    const result = localizeNotification({ title: "Request approved", message: "English original", translationKey: "notificationTemplates.requestStatus", translationParams: { status: "APPROVED", title: "My custom request", note: "Call Alex" } }, es);
    expect(result.message).toContain("My custom request");
    expect(result.message).toContain("Call Alex");
    expect(result.message).toContain("Nota:");
    expect(result.message).toMatch(/aprobad/i);
    expect(result.message).not.toContain("{note}");
  });
  it("retains original English and formats US payroll currency in Spanish", () => {
    const notification = { title: "Original title", message: "Original message", translationKey: "notificationTemplates.reimbursementPaid", translationParams: { amount: 1234.5, title: "Receipt A", note: "", currency: "USD" } };
    expect(localizeNotification(notification, createPortalTranslator("en"))).toEqual({ title: notification.title, message: notification.message });
    expect(localizeNotification(notification, es).message).toContain("1,234.50");
  });
  it("localizes structured errors and uses a safe Spanish fallback", () => {
    expect(es.errorMessage({ error: "Original", errorCode: "errors.receiptLimit", errorParams: { count: 3 } })).toContain("3 recibos");
    expect(es.errorMessage({ error: "Internal English exception" })).not.toContain("Internal English");
    expect(createPortalTranslator("en").errorMessage({ error: "Existing English detail" })).toBe("Existing English detail");
    expect(createPortalTranslator("en").errorMessage({ error: "Specific original detail", errorCode: "errors.conflict" })).toBe("Specific original detail");
    const overlap = es.errorMessage({ error: "Original overlap", errorCode: "businessErrors.leave.overlap", errorParams: { status: "APPROVED", type: "SICK", startDate: "2026-01-01", endDate: "2026-01-02" } });
    expect(overlap).toMatch(/aprobado/i);
    expect(overlap).toMatch(/enfermedad/i);
    expect(overlap).toMatch(/ene/i);
  });
});
