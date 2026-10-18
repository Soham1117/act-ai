/**
 * Seed part for payroll, admin time tracking and the employee time page.
 *
 * Rules that keep the older specs green:
 *  - every ACTIVE employee added here also gets approved hours in the base
 *    "E2E Pay Period" (so it still exports without an override);
 *  - no PENDING entries for Erin, and no open/stale/auto-closed-pending entries
 *    at rest (the time-tracking page opens on "Needs attention" when any exist).
 */
import type { SeedContext } from "../seed";
import {
  PERIOD_A,
  PERIOD_B,
  PERIOD_C,
  PT,
  PT_PASSWORD,
  ct,
  dateOnly,
} from "../support/payroll-time";
import { computeEntryTotals } from "../../src/lib/time-rules";

export default async function (ctx: SeedContext) {
  const { db, makeEmployee, daysAgo, admin } = ctx;

  const emps: Record<string, { id: string }> = {};
  for (const [key, e] of Object.entries(PT)) {
    const emp = await makeEmployee({
      employeeId: e.employeeId,
      name: e.name,
      email: e.email,
      password: PT_PASSWORD,
      pin: null,
    });
    emps[key] = emp;
  }
  // Alice is an admin who also has an employee record (needed to approve entries).
  await db.user.update({
    where: { id: (await db.employee.findUniqueOrThrow({ where: { id: emps.alice!.id } })).userId },
    data: { role: "ADMIN" },
  });
  await db.employee.update({ where: { id: emps.penny!.id }, data: { employmentStatus: "PENDING_REVIEW" } });

  type E = {
    emp: string; // PT key, or "erin" / "pia"
    ymd: string;
    from: string;
    to: string;
    approval?: "PENDING" | "APPROVED" | "REJECTED";
    breakMin?: number;
    autoClosed?: boolean;
    approvalNotes?: string;
    editReason?: string;
    source?: "MANUAL" | "KIOSK";
  };
  const idOf = (k: string) => (k === "erin" ? ctx.erin.id : k === "pia" ? ctx.pia.id : emps[k]!.id);

  async function entry(e: E) {
    const clockIn = ct(e.ymd, e.from);
    const clockOut = ct(e.ymd, e.to);
    const breaks: { startTime: Date; endTime: Date }[] = [];
    if (e.breakMin) {
      const mid = new Date(clockIn.getTime() + Math.floor((clockOut.getTime() - clockIn.getTime()) / 2));
      breaks.push({ startTime: mid, endTime: new Date(mid.getTime() + e.breakMin * 60_000) });
    }
    const t = computeEntryTotals({ clockIn, clockOut, breaks });
    const approval = e.approval ?? "APPROVED";
    await db.timeEntry.create({
      data: {
        employeeId: idOf(e.emp),
        date: dateOnly(e.ymd),
        clockIn,
        clockOut,
        jobCode: "E2E100",
        source: e.source ?? "MANUAL",
        status: approval === "PENDING" ? "COMPLETED" : approval,
        approvalStatus: approval,
        approvalDate: approval === "PENDING" ? null : new Date(),
        approvalNotes: e.approvalNotes ?? null,
        editReason: e.editReason ?? null,
        autoClosed: e.autoClosed ?? false,
        totalWorkMin: t.totalWorkMin,
        totalBreakMin: t.totalBreakMin,
        breaks: breaks.length
          ? { create: breaks.map((b) => ({ ...b, durationMin: e.breakMin!, type: "BREAK" as const })) }
          : undefined,
      },
    });
  }

  // ── Base period: everyone ACTIVE has approved hours there ───────────────
  for (const key of ["alice", "pat", "rita", "opal", "alma", "zed", "tina", "dana", "olga", "kira", "fiona", "bruno", "rex", "ella"]) {
    const d = daysAgo(55);
    const ymd = d.toISOString().slice(0, 10);
    await entry({ emp: key, ymd, from: "08:00", to: "16:00" });
  }

  // ── Pay periods ─────────────────────────────────────────────────────────
  for (const p of [PERIOD_A, PERIOD_B, PERIOD_C]) {
    await db.payrollCalendar.create({
      data: {
        title: p.title,
        payPeriodStart: dateOnly(p.start),
        payPeriodEnd: dateOnly(p.end),
        payDate: dateOnly(p.pay),
        status: "COMPLETED",
        createdById: admin.id,
      },
    });
  }

  // ── Overtime math (weeks run Mon-Sun) ───────────────────────────────────
  // Period A = Sat 2025-03-01 .. Fri 2025-03-14; B = Sat 03-15 .. Fri 03-28.
  // Erin: Sat 03-01 4h worked (4.5h minus a 30 min break) in the week of Feb 24,
  // then Mon-Fri 03-03..03-07 9h each = 45h -> 40 regular + 5 overtime.
  await entry({ emp: "erin", ymd: "2025-03-01", from: "08:00", to: "12:30", breakMin: 30 });
  for (const d of ["03", "04", "05", "06", "07"]) {
    await entry({ emp: "erin", ymd: `2025-03-${d}`, from: "08:00", to: "17:00" });
  }
  // Pia: the week of 03-10 straddles A and B. Mon-Thu 10h + Fri 8h = 48h in A
  // (40 regular + 8 overtime), then Sat 03-15 5h lands in B as pure overtime.
  for (const d of ["10", "11", "12", "13"]) {
    await entry({ emp: "pia", ymd: `2025-03-${d}`, from: "08:00", to: "18:00" });
  }
  await entry({ emp: "pia", ymd: "2025-03-14", from: "08:00", to: "16:00" });
  await entry({ emp: "pia", ymd: "2025-03-15", from: "08:00", to: "13:00" });
  // Excluded from the slip: a pending and a rejected entry (Rex, in period A).
  await entry({ emp: "rex", ymd: "2025-03-04", from: "08:00", to: "12:00", approval: "PENDING" });
  await entry({ emp: "rex", ymd: "2025-03-05", from: "08:00", to: "12:00", approval: "REJECTED", approvalNotes: "Wrong day" });

  // ── Readiness blockers in period C (Opal's open shift is inserted by the spec) ──
  await entry({ emp: "pat", ymd: "2025-04-02", from: "08:00", to: "16:00", approval: "PENDING" });
  await entry({ emp: "rita", ymd: "2025-04-03", from: "08:00", to: "16:00", approval: "REJECTED", approvalNotes: "Duplicate punch" });
  await entry({ emp: "alma", ymd: "2025-04-07", from: "08:00", to: "16:00", autoClosed: true, editReason: "Auto-closed: shift ran longer than 16 hours (counted time capped). Needs admin review." });
  await entry({ emp: "erin", ymd: "2025-04-08", from: "08:00", to: "16:00" });
  await entry({ emp: "pia", ymd: "2025-04-08", from: "08:00", to: "16:00" });

  // ── DST and overnight shifts (America/Chicago) ──────────────────────────
  // 2024-03-10 spring forward: 22:00 CST Sat -> 06:00 CDT Sun is only 7 elapsed hours.
  const dst = async (ymd: string, inAt: Date, outAt: Date) => {
    const t = computeEntryTotals({ clockIn: inAt, clockOut: outAt, breaks: [] });
    await db.timeEntry.create({
      data: {
        employeeId: emps.dana!.id,
        date: dateOnly(ymd),
        clockIn: inAt,
        clockOut: outAt,
        jobCode: "E2E100",
        source: "MANUAL",
        status: "APPROVED",
        approvalStatus: "APPROVED",
        approvalDate: new Date(),
        totalWorkMin: t.totalWorkMin,
      },
    });
  };
  await dst("2024-03-09", ct("2024-03-09", "22:00"), ct("2024-03-10", "06:00")); // 7h
  await dst("2024-11-02", ct("2024-11-02", "22:00"), ct("2024-11-03", "06:00")); // 9h
  // Fall-back repeated hour: first 01:30 (CDT) to 03:00 (CST) = 2h30.
  await dst("2024-11-03", new Date("2024-11-03T06:30:00Z"), new Date("2024-11-03T09:00:00Z"));

  // Overnight crossing midnight, no DST involved: 22:00 -> 06:00 next day (8h).
  const olgaIn = ct("2025-05-12", "22:00");
  const olgaOut = ct("2025-05-13", "06:00");
  await db.timeEntry.create({
    data: {
      employeeId: emps.olga!.id,
      date: dateOnly("2025-05-12"),
      clockIn: olgaIn,
      clockOut: olgaOut,
      jobCode: "E2E100",
      source: "MANUAL",
      status: "APPROVED",
      approvalStatus: "APPROVED",
      approvalDate: new Date(),
      totalWorkMin: 480,
    },
  });

  // ── Ella: employee-view data (fixed dates, outside the pay periods) ─────
  await entry({ emp: "ella", ymd: "2025-06-02", from: "08:00", to: "16:30", breakMin: 30 }); // approved, 8h
  await entry({ emp: "ella", ymd: "2025-06-03", from: "09:00", to: "13:00", approval: "PENDING" });
  await entry({ emp: "ella", ymd: "2025-06-04", from: "09:00", to: "13:00", approval: "REJECTED", approvalNotes: "Overlaps training day" });
  await entry({ emp: "ella", ymd: "2025-06-05", from: "08:00", to: "12:00", approval: "APPROVED", approvalNotes: "Thanks for the extra hour", editReason: "Clock-out corrected" });
  // Pia's private note must never show on Ella's page.
  await db.timeEntry.create({
    data: {
      employeeId: ctx.pia.id,
      date: dateOnly("2025-06-02"),
      clockIn: ct("2025-06-02", "08:00"),
      clockOut: ct("2025-06-02", "12:00"),
      jobCode: "E2E100",
      source: "MANUAL",
      status: "APPROVED",
      approvalStatus: "APPROVED",
      approvalNotes: "PIA-PRIVATE-NOTE",
      totalWorkMin: 240,
    },
  });
}
