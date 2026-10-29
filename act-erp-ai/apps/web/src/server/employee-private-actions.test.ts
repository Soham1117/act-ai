import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(), writable: vi.fn(), transaction: vi.fn(), find: vi.fn(), update: vi.fn(),
  userFind: vi.fn(), clashes: vi.fn(), userCreate: vi.fn(), employeeCreate: vi.fn(),
  encrypt: vi.fn(), prepare: vi.fn(), read: vi.fn(), audit: vi.fn(), password: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  employee: { findUnique: mocks.find, update: mocks.update },
  user: { findUnique: mocks.userFind, findMany: mocks.clashes }, $transaction: mocks.transaction,
} }));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/lib/auth/writable", () => ({ writable: mocks.writable }));
vi.mock("@/lib/auth/password", () => ({ hashPassword: vi.fn(async () => "dummy-hash"), verifyPassword: mocks.password }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/storage", () => ({ uploadFile: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifyEmployees: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { LOGIN_2FA_ENABLED: "false" } }));
vi.mock("@/server/time-core", () => ({ closeOpenEntry: vi.fn(), revalidateTimePages: vi.fn(), withEmployeeLock: vi.fn() }));
vi.mock("@/lib/employee-create", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/employee-create")>(), generateEmployeeId: vi.fn(async () => "EMP-DUMMY"),
}));
vi.mock("./employee-private-data", () => ({
  EMPLOYEE_PRIVATE_FIELDS: ["ssnLast4", "dateOfBirth", "personalEmail", "phoneNumber", "address", "city", "state", "zipCode", "emergencyName", "emergencyPhone"],
  encryptEmployeePrivateDetails: mocks.encrypt, prepareEmployeePrivateUpdate: mocks.prepare,
  readEmployeePrivateDetails: mocks.read,
}));
import { createEmployee, updateEmployee, updateMyPersonalEmail } from "./actions/employees";

const now = new Date("2026-10-29T12:00:00Z");
const actor = { id: "dummy-admin", employeeId: "dummy-employee", email: "admin@example.test" };
const stored = { id: actor.employeeId, userId: actor.id, name: "Dummy Hire", updatedAt: now, privateDetails: { $encrypted: "act-kms-json" } };
const privateWrite = {
  privateDetails: { $encrypted: "act-kms-json", version: 1, ciphertext: "Zml4dHVyZQ==" },
  ssnLast4: null, dateOfBirth: null, personalEmail: null, phoneNumber: null, address: null,
  city: null, state: null, zipCode: null, emergencyName: null, emergencyPhone: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.admin.mockResolvedValue(actor); mocks.writable.mockResolvedValue({ ok: true, user: actor });
  mocks.find.mockResolvedValue(stored); mocks.read.mockResolvedValue({ ...stored, ssnLast4: "0000", address: "Old Dummy Address" });
  mocks.prepare.mockResolvedValue(privateWrite); mocks.encrypt.mockResolvedValue(privateWrite);
  mocks.update.mockResolvedValue(stored); mocks.employeeCreate.mockResolvedValue(stored);
  mocks.userFind.mockResolvedValue({ passwordHash: "dummy-hash" }); mocks.password.mockResolvedValue(true);
  mocks.clashes.mockResolvedValue([]); mocks.userCreate.mockResolvedValue({ id: actor.id });
  mocks.transaction.mockImplementation(async callback => callback({ employee: { update: mocks.update, create: mocks.employeeCreate }, user: { create: mocks.userCreate } }));
});

describe("employee private write boundaries", () => {
  it("writes encrypted private updates with an optimistic version guard and redacted audit", async () => {
    expect((await updateEmployee(actor.employeeId, { address: "New Dummy Address", ssnLast4: "1111" })).ok).toBe(true);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: actor.employeeId, updatedAt: now }, data: privateWrite,
    });
    expect(mocks.audit.mock.calls[0][0].diff).toEqual({ address: "[changed]", ssnLast4: "[changed]" });
    expect(JSON.stringify(mocks.update.mock.calls)).not.toContain("New Dummy Address");
  });
  it("does not write or audit when KMS preparation fails", async () => {
    mocks.prepare.mockRejectedValue(new Error("Secure storage unavailable"));
    expect((await updateEmployee(actor.employeeId, { address: "New Dummy Address" })).ok).toBe(false);
    expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("encrypts a new employee before creating either user or employee rows", async () => {
    mocks.encrypt.mockRejectedValue(new Error("Secure storage unavailable"));
    expect((await createEmployee({ name: "Dummy Hire", username: "dummyhire", gender: "OTHER", employmentType: "FULL_PART_TIME", compensationType: "HOURLY_RATE", password: "dummy-password" })).ok).toBe(false);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.userCreate).not.toHaveBeenCalled(); expect(mocks.employeeCreate).not.toHaveBeenCalled();
  });
  it("keeps self-service personal-email changes encrypted and requires the current password", async () => {
    expect((await updateMyPersonalEmail("dummy-password", "dummy@example.test")).ok).toBe(true);
    expect(mocks.prepare).toHaveBeenCalledWith(stored, { personalEmail: "dummy@example.test" });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: actor.employeeId, updatedAt: now }, data: privateWrite });
    mocks.update.mockClear(); mocks.password.mockResolvedValue(false);
    expect((await updateMyPersonalEmail("wrong", "dummy@example.test")).ok).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
