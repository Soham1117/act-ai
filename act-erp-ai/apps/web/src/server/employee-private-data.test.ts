import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const crypto = vi.hoisted(() => ({ encrypt: vi.fn(), decrypt: vi.fn() }));
vi.mock("./sensitive-data", () => ({
  encryptSensitiveJson: crypto.encrypt,
  decryptSensitiveJson: crypto.decrypt,
  isEncryptedSensitiveJson: (v: unknown) => Boolean(v && typeof v === "object" &&
    (v as { $encrypted?: unknown }).$encrypted === "act-kms-json" &&
    (v as { version?: unknown }).version === 1),
  SensitiveDataError: class extends Error { constructor() { super("Secure data storage is unavailable."); } },
}));
import {
  EMPLOYEE_PRIVATE_FIELDS, encryptEmployeePrivateDetails, prepareEmployeePrivateUpdate,
  readEmployeePrivateDetails,
} from "./employee-private-data";

const sample = {
  ssnLast4: "0000", dateOfBirth: new Date("2000-01-01T00:00:00.000Z"),
  personalEmail: "dummy@example.test", phoneNumber: "555-0100", address: "1 Dummy Lane",
  city: "Test City", state: "TX", zipCode: "00000", emergencyName: "Test Contact", emergencyPhone: "555-0101",
};
const wrapper = { $encrypted: "act-kms-json" as const, version: 1 as const, ciphertext: "Zml4dHVyZQ==" };
const cleared = Object.fromEntries(EMPLOYEE_PRIVATE_FIELDS.map(field => [field, null]));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SENSITIVE_DATA_REQUIRE_ENCRYPTED", "false");
  crypto.encrypt.mockResolvedValue(wrapper);
  crypto.decrypt.mockResolvedValue({ ...sample, dateOfBirth: sample.dateOfBirth.toISOString() });
});
afterEach(() => vi.unstubAllEnvs());

describe("employee private fields", () => {
  it("stores one bound encrypted payload and clears every plaintext column", async () => {
    const write = await encryptEmployeePrivateDetails("dummy-employee", sample);
    expect(write).toEqual({ ...cleared, privateDetails: wrapper });
    expect(crypto.encrypt).toHaveBeenCalledWith({ ...sample, dateOfBirth: sample.dateOfBirth.toISOString() }, {
      purpose: "employee-private-details", recordId: "dummy-employee", field: "privateDetails",
    });
    expect(JSON.stringify(write)).not.toContain(sample.personalEmail);
    expect(JSON.stringify(write)).not.toContain(sample.address);
  });

  it("hydrates DOB as a Date and removes the encrypted blob from the return value", async () => {
    const row = await readEmployeePrivateDetails({ id: "dummy-employee", name: "Dummy", ...cleared, privateDetails: wrapper });
    expect(row).toEqual({ id: "dummy-employee", name: "Dummy", ...sample });
    expect(row).not.toHaveProperty("privateDetails");
  });

  it("merges a partial update without erasing the other private answers", async () => {
    await prepareEmployeePrivateUpdate({ id: "dummy-employee", ...cleared, privateDetails: wrapper }, {
      personalEmail: "changed@example.test", address: undefined, emergencyPhone: null,
    });
    expect(crypto.encrypt).toHaveBeenCalledWith({
      ...sample, dateOfBirth: sample.dateOfBirth.toISOString(),
      personalEmail: "changed@example.test", emergencyPhone: null,
    }, expect.anything());
  });

  it("reads legacy nullable columns only during compatibility, and permits empty profiles", async () => {
    expect((await readEmployeePrivateDetails({ id: "dummy", ...sample })).ssnLast4).toBe("0000");
    vi.stubEnv("SENSITIVE_DATA_REQUIRE_ENCRYPTED", "true");
    await expect(readEmployeePrivateDetails({ id: "dummy", ...sample })).rejects.toThrow("Secure data");
    expect((await readEmployeePrivateDetails({ id: "dummy" })).ssnLast4).toBeNull();
  });

  it("rejects plaintext sidecars and mixed old-writer copies even during compatibility", async () => {
    await expect(readEmployeePrivateDetails({ id: "dummy", privateDetails: sample })).rejects.toThrow("Secure data");
    await expect(readEmployeePrivateDetails({ id: "dummy", privateDetails: wrapper, ssnLast4: "0000" })).rejects.toThrow("Secure data");
    expect(crypto.decrypt).not.toHaveBeenCalled();
  });

  it("fails closed on decrypt/shape failure and never encrypts malformed legacy SSN", async () => {
    crypto.decrypt.mockRejectedValueOnce(new Error("dummy SDK error"));
    await expect(readEmployeePrivateDetails({ id: "dummy", privateDetails: wrapper })).rejects.toThrow("Secure data");
    crypto.decrypt.mockResolvedValueOnce({ personalEmail: "missing-other-fields" });
    await expect(readEmployeePrivateDetails({ id: "dummy", privateDetails: wrapper })).rejects.toThrow("Secure data");
    await expect(encryptEmployeePrivateDetails("dummy", { ssnLast4: "12345" })).rejects.toThrow("Secure data");
    expect(crypto.encrypt).not.toHaveBeenCalled();
  });

  it("does not return a plaintext write when KMS encryption fails", async () => {
    crypto.encrypt.mockRejectedValue(new Error("unavailable"));
    await expect(encryptEmployeePrivateDetails("dummy", sample)).rejects.toThrow("unavailable");
  });
});
