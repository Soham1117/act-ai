import { describe, expect, it } from "vitest";
import {
  reportContractHours,
  reportFallingHours,
  reportNewHireRamp,
  reportOvertimeByDepartment,
  reportPayrollSummary,
  reportStaffingForecast,
  reportWatchQuality,
  reportWeeklyDigest,
} from "./rules-reports";

describe("reports", () => {
  it("contract hours show the change and the employee hours on the same code", () => {
    const out = reportContractHours(
      "2026-10-26",
      [{ agency: "Acme", jobCode: "PACK", minutes: 600, prevMinutes: 500 }],
      new Map([["pack", 1200]]),
    );
    expect(out[0]?.title).toContain("10.0h (+20%)");
    expect(out[0]?.detail).toContain("employees on this code: 20.0h");
    expect(reportContractHours("w", [], new Map())).toHaveLength(0);
  });

  it("payroll summary projects the period and names the biggest increases", () => {
    const out = reportPayrollSummary({
      periodId: "p",
      title: "Nov 2 - Nov 15",
      minutes: 1000 * 60,
      headcount: 40,
      prevMinutes: 2000 * 60,
      daysElapsed: 7,
      daysTotal: 14,
      topIncreases: [{ name: "Ann", minutes: 50 * 60, prevMinutes: 30 * 60 }],
    });
    expect(out[0]?.detail).toContain("2000.0h");
    expect(out[0]?.detail).toContain("Ann: 50.0h vs 30.0h");
  });

  it("weekly summary names repeat people, or says nobody", () => {
    expect(reportWeeklyDigest({ weekKey: "w", raised: 5, cleared: 3, openNow: 2, repeat: [{ name: "Ann", count: 4 }] })[0]?.detail).toContain("Ann (4)");
    expect(reportWeeklyDigest({ weekKey: "w", raised: 0, cleared: 0, openNow: 0, repeat: [] })[0]?.detail).toContain("Nobody");
  });

  it("flag quality shows the dismissed share", () => {
    const out = reportWatchQuality("w", [{ ruleId: "time.x", raised: 10, acknowledged: 2, dismissed: 6, snoozed: 2 }]);
    expect(out[0]?.detail).toContain("60% dismissed");
    expect(reportWatchQuality("w", [])).toHaveLength(0);
  });

  it("staffing forecast skips empty days", () => {
    const out = reportStaffingForecast("w", [
      { date: "2026-11-07", weekday: "Sat", scheduled: 0, onLeave: 0 },
      { date: "2026-11-09", weekday: "Mon", scheduled: 50, onLeave: 3 },
    ]);
    expect(out[0]?.detail).toBe("Mon 2026-11-09: 50 scheduled, 3 on approved leave");
  });

  it("overtime by department sorts by overtime", () => {
    const out = reportOvertimeByDepartment("w", [
      { department: "Dock", minutes: 3000, overtimeMinutes: 60, people: 3 },
      { department: "Office", minutes: 2000, overtimeMinutes: 300, people: 2 },
      { department: "Empty", minutes: 0, overtimeMinutes: 0, people: 0 },
    ]);
    expect(out[0]?.detail.split("\n")[0]).toContain("Office");
    expect(out[0]?.detail).not.toContain("Empty");
  });

  it("new hire ramp reports onboarding progress", () => {
    const out = reportNewHireRamp("w", [{ name: "Ann", hireDate: "2026-10-20", minutes: 1200, days: 5, itemsDone: 2, itemsTotal: 4 }]);
    expect(out[0]?.detail).toContain("2/4 items accepted");
    expect(reportNewHireRamp("w", [])).toHaveLength(0);
  });

  it("falling hours needs three steady drops from a real base", () => {
    const h = (...w: number[]) => w.map((x) => x * 60);
    expect(reportFallingHours("w", [{ name: "Ann", weeks: h(40, 32, 25, 18) }])).toHaveLength(1);
    expect(reportFallingHours("w", [{ name: "Bo", weeks: h(40, 40, 25, 18) }])).toHaveLength(0);
    expect(reportFallingHours("w", [{ name: "Cy", weeks: h(10, 8, 6, 4) }])).toHaveLength(0);
  });
});
