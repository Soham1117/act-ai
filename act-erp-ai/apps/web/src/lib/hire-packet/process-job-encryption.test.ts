import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), findDocs: vi.fn(), createDoc: vi.fn(), encrypt: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  hirePacketImport: { findUnique: mocks.find, updateMany: mocks.update },
  document: { findMany: mocks.findDocs, deleteMany: vi.fn(), create: mocks.createDoc },
} }));
vi.mock("@/lib/storage", () => ({
  uploadFile: vi.fn(), deleteFile: vi.fn(),
  getObjectStream: async () => ({ stream: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); controller.close(); } }) }),
}));
vi.mock("@/lib/upload-validation", () => ({ validateUpload: () => ({ ok: true, contentType: "application/pdf", safeFileName: "dummy.pdf" }) }));
vi.mock("@/lib/hire-packet/zip", () => ({ unzipHirePacket: () => [{ fileName: "private-dummy.pdf", bytes: Buffer.from("fixture") }] }));
vi.mock("@/lib/hire-packet/extract/classify", () => ({ classifyHireDocument: () => "W4" }));
vi.mock("@/lib/hire-packet/extract/pdf-text", () => ({ extractPdfText: async () => "Dummy OCR private details ".repeat(20) }));
vi.mock("@/lib/hire-packet/extract/textract", () => ({ textractText: vi.fn() }));
vi.mock("@/lib/hire-packet/extract/templates", () => ({
  extractFromTemplate: () => ({ ssnLast4: { value: "0000" } }),
  mergeProposals: (layers: unknown[]) => layers[0],
}));
vi.mock("@/lib/hire-packet/extract/llm", () => ({ llmFillGaps: async (_text: string, existing: unknown) => existing }));
vi.mock("@/server/hire-packet-sensitive-data", () => ({
  encryptHirePacketFields: mocks.encrypt,
  HIRE_PACKET_FAILURE_MESSAGE: "Generic safe import failure",
}));
import { processHirePacketJob } from "./process-job";
const sealed = { proposedFields: { ciphertext: "sealed-proposals" }, fileResults: { ciphertext: "sealed-results" } };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.find.mockResolvedValue({ id: "opaque-job", employeeId: "opaque-employee", uploadedById: "opaque-admin", status: "PENDING", zipStorageKey: "fixture.zip", zipFileName: "dummy.zip" });
  mocks.update.mockResolvedValue({ count: 1 });
  mocks.findDocs.mockResolvedValue([]);
  mocks.createDoc.mockResolvedValue({ id: "opaque-doc" });
  mocks.encrypt.mockResolvedValue(sealed);
});
describe("hire packet worker encryption", () => {
  it("stores only protected extraction results when making a job READY", async () => {
    await processHirePacketJob("opaque-job");
    const ready = mocks.update.mock.calls.map(call => call[0]).find(call => call.data.status === "READY");
    expect(ready).toMatchObject({ where: { id: "opaque-job", status: "PROCESSING" }, data: { status: "READY", ...sealed, errorMessage: null } });
    expect(JSON.stringify(ready)).not.toContain("0000");
    expect(JSON.stringify(ready)).not.toContain("private-dummy.pdf");
    expect(mocks.encrypt).toHaveBeenCalledWith("opaque-job", expect.objectContaining({ proposedFields: { ssnLast4: { value: "0000" } }, fileResults: expect.any(Array) }));
  });

  it("never writes READY/plaintext on encryption failure and stores only a generic error", async () => {
    mocks.encrypt.mockRejectedValue(new Error("Private Dummy 000-00-0000 private-dummy.pdf"));
    await expect(processHirePacketJob("opaque-job")).rejects.toThrow("Generic safe import failure");
    const updates = mocks.update.mock.calls.map(call => call[0]);
    expect(updates.some(call => call.data.status === "READY")).toBe(false);
    expect(updates.find(call => call.data.status === "FAILED")).toMatchObject({
      data: { status: "FAILED", errorMessage: "Generic safe import failure" },
    });
    expect(JSON.stringify(updates)).not.toContain("000-00-0000");
    expect(JSON.stringify(updates)).not.toContain("private-dummy.pdf");
    expect(mocks.findDocs).toHaveBeenCalledTimes(2);
  });
});
