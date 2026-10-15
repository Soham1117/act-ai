import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: { user: { id: "user-1", tv: 3 } } as { user?: { id?: string; tv?: number } } | null,
  profile: null as null | {
    id: string;
    email: string;
    name: string;
    profileImage: null;
    role: "ADMIN" | "EMPLOYEE";
    tokenVersion: number;
    mustChangePassword: boolean;
    employee: {
      id: string;
      employmentStatus: "ACTIVE";
      terminationDate: null;
      updatedAt: Date;
    } | null;
  },
}));

vi.mock("react", () => ({ cache: <T extends (...args: never[]) => unknown>(fn: T) => fn }));
vi.mock("./auth", () => ({ auth: vi.fn(async () => state.session) }));
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(async () => state.profile),
      update: vi.fn(),
    },
  },
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  }),
}));

import {
  getSessionUser,
  getSessionUserForPasswordChange,
  requireAdmin,
  requireUser,
  requireWritableUser,
} from "./index";

beforeEach(() => {
  state.session = { user: { id: "user-1", tv: 3 } };
  state.profile = {
    id: "user-1",
    email: "admin@example.com",
    name: "Admin",
    profileImage: null,
    role: "ADMIN",
    tokenVersion: 3,
    mustChangePassword: true,
    employee: {
      id: "employee-1",
      employmentStatus: "ACTIVE",
      terminationDate: null,
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    },
  };
});

describe("forced-password authorization boundary", () => {
  it.each([
    ["direct protected-route helper", getSessionUser],
    ["employee guard", requireUser],
    ["writable employee guard", requireWritableUser],
    ["admin guard", requireAdmin],
  ])("redirects a must-change session from the %s", async (_label, guard) => {
    await expect(guard()).rejects.toThrow("REDIRECT:/change-password");
  });

  it("allows the dedicated password-change helper to resolve the same session", async () => {
    await expect(getSessionUserForPasswordChange()).resolves.toMatchObject({
      id: "user-1",
      mustChangePassword: true,
      role: "ADMIN",
    });
  });

  it("does not redirect an ordinary session to change-password", async () => {
    state.profile!.mustChangePassword = false;
    await expect(getSessionUser()).resolves.toMatchObject({
      id: "user-1",
      mustChangePassword: false,
    });
  });
});
