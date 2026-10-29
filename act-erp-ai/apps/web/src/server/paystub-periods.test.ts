import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = {
  $executeRaw: vi.fn(),
  payrollCalendar: { findMany: vi.fn(), create: vi.fn() },
  auditLog: { create: vi.fn() },
};
vi.mock("@/lib/db", () => ({ db: { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } }));

import { ensureImportPeriods } from "./paystub-periods";

const row = (start: string, end: string) => ({ id: "p1", title: "Existing", payPeriodStart: new Date(`${start}T00:00:00Z`), payPeriodEnd: new Date(`${end}T00:00:00Z`) });

describe("ensureImportPeriods", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.payrollCalendar.findMany.mockResolvedValue([]);
    tx.payrollCalendar.create.mockImplementation(async ({ data }: { data: { payPeriodStart: Date } }) => ({ id: `new-${data.payPeriodStart.toISOString().slice(0, 10)}` }));
  });

  it("creates each distinct range once, oldest first, with the stub pay date", async () => {
    const result = await ensureImportPeriods("admin", [
      { start: "2026-01-19", end: "2026-02-01", payDate: "2026-02-06" },
      { start: "2026-01-05", end: "2026-01-18", payDate: "2026-01-23" },
      { start: "2026-01-05", end: "2026-01-18", payDate: "2026-01-23" },
    ]);
    expect(result.created.map((p) => p.start)).toEqual(["2026-01-05", "2026-01-19"]);
    expect(tx.payrollCalendar.create).toHaveBeenCalledTimes(2);
    expect(tx.payrollCalendar.create.mock.calls[0][0].data).toMatchObject({ notes: expect.stringContaining("automatically"), createdById: "admin" });
  });

  it("reuses an identical period and reports a partial overlap without editing", async () => {
    tx.payrollCalendar.findMany
      .mockResolvedValueOnce([row("2026-01-05", "2026-01-18")])
      .mockResolvedValueOnce([row("2026-01-15", "2026-01-28")]);
    const result = await ensureImportPeriods("admin", [
      { start: "2026-01-05", end: "2026-01-18", payDate: "2026-01-23" },
      { start: "2026-01-19", end: "2026-02-01", payDate: "2026-02-06" },
    ]);
    expect(result.existing).toBe(1);
    expect(result.created).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(tx.payrollCalendar.create).not.toHaveBeenCalled();
  });

  it("falls back to the period end as pay date and skips impossible dates", async () => {
    const result = await ensureImportPeriods("admin", [
      { start: "2026-03-01", end: "2026-03-14", payDate: null },
      { start: "2026-03-20", end: "2026-03-10", payDate: null },
    ]);
    expect(result.created).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
  });
});
