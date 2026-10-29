vi.mock("server-only", () => ({}));
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import type { BatchDecision, BatchPage, BatchPreview } from "@/lib/paystub-import";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), analyze: vi.fn(), persist: vi.fn(), receipt: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.admin }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("@/lib/env", () => ({ env: { AUTH_SECRET: "synthetic-test-secret" } }));
vi.mock("@/lib/db", () => ({ db: { payroll: { findUnique: mocks.receipt } } }));
vi.mock("@/server/paystub-persistence", () => ({ persistPayrollDocument: mocks.persist }));
vi.mock("@/server/paystub-analysis", async (original) => ({ ...await original<typeof import("./paystub-analysis")>(), analyzePayrollSource: mocks.analyze }));
import { confirmPaystubBatch, previewPaystubBatch } from "./actions/paystub-batch";

const sourceHash = "a".repeat(64);
const token = "b".repeat(64);
const actor = { id: "admin-test", email: "admin@example.test" };
const parsed = { employeeName: "Synthetic Person", ssnLast4: "0000", payPeriodStart: "2026-10-01", payPeriodEnd: "2026-10-14", payDate: "2026-10-16", checkNumber: "TEST-1", netPay: null };
const page = (changes: Partial<BatchPage> = {}): BatchPage => ({ pageNumber: 1, status: "SUPPORTED", reason: null, parsed: { ...parsed }, match: { employeeId: "employee-a", confidence: "high", reason: "Synthetic evidence agrees", nameOk: true, ssnOk: true }, reviewToken: token, duplicates: [], extraction: "TEXT", ...changes });
const decision = (changes: Partial<BatchDecision> = {}): BatchDecision => ({ pageNumber: 1, employeeId: "employee-a", payPeriodStart: "2026-10-01", payPeriodEnd: "2026-10-14", reviewToken: token, confirmed: true, duplicateMode: "KEEP", ...changes });
let source: { name: string; type: string; bytes: ArrayBuffer };
let preview: BatchPreview;
const confirm = (rows = [decision()], hash = sourceHash) => confirmPaystubBatch({ sourceHash: hash, ocr: false, rows }, source);

beforeEach(async () => {
  vi.resetAllMocks();
  const pdf = await PDFDocument.create();
  pdf.addPage([101, 201]); pdf.addPage([102, 202]);
  source = { name: "synthetic-combined.pdf", type: "application/pdf", bytes: Uint8Array.from(await pdf.save()).buffer };
  preview = { sourceHash, pageCount: 2, pages: [page(), page({ pageNumber: 2 })], rosterHash: "d".repeat(64) };
  mocks.admin.mockResolvedValue(actor);
  mocks.analyze.mockImplementation(async () => preview);
  mocks.receipt.mockResolvedValue(null);
  mocks.persist.mockImplementation(async (input) => ({ pageNumber: input.provenance.sourcePage, status: "SAVED", id: `saved-${input.provenance.sourcePage}` }));
});

