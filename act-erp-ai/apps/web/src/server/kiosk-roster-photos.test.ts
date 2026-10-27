import { beforeEach, describe, expect, it, vi } from "vitest";

const { timeEntryFindMany, contractTimeEntryFindMany } = vi.hoisted(() => ({
  timeEntryFindMany: vi.fn(),
  contractTimeEntryFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    timeEntry: { findMany: timeEntryFindMany },
    contractTimeEntry: { findMany: contractTimeEntryFindMany },
  },
}));

import { latestKioskPhotoUrls } from "@/server/kiosk-roster-photos";

describe("latestKioskPhotoUrls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    timeEntryFindMany.mockResolvedValue([]);
    contractTimeEntryFindMany.mockResolvedValue([]);
  });

  it("skips the database when there are no person IDs", async () => {
    await expect(latestKioskPhotoUrls("north", "employee", [])).resolves.toEqual(
      new Map(),
    );

    expect(timeEntryFindMany).not.toHaveBeenCalled();
    expect(contractTimeEntryFindMany).not.toHaveBeenCalled();
  });

  it("queries employee entries with employee scope and distinct latest rows", async () => {
    await latestKioskPhotoUrls("north", "employee", ["emp-1", "emp-2"]);

    expect(timeEntryFindMany).toHaveBeenCalledWith({
      where: {
        employeeId: { in: ["emp-1", "emp-2"] },
        OR: [{ clockInPhotoKey: { not: null } }, { clockOutPhotoKey: { not: null } }],
      },
      orderBy: { clockIn: "desc" },
      distinct: ["employeeId"],
      select: {
        id: true,
        clockInPhotoKey: true,
        clockOutPhotoKey: true,
        employeeId: true,
      },
    });
    expect(contractTimeEntryFindMany).not.toHaveBeenCalled();
  });

  it("queries contract entries with contract worker scope and distinct latest rows", async () => {
    await latestKioskPhotoUrls("north", "contract", ["worker-1", "worker-2"]);

    expect(contractTimeEntryFindMany).toHaveBeenCalledWith({
      where: {
        contractWorkerId: { in: ["worker-1", "worker-2"] },
        OR: [{ clockInPhotoKey: { not: null } }, { clockOutPhotoKey: { not: null } }],
      },
      orderBy: { clockIn: "desc" },
      distinct: ["contractWorkerId"],
      select: {
        id: true,
        clockInPhotoKey: true,
        clockOutPhotoKey: true,
        contractWorkerId: true,
      },
    });
    expect(timeEntryFindMany).not.toHaveBeenCalled();
  });

  it("prefers a clock-out photo and falls back to clock-in without exposing storage keys", async () => {
    timeEntryFindMany.mockResolvedValue([
      {
        id: "entry-out",
        employeeId: "emp-out",
        clockInPhotoKey: "private/employee/in-secret.jpg",
        clockOutPhotoKey: "private/employee/out-secret.jpg",
      },
      {
        id: "entry-in",
        employeeId: "emp-in",
        clockInPhotoKey: "private/employee/in-only-secret.jpg",
        clockOutPhotoKey: null,
      },
    ]);

    const urls = await latestKioskPhotoUrls("north site", "employee", [
      "emp-out",
      "emp-in",
    ]);

    expect(urls.get("emp-out")).toBe(
      "/kiosk/north%20site/photo?type=employee&id=entry-out&side=out",
    );
    expect(urls.get("emp-in")).toBe(
      "/kiosk/north%20site/photo?type=employee&id=entry-in&side=in",
    );
    for (const url of urls.values()) {
      expect(url).not.toContain("private/");
      expect(url).not.toContain("secret");
    }
  });
});
