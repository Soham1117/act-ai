import { beforeEach, describe, expect, it, vi } from "vitest";
const crypto = vi.hoisted(() => ({ encrypt: vi.fn(), decrypt: vi.fn() }));
vi.mock("./sensitive-data", () => ({
  encryptSensitiveJson: crypto.encrypt,
  decryptSensitiveJson: crypto.decrypt,
  SensitiveDataError: class extends Error { constructor() { super("Secure storage unavailable"); } },
}));
import {
  decryptHirePacketFields, encryptHirePacketFields, safeHirePacketError,
  HIRE_PACKET_FAILURE_MESSAGE,
} from "./hire-packet-sensitive-data";

beforeEach(() => vi.resetAllMocks());
describe("hire-packet sensitive fields", () => {
  it("seals proposals and file metadata with distinct job-bound contexts", async () => {
    crypto.encrypt.mockImplementation(async (_value, context) => ({ ciphertext: `sealed:${context.field}` }));
    const fields = { proposedFields: { ssnLast4: { value: "0000", confidence: "high" as const, sourceFile: "dummy.pdf", sourceForm: "W4" as const } }, fileResults: [] };
    const sealed = await encryptHirePacketFields("opaque-job", fields);
    expect(crypto.encrypt).toHaveBeenCalledWith(fields.proposedFields, { purpose: "hire-packet-import", recordId: "opaque-job", field: "proposedFields" });
    expect(crypto.encrypt).toHaveBeenCalledWith([], { purpose: "hire-packet-import", recordId: "opaque-job", field: "fileResults" });
    expect(JSON.stringify(sealed)).not.toContain("0000");
    expect(JSON.stringify(sealed)).not.toContain("dummy.pdf");
  });

  it("does not return partially protected results when KMS fails", async () => {
    crypto.encrypt.mockRejectedValue(new Error("KMS unavailable"));
    await expect(encryptHirePacketFields("opaque-job", { proposedFields: {}, fileResults: [] })).rejects.toThrow("KMS unavailable");
  });

  it("decrypts both fields with the original job binding", async () => {
    crypto.decrypt.mockResolvedValueOnce({}).mockResolvedValueOnce([]);
    expect(await decryptHirePacketFields("opaque-job", { proposedFields: "sealed-proposals", fileResults: "sealed-files" })).toEqual({ proposedFields: {}, fileResults: [] });
    expect(crypto.decrypt).toHaveBeenCalledWith("sealed-proposals", { purpose: "hire-packet-import", recordId: "opaque-job", field: "proposedFields" });
    expect(crypto.decrypt).toHaveBeenCalledWith("sealed-files", { purpose: "hire-packet-import", recordId: "opaque-job", field: "fileResults" });
  });

  it("rejects mismatched data shapes rather than displaying bogus proposals", async () => {
    crypto.decrypt.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await expect(decryptHirePacketFields("opaque-job", { proposedFields: {}, fileResults: [] })).rejects.toThrow();
  });

  it("never displays raw worker errors or OCR values", () => {
    expect(safeHirePacketError("Private Dummy 000-00-0000 in dummy.pdf")).toBe(HIRE_PACKET_FAILURE_MESSAGE);
    expect(safeHirePacketError(null)).toBeNull();
    expect(safeHirePacketError("")).toBeNull();
  });
});
