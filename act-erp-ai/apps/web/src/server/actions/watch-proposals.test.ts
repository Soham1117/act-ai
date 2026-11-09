import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), create: vi.fn(), decide: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/server/watch/proposals", () => ({ createProposal: mocks.create, decideProposal: mocks.decide }));
vi.mock("@/server/time-core", () => ({ revalidateTimePages: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { createClockOutProposal, decideClockOutProposal } from "./watch-proposals";
beforeEach(() => { vi.resetAllMocks(); mocks.admin.mockResolvedValue({ id: "admin" }); mocks.create.mockResolvedValue({ ok: true, id: "p" }); mocks.decide.mockResolvedValue({ ok: true, id: "p", status: "APPLIED" }); });
it("requires admin access before either public action", async () => {
  mocks.admin.mockRejectedValue(new Error("Forbidden"));
  await expect(createClockOutProposal({ findingId: "f", reason: "reason" })).rejects.toThrow("Forbidden");
  await expect(decideClockOutProposal({ id: "p", action: "APPROVE", confirmedActualEnd: true })).rejects.toThrow("Forbidden");
  expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.decide).not.toHaveBeenCalled();
});
it("validates draft reason before reaching persistence", async () => {
  expect(await createClockOutProposal({ findingId: "f", reason: " " })).toMatchObject({ ok: false });
  expect(mocks.create).not.toHaveBeenCalled();
});
it("forwards explicit actual-end confirmation", async () => {
  await decideClockOutProposal({ id: "p", action: "APPROVE", confirmedActualEnd: true });
  expect(mocks.decide).toHaveBeenCalledWith({ id: "admin" }, { id: "p", action: "APPROVE", confirmedActualEnd: true });
});
