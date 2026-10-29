import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ encrypt: vi.fn(), decrypt: vi.fn() }));
vi.mock("./sensitive-data", () => ({
  encryptSensitiveJson: mocks.encrypt,
  decryptSensitiveJson: mocks.decrypt,
  isEncryptedSensitiveJson: (value: unknown) => Boolean(value && typeof value === "object" && (value as { $encrypted?: string }).$encrypted === "act-kms-json"),
  SensitiveDataError: class extends Error {},
}));
import { EMPLOYEE_PRIVATE_FIELDS, type EmployeePrivateRow } from "./employee-private-data";
import { migrateEmployeePrivateRow } from "./employee-private-migration";

const sample: EmployeePrivateRow = { id: "dummy", ssnLast4: "0000", personalEmail: "dummy@example.test" };
const wrapper = { $encrypted: "act-kms-json", version: 1, ciphertext: "Zml4dHVyZQ==" };
let plaintext: unknown;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.encrypt.mockImplementation(async value => { plaintext = value; return wrapper; });
  mocks.decrypt.mockImplementation(async () => plaintext);
});
function harness(row = sample) {
  let stored: EmployeePrivateRow = row;
  const compareAndSwap = vi.fn(async write => { stored = { ...row, ...write }; return true; });
  const readBack = vi.fn(async () => stored);
  return { compareAndSwap, readBack, run: (mode: "dry-run" | "apply" | "verify") => migrateEmployeePrivateRow({ row, mode, compareAndSwap, readBack }) };
}

describe("employee PII migration", () => {
  it("inventories legacy data without KMS calls or mutation", async () => {
    const h = harness();
    expect(await h.run("dry-run")).toBe("legacy");
    expect(mocks.encrypt).not.toHaveBeenCalled();
    expect(h.compareAndSwap).not.toHaveBeenCalled();
  });
  it("round-trips first and clears every legacy field in the atomic replacement", async () => {
    const h = harness();
    expect(await h.run("apply")).toBe("updated");
    const write = h.compareAndSwap.mock.calls[0][0];
    expect(write.privateDetails).toEqual(wrapper);
    for (const field of EMPLOYEE_PRIVATE_FIELDS) expect(write[field]).toBeNull();
  });
  it("does not write when encryption or round-trip verification fails", async () => {
    const h = harness();
    mocks.encrypt.mockRejectedValueOnce(new Error("dummy failure"));
    expect(await h.run("apply")).toBe("failed");
    mocks.decrypt.mockResolvedValueOnce({ bad: "schema" });
    expect(await h.run("apply")).toBe("failed");
    expect(h.compareAndSwap).not.toHaveBeenCalled();
  });
  it("does not overwrite a concurrent edit", async () => {
    const h = harness();
    h.compareAndSwap.mockResolvedValue(false);
    expect(await h.run("apply")).toBe("conflict");
    expect(h.readBack).not.toHaveBeenCalled();
  });
  it("verifies existing ciphertext without rewriting and fails remaining legacy values", async () => {
    const first = harness();
    expect(await first.run("apply")).toBe("updated");
    const write = first.compareAndSwap.mock.calls[0][0];
    const second = harness({ id: sample.id, ...write });
    expect(await second.run("verify")).toBe("verified");
    expect(await second.run("apply")).toBe("verified");
    expect(second.compareAndSwap).not.toHaveBeenCalled();
    expect(await harness().run("verify")).toBe("failed");
  });
  it("rejects mixed/plaintext sidecars and permits genuinely empty profiles", async () => {
    expect(await harness({ ...sample, privateDetails: wrapper }).run("apply")).toBe("failed");
    expect(await harness({ id: "dummy", privateDetails: { secret: "plaintext" } }).run("dry-run")).toBe("failed");
    expect(await harness({ id: "dummy" }).run("verify")).toBe("empty");
  });
});
