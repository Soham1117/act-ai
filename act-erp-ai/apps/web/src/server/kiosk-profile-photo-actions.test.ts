import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  headers: vi.fn(),
  kioskFindUnique: vi.fn(),
  kioskUpdate: vi.fn(),
  employeeFindFirst: vi.fn(),
  contractFindUnique: vi.fn(),
  save: vi.fn(),
  audit: vi.fn(),
  verifyPassword: vi.fn(),
  isDefaultPin: vi.fn(),
  rateLimited: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies, headers: mocks.headers }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    kioskSession: { findUnique: mocks.kioskFindUnique, update: mocks.kioskUpdate },
    employee: { findFirst: mocks.employeeFindFirst },
    contractWorker: { findUnique: mocks.contractFindUnique },
  },
}));
vi.mock("@/lib/auth", () => ({
  ReadOnlyAccountError: class ReadOnlyAccountError extends Error {},
  requireAdmin: vi.fn(),
  requireWritableUser: vi.fn(),
}));
vi.mock("@/lib/auth/password", () => ({
  hashPassword: vi.fn(),
  verifyPassword: mocks.verifyPassword,
}));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/rate-limit", () => ({ rateLimited: mocks.rateLimited }));
vi.mock("@/lib/cookie-secure", () => ({
  requestUsesHttps: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/kiosk-network", () => ({
  configuredNetworkList: vi.fn(),
  getKioskNetworkAccess: vi.fn(),
  kioskNetworkDeniedMessage: vi.fn(),
}));
vi.mock("@/lib/notify", () => ({ notifyAdmins: vi.fn() }));
vi.mock("@/lib/kiosk-pin", () => ({
  DEFAULT_KIOSK_PIN: "3214",
  isDefaultPin: mocks.isDefaultPin,
  validateNewPin: vi.fn(),
}));
vi.mock("@/lib/kiosk-id", () => ({ parseKioskIdInput: vi.fn() }));
vi.mock("@/lib/kiosk-require-pin", () => ({ kioskNeedsPin: vi.fn() }));
vi.mock("@/lib/kiosk-rate-limit", () => ({
  clearFailures: vi.fn(),
  isLocked: vi.fn(() => false),
  minutesUntilUnlock: vi.fn(() => 0),
  recordFailure: vi.fn(),
}));
vi.mock("@/lib/ip-network", () => ({
  clientIpFromHeaders: vi.fn(() => "127.0.0.1"),
  normalizeNetwork: vi.fn(),
}));
vi.mock("@/lib/time-rules", () => ({ isStaleShift: vi.fn(() => false) }));
vi.mock("@/lib/format", () => ({
  businessDateOnly: vi.fn(() => new Date("2026-10-22T00:00:00Z")),
}));
vi.mock("@/server/kiosk-profile-photo-store", () => ({
  kioskProfilePhotoUrl: vi.fn(
    (slug, type, id, version) =>
      `/kiosk/${slug}/photo?type=${type}&id=${id}&profile=1&v=${version}`,
  ),
  saveKioskProfilePhoto: mocks.save,
}));
vi.mock("@/server/kiosk-roster-photos", () => ({
  latestKioskPhotoUrls: vi.fn(async () => new Map()),
}));
vi.mock("@/server/punch-photo-store", () => ({ storePunchPhoto: vi.fn() }));
vi.mock("@/server/time-core", () => ({
  _clockIn: vi.fn(),
  _clockOut: vi.fn(),
  _startBreak: vi.fn(),
  _endBreak: vi.fn(),
}));
vi.mock("@/server/contract-time-core", () => ({
  _contractClockIn: vi.fn(),
  _contractClockOut: vi.fn(),
}));

import { kioskUpdateProfilePhoto } from "@/server/actions/kiosk";
import { kioskContractUpdateProfilePhoto } from "@/server/actions/kiosk-contract";

const rawCookie = "device-cookie";
const session = {
  id: "session-1",
  slug: "shop",
  label: "Shop",
  expiresAt: new Date("2027-01-01"),
  revokedAt: null,
  cookieHash: createHash("sha256").update(rawCookie).digest("hex"),
};
const employee = {
  id: "emp-db-1",
  employeeId: "E-1",
  employmentStatus: "ACTIVE",
  kioskPinHash: "pin-hash",
  userId: "user-1",
  email: "one@example.com",
};
const worker = {
  id: "worker-db-1",
  workerId: "CW-1",
  status: "ACTIVE",
  startDate: new Date("2020-01-01"),
  endDate: null,
  kioskPinHash: "pin-hash",
};
const validPhoto = "data:image/jpeg;base64,/9j/AA==";

