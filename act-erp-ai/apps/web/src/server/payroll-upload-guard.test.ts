vi.mock("server-only", () => ({}));
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { BatchPreview } from "@/lib/paystub-import";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), analyze: vi.fn(), persist: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/storage", () => ({ deleteFile: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { AUTH_SECRET: "synthetic-test-secret" } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("@/server/paystub-persistence", () => ({ persistPayrollDocument: mocks.persist }));
vi.mock("@/server/paystub-analysis", async (original) => ({ ...await original<typeof import("./paystub-analysis")>(), analyzePayrollSource: mocks.analyze }));
import { previewPaystub, uploadPayrollDocument } from "./actions/payroll";

const input = { employeeId: "employee-a", title: "Synthetic pay document", category: "Pay Stub", payPeriodStart: "2026-10-01", payPeriodEnd: "2026-10-14" };
const preview: BatchPreview = { sourceHash: "a".repeat(64), rosterHash: "b".repeat(64), pageCount: 1, pages: [{ pageNumber: 1, status: "SUPPORTED", reason: null, parsed: { employeeName: "Synthetic Person", ssnLast4: "0000", payPeriodStart: input.payPeriodStart, payPeriodEnd: input.payPeriodEnd, payDate: "2026-10-16", checkNumber: "TEST-1", netPay: null }, match: { employeeId: "employee-a", confidence: "high", reason: "Synthetic evidence agrees", nameOk: true, ssnOk: true }, reviewToken: "c".repeat(64), duplicates: [], extraction: "TEXT" }] };
async function pdfFile(kind: "stub" | "combined" | "summary" | "letter") {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < (kind === "combined" ? 2 : 1); i++) {
    const page = pdf.addPage();
    if (kind === "stub" || kind === "combined") {
      page.drawText("Employee Pay Stub  Check number: TEST-1  Pay Period: 10/01/2026 - 10/14/2026  Pay Date: 10/16/2026", { x: 22, y: 531, font, size: 8 });
      page.drawText(`${i ? "Another Synthetic Person" : "Synthetic Person"}, 1 Test St, Testville, TX ***-**-0000`, { x: 22, y: 501, font, size: 8 });
    } else page.drawText(kind === "summary" ? "Payroll Summary" : "This is a synthetic bonus letter.", { x: 22, y: 531, font, size: 10 });
  }
  return { name: "renamed-document.pdf", type: "application/pdf", bytes: Uint8Array.from(await pdf.save()).buffer };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.admin.mockResolvedValue({ id: "admin-test" });
  mocks.analyze.mockResolvedValue(preview); mocks.persist.mockResolvedValue({ status: "SAVED", id: "saved-stub", replaced: 0 });
});

describe("legacy payroll upload guard", () => {
  it("requires admin on direct legacy upload and preview calls", async () => {
    mocks.admin.mockRejectedValue(new Error("Not authorized"));
    const file = await pdfFile("stub");
    await expect(uploadPayrollDocument(input, file)).rejects.toThrow("Not authorized");
    await expect(previewPaystub(file)).rejects.toThrow("Not authorized");
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it.each(["Pay Stub", "Bonus letter"])("blocks multiple employee pages regardless of category %s", async (category) => {
    expect(await uploadPayrollDocument({ ...input, category }, await pdfFile("combined"))).toMatchObject({ ok: false, error: expect.stringMatching(/combined paystubs|batch flow/i) });
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it("blocks a renamed payroll summary under an unrelated category", async () => {
    expect(await uploadPayrollDocument({ ...input, category: "Other document" }, await pdfFile("summary"))).toMatchObject({ ok: false, error: expect.stringMatching(/summaries|batch flow/i) });
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it("rejects corrupt PDF bytes even when renamed as a generic payroll document", async () => {
    const file = { name: "other.pdf", type: "application/pdf", bytes: new TextEncoder().encode("%PDF-corrupt synthetic document").buffer };
    expect(await uploadPayrollDocument({ ...input, category: "Other" }, file)).toMatchObject({ ok: false });
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it("preserves valid non-paystub payroll PDFs", async () => {
    expect(await uploadPayrollDocument({ ...input, category: "Bonus letter" }, await pdfFile("letter"))).toMatchObject({ ok: true, id: "saved-stub" });
    expect(mocks.persist).toHaveBeenCalledWith(expect.objectContaining({ category: "Bonus letter" }));
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
  it("keeps single-stub uploads on the reviewed shared persistence path", async () => {
    expect(await uploadPayrollDocument(input, await pdfFile("stub"))).toMatchObject({ ok: true, id: "saved-stub" });
    expect(mocks.persist.mock.calls[0][0].expectedRosterHash).toBe(preview.rosterHash);
    expect(mocks.persist.mock.calls[0][0].provenance).toMatchObject({ sourceSha256: preview.sourceHash, sourcePage: 1 });
  });
  it("does not bypass identity review by changing a known paystub's category", async () => {
    expect(await uploadPayrollDocument({ ...input, employeeId: "employee-b", category: "Other" }, await pdfFile("stub"))).toMatchObject({ ok: false, error: expect.stringMatching(/explicit review|batch flow/i) });
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it("does not broadly overwrite a period through the legacy API", async () => {
    expect(await uploadPayrollDocument({ ...input, overwrite: true }, await pdfFile("stub"))).toMatchObject({ ok: false, error: expect.stringMatching(/specific document/i) });
    expect(mocks.persist).not.toHaveBeenCalled();
  });
});
