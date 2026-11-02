import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_POLICY } from "@/lib/watch/types";

const mocks = vi.hoisted(() => ({
  digestCreate: vi.fn(),
  digestUpdate: vi.fn(),
  findingFind: vi.fn(),
  findingCount: vi.fn(),
  entryAggregate: vi.fn(),
  employeeFind: vi.fn(),
  periodFind: vi.fn(),
  send: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    watchDigest: { create: mocks.digestCreate, update: mocks.digestUpdate },
    watchFinding: { findMany: mocks.findingFind, count: mocks.findingCount },
    timeEntry: { aggregate: mocks.entryAggregate },
    employee: { findMany: mocks.employeeFind },
    payrollCalendar: { findFirst: mocks.periodFind },
  },
}));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_SITE_URL: "https://persona.example/" } }));
vi.mock("@/lib/email", () => ({ sendPlainEmail: mocks.send }));
vi.mock("@/lib/notify", () => ({ notifyEmployees: mocks.notify }));

import { sendDailyDigestIfDue } from "./digest";

// 2026-11-02 13:00 UTC = 7:00 am Central (CST, UTC-6).
const sevenAm = new Date("2026-11-02T13:00:00Z");
const sixAm = new Date("2026-11-02T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.digestCreate.mockResolvedValue({});
  mocks.findingFind.mockResolvedValue([{ severity: "WARN", title: "Something", fixLink: "/admin/x", firstSeenAt: new Date(1) }]);
  mocks.findingCount.mockResolvedValue(3);
  mocks.entryAggregate.mockResolvedValue({ _count: { _all: 40 }, _sum: { totalWorkMin: 20_000 } });
  mocks.employeeFind.mockResolvedValue([{ id: "e1" }, { id: "e2" }]);
  mocks.periodFind.mockResolvedValue(null);
  mocks.send.mockResolvedValue(undefined);
});

describe("sendDailyDigestIfDue", () => {
  it("waits until the configured hour", async () => {
    const r = await sendDailyDigestIfDue(sixAm, DEFAULT_POLICY);
    expect(r).toMatchObject({ sent: false, reason: "not-yet" });
    expect(mocks.digestCreate).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("never sends twice in one business day", async () => {
    mocks.digestCreate.mockRejectedValue(new Error("unique"));
    const r = await sendDailyDigestIfDue(sevenAm, DEFAULT_POLICY);
    expect(r).toMatchObject({ sent: false, reason: "already-sent" });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("notifies the admins and emails each recipient", async () => {
    const r = await sendDailyDigestIfDue(sevenAm, DEFAULT_POLICY);
    expect(r).toMatchObject({ sent: true, emailed: 2, notified: 2, errors: [] });
    expect(mocks.notify).toHaveBeenCalledWith(["e1", "e2"], expect.objectContaining({ type: "SYSTEM", link: "/admin/watch" }));
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.send.mock.calls[0]![2]).toContain("https://persona.example/admin/watch");
  });

  it("keeps going when one email fails and records it", async () => {
    mocks.send.mockRejectedValueOnce(new Error("mailbox unavailable")).mockResolvedValue(undefined);
    const r = await sendDailyDigestIfDue(sevenAm, DEFAULT_POLICY);
    expect(r.emailed).toBe(1);
    expect(r.errors[0]).toContain("mailbox unavailable");
    expect(mocks.digestUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ recipientCount: 1 }) }));
  });
});
