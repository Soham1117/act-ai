import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_POLICY } from "@/lib/watch/types";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  executeRaw: vi.fn(),
  digestFind: vi.fn(),
  digestUpsert: vi.fn(),
  digestUpdate: vi.fn(),
  findingFind: vi.fn(),
  findingCount: vi.fn(),
  entryAggregate: vi.fn(),
  employeeFind: vi.fn(),
  periodFind: vi.fn(),
  send: vi.fn(),
  notify: vi.fn(),
  row: null as { forDate: Date; summary: unknown; recipientCount: number } | null,
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: mocks.transaction,
    watchDigest: { findUnique: mocks.digestFind, upsert: mocks.digestUpsert, update: mocks.digestUpdate },
    notification: { create: mocks.notify },
    watchFinding: { findMany: mocks.findingFind, count: mocks.findingCount },
    timeEntry: { aggregate: mocks.entryAggregate },
    employee: { findMany: mocks.employeeFind },
    payrollCalendar: { findFirst: mocks.periodFind },
  },
}));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_SITE_URL: "https://persona.example/" } }));
vi.mock("@/lib/email", () => ({ sendPlainEmail: mocks.send }));

import { sendDailyDigestIfDue } from "./digest";

// 2026-11-02 13:00 UTC = 7:00 am Central (CST, UTC-6).
const sevenAm = new Date("2026-11-02T13:00:00Z");
const sixAm = new Date("2026-11-02T12:00:00Z");

beforeEach(() => {
  vi.resetAllMocks();
  mocks.row = null;
  mocks.transaction.mockImplementation(async (callback) => callback({
    $executeRaw: mocks.executeRaw,
    watchDigest: { findUnique: mocks.digestFind, upsert: mocks.digestUpsert, update: mocks.digestUpdate },
    notification: { create: mocks.notify },
  }));
  mocks.digestFind.mockImplementation(async () => mocks.row);
  mocks.digestUpsert.mockImplementation(async ({ create, update }) => {
    if (!mocks.row) mocks.row = { ...structuredClone(create), recipientCount: 0 };
    else Object.assign(mocks.row, structuredClone(update));
    return mocks.row;
  });
  mocks.digestUpdate.mockImplementation(async ({ data }) => {
    Object.assign(mocks.row!, structuredClone(data));
    return mocks.row;
  });
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
    expect(mocks.digestUpsert).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("never sends twice in one business day", async () => {
    mocks.row = { forDate: sevenAm, recipientCount: 2, summary: { subject: "Legacy digest", notified: 2, errors: [] } };
    const r = await sendDailyDigestIfDue(sevenAm, DEFAULT_POLICY);
    expect(r).toMatchObject({ sent: false, reason: "already-sent" });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("notifies the admins and emails each recipient", async () => {
    const r = await sendDailyDigestIfDue(sevenAm, DEFAULT_POLICY);
    expect(r).toMatchObject({ sent: true, emailed: 2, notified: 2, errors: [] });
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: "SYSTEM", link: "/admin/watch" }) }));
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
  it("retries only failed emails without repeating a successful notification", async () => {
    mocks.send.mockRejectedValueOnce(new Error("mailbox unavailable")).mockResolvedValue(undefined);
    await sendDailyDigestIfDue(sevenAm, DEFAULT_POLICY);
    mocks.send.mockClear();
    const result = await sendDailyDigestIfDue(new Date(sevenAm.getTime() + 15 * 60_000), DEFAULT_POLICY);
    expect(result).toMatchObject({ emailed: 1, notified: 0, errors: [] });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0]![0]).toBe(DEFAULT_POLICY.digestRecipientEmails[0]);
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    const again = await sendDailyDigestIfDue(new Date(sevenAm.getTime() + 30 * 60_000), DEFAULT_POLICY);
    expect(again.reason).toBe("already-sent");
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("retries a failed notification without repeating successful emails", async () => {
    mocks.notify.mockRejectedValueOnce(new Error("database unavailable")).mockResolvedValue({});
    const first = await sendDailyDigestIfDue(sevenAm, DEFAULT_POLICY);
    expect(first.errors[0]).toContain("database unavailable");
    const retry = await sendDailyDigestIfDue(new Date(sevenAm.getTime() + 15 * 60_000), DEFAULT_POLICY);
    expect(retry).toMatchObject({ emailed: 0, notified: 2, errors: [] });
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.notify).toHaveBeenCalledTimes(2);
  });

  it("recovers when composing the digest fails before any delivery", async () => {
    mocks.findingFind.mockRejectedValueOnce(new Error("query failed"));
    const first = await sendDailyDigestIfDue(sevenAm, DEFAULT_POLICY);
    expect(first.errors[0]).toContain("query failed");
    expect(mocks.send).not.toHaveBeenCalled();
    const retry = await sendDailyDigestIfDue(new Date(sevenAm.getTime() + 15 * 60_000), DEFAULT_POLICY);
    expect(retry).toMatchObject({ emailed: 2, notified: 2, errors: [] });
  });

  it("propagates database claim failures instead of reporting already sent", async () => {
    mocks.digestFind.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(sendDailyDigestIfDue(sevenAm, DEFAULT_POLICY)).rejects.toThrow("database unavailable");
  });

  it("leaves an active claim alone and recovers an abandoned claim", async () => {
    mocks.row = { forDate: sevenAm, recipientCount: 1, summary: {
      deliveryState: "sending", claimedAt: sevenAm.toISOString(),
      emailedTo: [DEFAULT_POLICY.digestRecipientEmails[0]], notificationSent: true, notified: 2,
    } };
    expect((await sendDailyDigestIfDue(sevenAm, DEFAULT_POLICY)).reason).toBe("already-sending");
    const retry = await sendDailyDigestIfDue(new Date(sevenAm.getTime() + 15 * 60_000), DEFAULT_POLICY);
    expect(retry).toMatchObject({ emailed: 1, notified: 0, errors: [] });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

});
