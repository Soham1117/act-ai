import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/actions/kiosk", () => ({ getActiveKioskSession: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    timeEntry: { findFirst: vi.fn() },
    contractTimeEntry: { findUnique: vi.fn() },
    employee: { findFirst: vi.fn() },
    contractWorker: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/storage", () => ({ getObjectStream: vi.fn() }));
import { getActiveKioskSession } from "@/server/actions/kiosk";
import { db } from "@/lib/db";
import { getObjectStream } from "@/lib/storage";
import { GET } from "./route";

const call = (query = "type=employee&id=entry&side=in") =>
  GET(new Request(`https://example.com/kiosk/shop/photo?${query}`), {
    params: Promise.resolve({ slug: "shop" }),
  });

describe("kiosk roster photo access", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("rejects devices without the matching active kiosk session before reading photos", async () => {
    vi.mocked(getActiveKioskSession).mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(getActiveKioskSession).toHaveBeenCalledWith("shop");
    expect(db.timeEntry.findFirst).not.toHaveBeenCalled();
    expect(getObjectStream).not.toHaveBeenCalled();
  });

  async function activate() {
    vi.mocked(getActiveKioskSession).mockResolvedValue({ id: "device" } as Awaited<
      ReturnType<typeof getActiveKioskSession>
    >);
  }

  it("rejects invalid photo selectors", async () => {
    await activate();
    expect((await call("type=payroll&id=entry&side=in")).status).toBe(400);
    expect(getObjectStream).not.toHaveBeenCalled();
  });

  it("only queries active employees and returns private, uncropped JPEG bytes", async () => {
    await activate();
    vi.mocked(db.timeEntry.findFirst).mockResolvedValue({
      clockInPhotoKey: "private/in.jpg",
      clockOutPhotoKey: null,
    } as never);
    vi.mocked(getObjectStream).mockResolvedValue({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([255, 216, 255]));
          controller.close();
        },
      }),
      contentLength: 3,
      contentType: "image/jpeg",
    });
    const response = await call();
    expect(db.timeEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "entry", employee: { employmentStatus: "ACTIVE" } },
      }),
    );
    expect(getObjectStream).toHaveBeenCalledWith("private/in.jpg");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([255, 216, 255]),
    );
  });

  it("does not serve missing employee photos", async () => {
    await activate();
    vi.mocked(db.timeEntry.findFirst).mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect(getObjectStream).not.toHaveBeenCalled();
  });

  it("denies ended and future contract workers", async () => {
    await activate();
    for (const worker of [
      { status: "ENDED", startDate: new Date("2020-01-01"), endDate: null },
      { status: "ACTIVE", startDate: new Date("2999-01-01"), endDate: null },
    ]) {
      vi.mocked(db.contractTimeEntry.findUnique).mockResolvedValue({
        clockInPhotoKey: "private/in.jpg",
        contractWorker: worker,
      } as never);
      expect((await call("type=contract&id=entry&side=in")).status).toBe(404);
    }
    expect(getObjectStream).not.toHaveBeenCalled();
  });

  it("returns 404 when a stored image is unavailable so the client can use its avatar", async () => {
    await activate();
    vi.mocked(db.timeEntry.findFirst).mockResolvedValue({
      clockInPhotoKey: "missing.jpg",
    } as never);
    vi.mocked(getObjectStream).mockRejectedValue(new Error("not found"));
    expect((await call()).status).toBe(404);
  });

  it("serves a profile photo only for an active employee and keeps its key private", async () => {
    await activate();
    vi.mocked(db.employee.findFirst).mockResolvedValue({
      kioskProfilePhotoKey: "private/profile.jpg",
    } as never);
    vi.mocked(getObjectStream).mockResolvedValue({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([255, 216, 255]));
          controller.close();
        },
      }),
      contentLength: 3,
      contentType: "image/jpeg",
    });
    const response = await call("type=employee&id=emp-1&profile=1&v=photo-v2");
    expect(db.employee.findFirst).toHaveBeenCalledWith({
      where: { id: "emp-1", employmentStatus: "ACTIVE" },
      select: { kioskProfilePhotoKey: true },
    });
    expect(getObjectStream).toHaveBeenCalledWith("private/profile.jpg");
    expect(response.status).toBe(200);
  });

  it("requires profile=1 selectors and an active contract", async () => {
    await activate();
    expect((await call("type=employee&id=emp-1")).status).toBe(400);
    expect(db.employee.findFirst).not.toHaveBeenCalled();

    vi.mocked(db.contractWorker.findUnique).mockResolvedValue({
      kioskProfilePhotoKey: "private/contract.jpg",
      status: "ACTIVE",
      startDate: new Date("2999-01-01"),
      endDate: null,
    } as never);
    expect((await call("type=contract&id=worker-1&profile=1")).status).toBe(404);
    expect(db.contractWorker.findUnique).toHaveBeenCalledWith({
      where: { id: "worker-1" },
      select: {
        kioskProfilePhotoKey: true,
        status: true,
        startDate: true,
        endDate: true,
      },
    });
    expect(getObjectStream).not.toHaveBeenCalled();
  });

  it("returns 404 without loading storage when the active person's profile key is missing", async () => {
    await activate();
    vi.mocked(db.employee.findFirst).mockResolvedValue({
      kioskProfilePhotoKey: null,
    } as never);
    expect((await call("type=employee&id=emp-1&profile=1")).status).toBe(404);
    expect(getObjectStream).not.toHaveBeenCalled();
  });
});
