import { describe, expect, it } from "vitest";
import { buildDigest } from "./digest";
import {
  evaluateCloseBlockers,
  evaluateDuplicateEmployees,
  evaluateHoursVariance,
  evaluateMissingClockOut,
  periodHasEnded,
} from "./rules";
import { DEFAULT_POLICY, mergePolicy } from "./types";

const now = new Date("2026-11-02T20:00:00Z");
const h = (n: number) => n * 3_600_000;

describe("mergePolicy", () => {
  it("falls back to defaults and ignores wrong types", () => {
    expect(mergePolicy(null)).toEqual(DEFAULT_POLICY);
    const p = mergePolicy({ lunchMinutes: 45, maxShiftHours: "x", nope: 1 });
    expect(p.lunchMinutes).toBe(45);
    expect(p.maxShiftHours).toBe(DEFAULT_POLICY.maxShiftHours);
  });
});

describe("evaluateMissingClockOut", () => {
  const base = { entryId: "e1", employeeId: "p1", employeeName: "Ann Lee" };
  it("flags an entry past scheduled end plus grace", () => {
    const out = evaluateMissingClockOut(
      [{ ...base, clockIn: new Date(now.getTime() - h(9)), scheduledEnd: new Date(now.getTime() - h(2)) }],
      DEFAULT_POLICY,
      now,
      false,
    );
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe("WARN");
    expect(out[0].fingerprint).toBe("time.missing-clock-out:e1");
  });
  it("does not flag inside the grace window", () => {
    const out = evaluateMissingClockOut(
      [{ ...base, clockIn: new Date(now.getTime() - h(8)), scheduledEnd: new Date(now.getTime() - 30 * 60_000) }],
      DEFAULT_POLICY,
      now,
      false,
    );
    expect(out).toHaveLength(0);
  });
  it("flags a 12h+ entry with no schedule, critical when period closes soon", () => {
    const out = evaluateMissingClockOut(
      [{ ...base, clockIn: new Date(now.getTime() - h(13)), scheduledEnd: null }],
      DEFAULT_POLICY,
      now,
      true,
    );
    expect(out[0].severity).toBe("CRITICAL");
  });
  it("leaves a normal active shift alone", () => {
    const out = evaluateMissingClockOut(
      [{ ...base, clockIn: new Date(now.getTime() - h(3)), scheduledEnd: null }],
      DEFAULT_POLICY,
      now,
      false,
    );
    expect(out).toHaveLength(0);
  });
});

describe("evaluateCloseBlockers", () => {
  const p = {
    periodId: "p",
    title: "Oct 19 - Nov 1",
    periodEnd: new Date("2026-11-01T00:00:00Z"),
    closedAt: null,
    pendingApprovals: 3,
    openPunches: 1,
  };
  it("is critical when the period has ended", () => {
    const out = evaluateCloseBlockers(p, now);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe("CRITICAL");
    expect(out[0].title).toContain("4 items");
  });
  it("is a warning when close is near but not here", () => {
    const out = evaluateCloseBlockers({ ...p, periodEnd: new Date("2026-11-05T00:00:00Z") }, now);
    expect(out[0].severity).toBe("WARN");
  });
  it("stays quiet while the period is far from closing", () => {
    expect(evaluateCloseBlockers({ ...p, periodEnd: new Date("2026-11-10T00:00:00Z") }, now)).toHaveLength(0);
  });
  it("returns nothing when closed or clean", () => {
    expect(evaluateCloseBlockers({ ...p, closedAt: now }, now)).toHaveLength(0);
    expect(evaluateCloseBlockers({ ...p, pendingApprovals: 0, openPunches: 0 }, now)).toHaveLength(0);
  });
});

describe("evaluateHoursVariance", () => {
  const row = { employeeId: "a", employeeName: "Ann", periodId: "p" };
  it("flags a big change that is also big in hours", () => {
    const out = evaluateHoursVariance([{ ...row, currentMinutes: 60 * 60, previousMinutes: 80 * 60 }], DEFAULT_POLICY);
    expect(out).toHaveLength(1);
    expect(out[0].title).toContain("down 25%");
  });
  it("ignores small hour changes and zero baselines", () => {
    expect(evaluateHoursVariance([{ ...row, currentMinutes: 8 * 60, previousMinutes: 4 * 60 + 30 }], DEFAULT_POLICY)).toHaveLength(0);
    expect(evaluateHoursVariance([{ ...row, currentMinutes: 80 * 60, previousMinutes: 0 }], DEFAULT_POLICY)).toHaveLength(0);
  });
  it("respects an edited threshold", () => {
    const strict = { ...DEFAULT_POLICY, hoursVariancePct: 10 };
    const out = evaluateHoursVariance([{ ...row, currentMinutes: 72 * 60, previousMinutes: 80 * 60 }], strict);
    expect(out).toHaveLength(1);
  });
});

describe("periodHasEnded", () => {
  const end = new Date("2026-11-08T00:00:00Z");
  it("is false until the whole last day has passed", () => {
    expect(periodHasEnded(end, new Date("2026-11-02T20:00:00Z"))).toBe(false);
    expect(periodHasEnded(end, new Date("2026-11-08T23:59:00Z"))).toBe(false);
  });
  it("is true the day after", () => {
    expect(periodHasEnded(end, new Date("2026-11-09T00:00:00Z"))).toBe(true);
  });
});

describe("evaluateDuplicateEmployees", () => {
  it("flags reordered and one-letter-off names, stable fingerprint", () => {
    const out = evaluateDuplicateEmployees([
      { id: "b", name: "Chance Middleton" },
      { id: "a", name: "Chance MIddleton" },
      { id: "c", name: "Middleton Chance" },
      { id: "d", name: "Jamie Gonzales" },
      { id: "e", name: "Jose Gonzales" },
    ]);
    const fps = out.map((f) => f.fingerprint).sort();
    expect(fps).toContain("data.duplicate-employee:a:b");
    expect(fps).toContain("data.duplicate-employee:b:c");
    expect(fps.some((f) => f.includes(":d:") || f.includes(":e:"))).toBe(false);
  });
  it("does not flag distinct people sharing a last name", () => {
    expect(
      evaluateDuplicateEmployees([
        { id: "1", name: "Maria Torres" },
        { id: "2", name: "Pedro Torres" },
      ]),
    ).toHaveLength(0);
  });
});

describe("buildDigest", () => {
  const base = {
    autoResolvedSinceYesterday: 14,
    yesterdayHours: 312.5,
    yesterdayPunches: 41,
    periodTitle: "Nov 2 - Nov 15",
    daysToPeriodEnd: 12.2,
    baseUrl: "https://persona.example",
  };
  it("says all clear when nothing needs the manager", () => {
    const d = buildDigest({ ...base, open: [] });
    expect(d.subject).toBe("All clear. 14 resolved on their own.");
  });
  it("lists critical first and skips info", () => {
    const d = buildDigest({
      ...base,
      open: [
        { severity: "WARN", title: "B", fixLink: null, firstSeenAt: new Date(1) },
        { severity: "CRITICAL", title: "A", fixLink: "/x", firstSeenAt: new Date(2) },
        { severity: "INFO", title: "C", fixLink: null, firstSeenAt: new Date(0) },
      ],
    });
    expect(d.subject).toBe("2 need you, 14 resolved on their own.");
    expect(d.text.indexOf("A https://persona.example/x")).toBeLessThan(d.text.indexOf("[WARN] B"));
    expect(d.text).not.toContain("C\n");
  });
});
