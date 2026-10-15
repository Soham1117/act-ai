import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminId: "admin-actor",
  employee: {
    id: "employee-target",
    name: "Target Admin",
    employmentStatus: "ACTIVE",
    userId: "user-target",
    user: { role: "ADMIN" },
  },
  currentRole: "ADMIN" as "ADMIN" | "EMPLOYEE",
  adminCount: 2,
  calls: [] as string[],
}));

const tx = vi.hoisted(() => ({
  $executeRaw: vi.fn(async () => {
    mocks.calls.push("lock");
    return 1;
  }),
  user: {
    findUnique: vi.fn(async () => {
      mocks.calls.push("read-target");
      return { role: mocks.currentRole };
    }),
    count: vi.fn(async () => {
      mocks.calls.push("count-admins");
      return mocks.adminCount;
    }),
    update: vi.fn(async () => {
      mocks.calls.push("update-role-and-token");
      return {};
    }),
  },
}));

const dbMock = vi.hoisted(() => ({
  employee: { findUnique: vi.fn(async () => mocks.employee) },
  $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ id: mocks.adminId })),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/notify", () => ({ notifyEmployees: vi.fn(async () => undefined) }));
vi.mock("@/lib/storage", () => ({ uploadFile: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { NODE_ENV: "test" } }));

import { setUserRole } from "@/server/actions/employees";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.adminId = "admin-actor";
  mocks.employee.userId = "user-target";
  mocks.employee.employmentStatus = "ACTIVE";
  mocks.employee.user.role = "ADMIN";
  mocks.currentRole = "ADMIN";
  mocks.adminCount = 2;
  mocks.calls.length = 0;
});

describe("atomic administrator role invariant", () => {
  it("locks, recounts, then changes role and token version in one transaction", async () => {
    await expect(setUserRole("employee-target", "EMPLOYEE")).resolves.toEqual({ ok: true });

    expect(mocks.calls).toEqual([
      "lock",
      "read-target",
      "count-admins",
      "update-role-and-token",
    ]);
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "user-target" },
      data: { role: "EMPLOYEE", tokenVersion: { increment: 1 } },
    });
  });

  it("rejects the serialized last-admin demotion without updating", async () => {
    mocks.adminCount = 1;

    await expect(setUserRole("employee-target", "EMPLOYEE")).resolves.toEqual({
      ok: false,
      error: "You can't remove the last admin. Promote another active employee first.",
    });
    expect(mocks.calls).toEqual(["lock", "read-target", "count-admins"]);
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("preserves the self-role-change guard before opening a transaction", async () => {
    mocks.adminId = "user-target";

    await expect(setUserRole("employee-target", "EMPLOYEE")).resolves.toEqual({
      ok: false,
      error: "You can't change your own role. Ask another admin.",
    });
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("preserves promotion eligibility for inactive employees", async () => {
    mocks.employee.user.role = "EMPLOYEE";
    mocks.currentRole = "EMPLOYEE";
    mocks.employee.employmentStatus = "TERMINATED";

    await expect(setUserRole("employee-target", "ADMIN")).resolves.toEqual({
      ok: false,
      error: "Only active employees can be made admins.",
    });
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });
});
