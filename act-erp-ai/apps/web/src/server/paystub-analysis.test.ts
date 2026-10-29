vi.mock("server-only", () => ({}));
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";

const mocks = vi.hoisted(() => ({ send: vi.fn(), destroy: vi.fn(), roster: vi.fn(), documents: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { AUTH_SECRET: "synthetic-test-secret", AWS_REGION: "us-east-2" } }));
vi.mock("@/lib/db", () => ({ db: { employee: { findMany: mocks.roster }, payroll: { findMany: mocks.documents } } }));
vi.mock("@/lib/storage", () => ({ uploadFile: vi.fn(), deleteFile: vi.fn() }));
vi.mock("@aws-sdk/client-textract", () => ({
  TextractClient: class { send = mocks.send; destroy = mocks.destroy; },
  DetectDocumentTextCommand: class { constructor(public input: unknown) {} },
}));
import { analyzePayrollSource } from "./paystub-analysis";

async function scan(pages = 1) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage();
  return { name: "scan.pdf", type: "application/pdf", bytes: Uint8Array.from(await doc.save()).buffer };
}
const lines = () => [
  "Employee Pay Stub Check number: FAKE-123 Pay Period: 03/01/2025 - 03/14/2025 Pay Date: 03/19/2025",
  "Jane Tester, 1 Fictional St, Testville, TX ***-**-9999",
  "Net Pay 1000.00",
].map((Text, i) => ({ BlockType: "LINE", Text, Confidence: 99, Geometry: { BoundingBox: { Top: 0.1 + i * 0.1 } } }));

beforeEach(() => { vi.clearAllMocks(); mocks.roster.mockResolvedValue([]); mocks.documents.mockResolvedValue([]); mocks.send.mockResolvedValue({ Blocks: lines() }); });

describe("paystub OCR fallback", () => {
  it("never calls OCR unless explicitly requested; an image-only page stays on hold", async () => {
    const preview = await analyzePayrollSource(await scan());
    expect(preview.pages[0].status).toBe("OCR_REQUIRED");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("sends exactly one page per OCR call and returns review metadata without amounts", async () => {
    const preview = await analyzePayrollSource(await scan(2), true);
    expect(mocks.send).toHaveBeenCalledTimes(2);
    for (const [command] of mocks.send.mock.calls) {
      const pdf = await PDFDocument.load(command.input.Document.Bytes);
      expect(pdf.getPageCount()).toBe(1);
    }
    expect(preview.pages.map((page) => page.status)).toEqual(["SUPPORTED", "SUPPORTED"]);
    expect(preview.pages[0].extraction).toBe("OCR");
    expect(preview.pages[0].parsed?.employeeName).toBe("Jane Tester");
    expect(preview.pages[0].parsed?.netPay).toBeNull();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
  it("holds low-confidence OCR, without returning an employee suggestion", async () => {
    const Blocks = lines(); Blocks[1].Confidence = 65;
    mocks.send.mockResolvedValue({ Blocks });
    const preview = await analyzePayrollSource(await scan(), true);
    expect(preview.pages[0].status).toBe("UNSUPPORTED");
    expect(preview.pages[0].parsed).toBeNull();
    expect(preview.pages[0].reason).toContain("confidence");
  });
  it("keeps OCR payroll summaries unsupported", async () => {
    mocks.send.mockResolvedValue({ Blocks: [{ ...lines()[0], Text: "Payroll Summary" }] });
    const preview = await analyzePayrollSource(await scan(), true);
    expect(preview.pages[0].status).toBe("UNSUPPORTED");
    expect(preview.pages[0].reason).toContain("summaries");
  });
  it("bounds the number of OCR pages before any provider request", async () => {
    await expect(analyzePayrollSource(await scan(11), true)).rejects.toThrow("up to 10 scanned pages");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("returns a safe provider failure and always destroys the client", async () => {
    mocks.send.mockRejectedValue(new Error("sensitive-provider-details"));
    await expect(analyzePayrollSource(await scan(), true)).rejects.toThrow("OCR is unavailable");
    expect(mocks.destroy).toHaveBeenCalledOnce();
    expect(mocks.documents).not.toHaveBeenCalled();
  });
});
