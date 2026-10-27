import { beforeEach, describe, expect, it, vi } from "vitest";

const { employeeUpdate, contractWorkerUpdate, uploadFile } = vi.hoisted(() => ({
  employeeUpdate: vi.fn(),
  contractWorkerUpdate: vi.fn(),
  uploadFile: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    employee: { update: employeeUpdate },
    contractWorker: { update: contractWorkerUpdate },
  },
}));
vi.mock("@/lib/storage", () => ({ uploadFile }));

import { saveKioskProfilePhoto } from "@/server/kiosk-profile-photo-store";

const photo = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0x00]).toString("base64")}`;

describe("saveKioskProfilePhoto", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    uploadFile.mockImplementation(async (_bucket: string, path: string) => ({
      key: `profile-pics/${path}`,
    }));
  });

  it("ignores invalid image bytes without replacing the stored portrait", async () => {
    await expect(
      saveKioskProfilePhoto("employee", "person", "not an image"),
    ).resolves.toBeNull();
    expect(uploadFile).not.toHaveBeenCalled();
    expect(employeeUpdate).not.toHaveBeenCalled();
    expect(contractWorkerUpdate).not.toHaveBeenCalled();
  });

  it("stores and updates the employee portrait using an immutable kiosk key", async () => {
    await expect(saveKioskProfilePhoto("employee", "person", photo)).resolves.toMatch(
      /^profile-pics\/kiosk\/employee\/person\/.+\.jpg$/,
    );
    expect(uploadFile).toHaveBeenCalledWith(
      "profile-pics",
      expect.stringMatching(/^kiosk\/employee\/person\/.+\.jpg$/),
      Buffer.from([0xff, 0xd8, 0xff, 0x00]),
      { contentType: "image/jpeg" },
    );
    expect(employeeUpdate).toHaveBeenCalledWith({
      where: { id: "person" },
      data: {
        kioskProfilePhotoKey: expect.stringMatching(
          /^profile-pics\/kiosk\/employee\/person\/.+\.jpg$/,
        ),
      },
    });
    expect(contractWorkerUpdate).not.toHaveBeenCalled();
  });

  it("updates only the contract worker portrait", async () => {
    await saveKioskProfilePhoto("contract", "worker", photo);
    expect(contractWorkerUpdate).toHaveBeenCalledWith({
      where: { id: "worker" },
      data: {
        kioskProfilePhotoKey: expect.stringMatching(
          /^profile-pics\/kiosk\/contract\/worker\/.+\.jpg$/,
        ),
      },
    });
    expect(employeeUpdate).not.toHaveBeenCalled();
  });

  it("leaves the existing portrait untouched when upload fails", async () => {
    uploadFile.mockRejectedValue(new Error("storage unavailable"));
    await expect(saveKioskProfilePhoto("employee", "person", photo)).rejects.toThrow(
      "storage unavailable",
    );
    expect(employeeUpdate).not.toHaveBeenCalled();
    expect(contractWorkerUpdate).not.toHaveBeenCalled();
  });
});