describe("reviewed batch server actions", () => {
  it("requires admin on direct preview and confirm calls before parsing or persistence", async () => {
    mocks.admin.mockRejectedValue(new Error("Not authorized"));
    await expect(previewPaystubBatch(source)).rejects.toThrow("Not authorized");
    await expect(confirm()).rejects.toThrow("Not authorized");
    expect(mocks.analyze).not.toHaveBeenCalled(); expect(mocks.persist).not.toHaveBeenCalled();
  });
  it("preview is transient and OCR only runs on explicit request", async () => {
    expect(await previewPaystubBatch(source)).toMatchObject({ ok: true, sourceHash });
    expect(mocks.analyze).toHaveBeenLastCalledWith(source, false);
    await previewPaystubBatch(source, { ocr: true });
    expect(mocks.analyze).toHaveBeenLastCalledWith(source, true);
    expect(mocks.persist).not.toHaveBeenCalled(); expect(mocks.receipt).not.toHaveBeenCalled();
  });
  it("blocks source substitution and overlapping selected pages without writing", async () => {
    expect(await confirm([decision()], "c".repeat(64))).toMatchObject({ ok: false, error: expect.stringMatching(/source file changed/i) });
    mocks.analyze.mockClear();
    expect(await confirm([decision(), decision()])).toMatchObject({ ok: false, error: expect.stringMatching(/only.*once/i) });
    expect(mocks.analyze).not.toHaveBeenCalled(); expect(mocks.persist).not.toHaveBeenCalled();
  });
  it.each([false, undefined])("requires explicit confirmation (%s)", async (confirmed) => {
    const row = { ...decision(), confirmed } as unknown as BatchDecision;
    expect(await confirm([row])).toMatchObject({ ok: false });
    expect(mocks.analyze).not.toHaveBeenCalled(); expect(mocks.persist).not.toHaveBeenCalled();
  });
  it.each(["UNSUPPORTED", "OCR_REQUIRED"] as const)("refuses %s pages even with a manually chosen employee", async (status) => {
    preview.pages[0] = page({ status, parsed: null, reason: "This page cannot be safely separated" });
    expect(await confirm()).toMatchObject({ ok: true, results: [{ status: "FAILED", error: "This page cannot be safely separated" }] });
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it("returns a row for review when source or roster evidence changes", async () => {
    preview.pages[0].reviewToken = "c".repeat(64);
    expect(await confirm()).toMatchObject({ ok: true, results: [{ status: "FAILED", error: expect.stringMatching(/source or roster evidence changed/i) }] });
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it.each(["manual", "medium", "OCR"])("requires a reason for %s identity review", async (kind) => {
    if (kind === "medium") preview.pages[0].match.confidence = "medium";
    if (kind === "OCR") preview.pages[0].extraction = "OCR";
    const row = decision(kind === "manual" ? { employeeId: "employee-b" } : {});
    expect(await confirm([row])).toMatchObject({ ok: true, results: [{ status: "FAILED", error: expect.stringMatching(/reason confirming this employee/i) }] });
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(await confirm([{ ...row, overrideReason: "Verified synthetic employee evidence" }])).toMatchObject({ ok: true, results: [{ status: "SAVED" }] });
  });
  it("requires a date correction reason and rejects impossible or reversed periods", async () => {
    expect(await confirm([decision({ payPeriodEnd: "2026-02-30" })])).toMatchObject({ ok: false });
    expect(await confirm([decision({ payPeriodEnd: "2026-09-30", dateReason: "Confirmed" })])).toMatchObject({ ok: true, results: [{ status: "FAILED", error: expect.stringMatching(/before the start/i) }] });
    expect(await confirm([decision({ payPeriodEnd: "2026-10-15" })])).toMatchObject({ ok: true, results: [{ status: "FAILED", error: expect.stringMatching(/correction with a reason/i) }] });
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(await confirm([decision({ payPeriodEnd: "2026-10-15", dateReason: "Corrected provider typo" })])).toMatchObject({ ok: true, results: [{ status: "SAVED" }] });
  });
  it("requires a specific versioned replacement target", async () => {
    expect(await confirm([decision({ duplicateMode: "REPLACE", replaceId: "old-stub" })])).toMatchObject({ ok: true, results: [{ status: "FAILED", error: expect.stringMatching(/specific existing document/i) }] });
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it("returns a retry receipt without publishing again, but blocks changed assignments", async () => {
    mocks.receipt.mockResolvedValue({ id: "existing", employeeId: "employee-a", payPeriodStart: new Date("2026-10-01"), payPeriodEnd: new Date("2026-10-14") });
    expect(await confirm()).toMatchObject({ ok: true, results: [{ status: "EXISTING", id: "existing" }] });
    expect(await confirm([decision({ employeeId: "employee-b", overrideReason: "Different person" })])).toMatchObject({ ok: true, results: [{ status: "FAILED", error: expect.stringMatching(/different employee or period/i) }] });
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it("passes only the exact server-generated page and sanitized provenance to persistence", async () => {
    source.name = "folder\\synthetic.pdf";
    expect(await confirm([decision({ pageNumber: 2 })])).toMatchObject({ ok: true, results: [{ pageNumber: 2, status: "SAVED" }] });
    const input = mocks.persist.mock.calls[0][0];
    const fragment = await PDFDocument.load(input.bytes);
    expect(fragment.getPageCount()).toBe(1); expect(fragment.getPage(0).getSize()).toEqual({ width: 102, height: 202 });
    expect(input).toMatchObject({ actor, expectedRosterHash: preview.rosterHash, employeeId: "employee-a", category: "Pay Stub", provenance: { sourceSha256: sourceHash, sourcePage: 2, sourceFileName: "folder_synthetic.pdf", payDate: "2026-10-16", checkReference: "TEST-1" } });
    expect(new Uint8Array(input.bytes)).not.toEqual(new Uint8Array(source.bytes));
  });
  it("keeps successful row receipts when another row fails", async () => {
    mocks.persist.mockRejectedValueOnce(new Error("Storage temporarily unavailable"));
    expect(await confirm([decision(), decision({ pageNumber: 2 })])).toMatchObject({ ok: true, results: [{ pageNumber: 1, status: "FAILED" }, { pageNumber: 2, status: "SAVED" }] });
    expect(mocks.refresh).toHaveBeenCalledWith("/admin/payroll");
  });
  it("returns saved receipts with a refresh warning when cache invalidation fails after commit", async () => {
    mocks.refresh.mockImplementation(() => { throw new Error("Cache unavailable"); });
    expect(await confirm()).toMatchObject({ ok: true, results: [{ status: "SAVED", id: "saved-1", warning: expect.stringMatching(/saved successfully/i) }] });
    expect(mocks.persist).toHaveBeenCalledTimes(1);
  });
  it("does not copy annotation links or attached page metadata that reference another employee page", async () => {
    const pdf = await PDFDocument.load(source.bytes);
    const chosen = pdf.getPage(0);
    const hiddenPage = pdf.getPage(1);
    const link = pdf.context.register(pdf.context.obj({ Type: "Annot", Subtype: "Link", Dest: [hiddenPage.ref, "Fit"] }));
    chosen.node.set(PDFName.of("Annots"), pdf.context.obj([link]));
    for (const key of ["AA", "Metadata", "PieceInfo", "AF", "PresSteps"]) chosen.node.set(PDFName.of(key), hiddenPage.ref);
    source.bytes = Uint8Array.from(await pdf.save()).buffer;
    expect(await confirm()).toMatchObject({ ok: true, results: [{ status: "SAVED" }] });
    const fragment = await PDFDocument.load(mocks.persist.mock.calls[0][0].bytes);
    for (const key of ["Annots", "AA", "Metadata", "PieceInfo", "AF", "PresSteps"]) expect(fragment.getPage(0).node.has(PDFName.of(key))).toBe(false);
    const copiedPageObjects = fragment.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFDict && object.get(PDFName.of("Type")) === PDFName.of("Page"));
    expect(copiedPageObjects).toHaveLength(1);
  });
});