describe("kiosk profile photo actions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.cookies.mockResolvedValue({ get: () => ({ value: rawCookie }), set: vi.fn() });
    mocks.headers.mockResolvedValue(new Headers());
    mocks.kioskFindUnique.mockResolvedValue(session);
    mocks.kioskUpdate.mockResolvedValue({});
    mocks.employeeFindFirst.mockResolvedValue(employee);
    mocks.contractFindUnique.mockResolvedValue(worker);
    mocks.verifyPassword.mockResolvedValue(true);
    mocks.isDefaultPin.mockResolvedValue(false);
    mocks.rateLimited.mockReturnValue(false);
    mocks.save.mockResolvedValue("profile-pics/kiosk/employee/emp-db-1/photo-v2.jpg");
  });

  it("requires an activated device and rejects inactive, wrong-PIN, and temporary-PIN employee updates", async () => {
    mocks.cookies.mockResolvedValueOnce({ get: () => undefined });
    const inactiveDevice = await kioskUpdateProfilePhoto({
      slug: "shop",
      employeeId: "E-1",
      pin: "1234",
      photo: validPhoto,
    });
    expect(inactiveDevice.ok).toBe(false);
    expect(mocks.save).not.toHaveBeenCalled();

    mocks.employeeFindFirst.mockResolvedValueOnce({
      ...employee,
      employmentStatus: "INACTIVE",
    });
    const inactivePerson = await kioskUpdateProfilePhoto({
      slug: "shop",
      employeeId: "E-1",
      pin: "1234",
      photo: validPhoto,
    });
    expect(inactivePerson.ok).toBe(false);
    expect(mocks.save).not.toHaveBeenCalled();

    mocks.verifyPassword.mockResolvedValueOnce(false);
    const wrongPin = await kioskUpdateProfilePhoto({
      slug: "shop",
      employeeId: "E-1",
      pin: "1234",
      photo: validPhoto,
    });
    expect(wrongPin.ok).toBe(false);
    expect(mocks.save).not.toHaveBeenCalled();

    mocks.isDefaultPin.mockResolvedValueOnce(true);
    const temporaryPin = await kioskUpdateProfilePhoto({
      slug: "shop",
      employeeId: "E-1",
      pin: "1234",
      photo: validPhoto,
    });
    expect(temporaryPin.ok).toBe(false);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("saves an employee photo, returns its private URL, audits it, and does not write attendance", async () => {
    const result = await kioskUpdateProfilePhoto({
      slug: "shop",
      employeeId: "E-1",
      pin: "1234",
      photo: validPhoto,
    });
    expect(result).toEqual({ ok: true, url: expect.stringContaining("profile=1") });
    expect(mocks.save).toHaveBeenCalledWith("employee", "emp-db-1", validPhoto);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "kiosk.profile_photo_update",
        resource: "Employee:emp-db-1",
      }),
    );
    expect(mocks.kioskUpdate).toHaveBeenCalledTimes(1);
  });

  it("blocks contract workers whose term has ended or has not started", async () => {
    for (const dates of [
      { status: "ENDED", startDate: new Date("2020-01-01"), endDate: null },
      { status: "ACTIVE", startDate: new Date("2999-01-01"), endDate: null },
      {
        status: "ACTIVE",
        startDate: new Date("2020-01-01"),
        endDate: new Date("2020-02-01"),
      },
    ]) {
      mocks.contractFindUnique.mockResolvedValueOnce({ ...worker, ...dates });
      const result = await kioskContractUpdateProfilePhoto({
        slug: "shop",
        workerId: "worker-db-1",
        pin: "1234",
        photo: validPhoto,
      });
      expect(result.ok).toBe(false);
    }
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("rejects contract PIN failures and the default PIN without saving", async () => {
    mocks.verifyPassword.mockResolvedValueOnce(false);
    expect(
      (
        await kioskContractUpdateProfilePhoto({
          slug: "shop",
          workerId: "worker-db-1",
          pin: "1234",
          photo: validPhoto,
        })
      ).ok,
    ).toBe(false);
    mocks.contractFindUnique.mockResolvedValueOnce({ ...worker, kioskPinHash: null });
    expect(
      (
        await kioskContractUpdateProfilePhoto({
          slug: "shop",
          workerId: "worker-db-1",
          pin: "3214",
          photo: validPhoto,
        })
      ).ok,
    ).toBe(false);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("saves a contract worker photo and returns a profile URL", async () => {
    mocks.save.mockResolvedValueOnce(
      "profile-pics/kiosk/contract/worker-db-1/photo-v3.jpg",
    );
    const result = await kioskContractUpdateProfilePhoto({
      slug: "shop",
      workerId: "worker-db-1",
      pin: "1234",
      photo: validPhoto,
    });
    expect(result).toEqual({ ok: true, url: expect.stringContaining("profile=1") });
    expect(mocks.save).toHaveBeenCalledWith("contract", "worker-db-1", validPhoto);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "kiosk.contract.profile_photo_update",
        resource: "ContractWorker:worker-db-1",
      }),
    );
  });
});
