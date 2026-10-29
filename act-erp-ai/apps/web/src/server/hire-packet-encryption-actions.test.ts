import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  admin: vi.fn(), find: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(),
  employee: vi.fn(), upload: vi.fn(), encrypt: vi.fn(), decrypt: vi.fn(), apply: vi.fn(),
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/lib/db", () => ({ db: {
  employee: { findUnique: mocks.employee },
  hirePacketImport: { findUnique: mocks.find, create: mocks.create, update: mocks.update, updateMany: mocks.update, delete: mocks.remove },
} }));
vi.mock("@/lib/storage", () => ({ uploadFile: mocks.upload, deleteFile: vi.fn() }));
vi.mock("@/lib/upload-validation", () => ({ validateUpload: () => ({ ok: true, safeFileName: "dummy.zip", contentType: "application/zip" }) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/hire-packet/process-job", () => ({ claimAndProcessHirePacketJob: vi.fn() }));
vi.mock("@/server/actions/employees", () => ({ updateEmployee: mocks.apply }));
vi.mock("@/server/hire-packet-sensitive-data", () => ({
  encryptHirePacketFields: mocks.encrypt,
  decryptHirePacketFields: mocks.decrypt,
  safeHirePacketError: (value: unknown) => value ? "Generic safe import failure" : null,
}));
import {
  uploadHirePacketZip, getHirePacketImportStatus, applyHirePacketImport,
  retryHirePacketImport, cancelHirePacketImport,
} from "./actions/hire-packet";
const job = { id: "opaque-job", employeeId: "opaque-employee", status: "READY", updatedAt: new Date(), errorMessage: "Private Dummy 000-00-0000", proposedFields: { ciphertext: "fixture" }, fileResults: { ciphertext: "fixture" } };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.admin.mockResolvedValue({ id: "opaque-admin" });
  mocks.find.mockResolvedValue(job);
  mocks.employee.mockResolvedValue({ id: "opaque-employee" });
});
describe("hire packet encryption action boundaries", () => {
  it("requires admin authorization before storage, DB reads, or decryption", async () => {
    mocks.admin.mockRejectedValue(new Error("Forbidden"));
    for (const call of [
      () => uploadHirePacketZip("opaque-employee", { name: "dummy.zip", bytes: new ArrayBuffer(1) }),
      () => getHirePacketImportStatus("opaque-job"),
      () => applyHirePacketImport({ jobId: "opaque-job", selectedFields: ["name"] }),
      () => retryHirePacketImport("opaque-job"),
      () => cancelHirePacketImport("opaque-job"),
    ]) await expect(call()).rejects.toThrow("Forbidden");
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("preflights encryption before creating a job or uploading a ZIP", async () => {
    mocks.encrypt.mockRejectedValue(new Error("KMS private failure"));
    const result = await uploadHirePacketZip("opaque-employee", { name: "dummy.zip", bytes: new ArrayBuffer(1) });
    expect(result.ok).toBe(false);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("KMS private failure");
  });

  it("returns decrypted proposals to an authorized admin and normalizes legacy errors", async () => {
    const fields = { proposedFields: { name: { value: "Dummy Hire" } }, fileResults: [] };
    mocks.decrypt.mockResolvedValue(fields);
    const result = await getHirePacketImportStatus("opaque-job");
    expect(result).toMatchObject({ ok: true, ...fields, errorMessage: "Generic safe import failure" });
    expect(JSON.stringify(result)).not.toContain("ciphertext");
    expect(JSON.stringify(result)).not.toContain("000-00-0000");
  });

  it("fails closed on status decryption failure without returning ciphertext or raw errors", async () => {
    mocks.decrypt.mockRejectedValue(new Error("Private Dummy 000-00-0000"));
    const result = await getHirePacketImportStatus("opaque-job");
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("000-00-0000");
    expect(JSON.stringify(result)).not.toContain("ciphertext");
  });

  it("does not update employee fields when proposal decryption fails", async () => {
    mocks.decrypt.mockRejectedValue(new Error("Decrypt failed"));
    expect((await applyHirePacketImport({ jobId: "opaque-job", selectedFields: ["name"] })).ok).toBe(false);
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
