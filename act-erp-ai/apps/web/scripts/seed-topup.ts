/**
 * Top-up seed: fills the demo-data gap 2026-07-16 → today (2026-08-03) left
 * after seed-30-days.ts (which seeded the 30 days ending 2026-07-15).
 *
 *   pnpm tsx --env-file=.env.local scripts/seed-topup.ts
 *
 * Adds: time entries + breaks for the gap (incl. live "clocked in now" rows
 * for today), schedules + scheduled work for the gap and the next 7 days,
 * leave requests, general requests w/ history, reimbursements w/ history,
 * notifications, payroll-calendar roll-forward, and audit-log activity.
 * Also closes stale open time entries left "clocked in" since mid-July and
 * approves old pending timesheets so the books look tended-to.
 *
 * Never deletes rows and never touches the admin user. Idempotent: exits
 * early if an AuditLog row with action 'seed.topup.2026-08-03' exists
 * (written as the last step of a successful run).
 */
import { PrismaClient, Prisma } from "@prisma/client";

const db = new PrismaClient();

// ── Seeded RNG (mulberry32) so re-generated data is stable-ish ────────
let __seed = 20260803;
const rnd = () => {
  __seed |= 0;
  __seed = (__seed + 0x6d2b79f5) | 0;
  let t = Math.imul(__seed ^ (__seed >>> 15), 1 | __seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const randInt = (min: number, max: number) => Math.floor(rnd() * (max - min + 1)) + min;
const chance = (p: number) => rnd() < p;
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];

const NOW = new Date();
const TODAY = new Date(NOW);
TODAY.setHours(0, 0, 0, 0);
const addDays = (d: Date, n: number) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};
const at = (day: Date, h: number, m: number) => {
  const r = new Date(day);
  r.setHours(h, m, 0, 0);
  return r;
};
const addMin = (d: Date, min: number) => new Date(d.getTime() + min * 60000);
const D = (v: number) => new Prisma.Decimal(v.toFixed(2));
/** Clamp a computed timestamp so it never lands in the future. */
const pastCap = (d: Date) => (d.getTime() > NOW.getTime() ? addMin(NOW, -randInt(10, 600)) : d);
const dayRange = (day: Date) => ({ gte: day, lt: addDays(day, 1) });

const MARKER_ACTION = "seed.topup.2026-08-03";
// Gap: 2026-07-16 .. TODAY (seed-30-days covered through 2026-07-15, with
// schedules pre-created through 2026-07-22).
const GAP_START_OFFSET = -18; // TODAY-18 = 2026-07-16 when TODAY = 2026-08-03

type Emp = {
  id: string; userId: string; name: string; email: string | null; deptName: string;
  jobCode: string; rate: number;
};

async function main() {
  console.log("→ seed-topup. NOW =", NOW.toISOString());
  const todayLocal = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, "0")}-${String(TODAY.getDate()).padStart(2, "0")}`;
  if (todayLocal !== "2026-08-03") {
    console.warn(`   ⚠ expected local date 2026-08-03 but got ${todayLocal} — data will anchor to ${todayLocal}.`);
  }

  const marker = await db.auditLog.findFirst({ where: { action: MARKER_ACTION } });
  if (marker) {
    console.log(`✓ marker '${MARKER_ACTION}' already present — top-up already applied.`);
    await ensureSomeOnBreakToday();
    return;
  }

  const adminUser = await db.user.findUnique({ where: { email: "admin@actools.com" } });
  if (!adminUser) throw new Error("admin@actools.com not found — run seed-30-days first.");
  const adminEmp = await db.employee.findUnique({ where: { userId: adminUser.id } });
  if (!adminEmp) throw new Error("Admin employee record not found — run seed-30-days first.");

  const rows = await db.employee.findMany({
    where: { employmentStatus: "ACTIVE", id: { not: adminEmp.id } },
    include: { department: true, primaryJobCode: true },
    orderBy: { employeeId: "asc" },
  });
  const employees: Emp[] = rows.map(r => ({
    id: r.id, userId: r.userId, name: r.name, email: r.email,
    deptName: r.department?.name ?? "Manufacturing",
    jobCode: r.primaryJobCode?.code ?? "ASM001",
    rate: Number(r.defaultHourlyRate ?? 25),
  }));
  console.log(`   Active employees (excl. admin): ${employees.length}`);
  const earlyDepts = new Set(["Manufacturing", "Field Services"]);
  const mustClockInToday = new Set(["hana.yoshida@actools.com", "vanessa.chu@actools.com"]);

  // ── 1. Close stale open entries + approve old pending timesheets ────
  // seed-30-days left some employees "clocked in" on 2026-07-15/16 with no
  // clock-out; close those shifts on their own day so nobody has been on the
  // clock for three weeks.
  const stale = await db.timeEntry.findMany({
    where: { clockOut: null, date: { lt: TODAY } },
    include: { breaks: true },
  });
  for (const te of stale) {
    let breakMin = 0;
    for (const br of te.breaks) {
      if (br.endTime === null) {
        const dur = randInt(25, 40);
        await db.timeBreak.update({
          where: { id: br.id },
          data: { endTime: addMin(br.startTime, dur), durationMin: dur },
        });
        breakMin += dur;
      } else {
        breakMin += br.durationMin;
      }
    }
    const spanMin = randInt(480, 560); // 8–9.3h door-to-door
    const clockOut = addMin(te.clockIn, spanMin);
    const apprAt = pastCap(addMin(clockOut, randInt(600, 2880)));
    await db.timeEntry.update({
      where: { id: te.id },
      data: {
        clockOut, totalBreakMin: breakMin, totalWorkMin: spanMin - breakMin,
        status: "APPROVED", approvalStatus: "APPROVED",
        approvedById: adminEmp.id, approvalDate: apprAt,
      },
    });
  }
  console.log(`   Closed stale open entries: ${stale.length}`);
  // Older pending timesheets from the previous window: admin caught up.
  const catchUp = await db.timeEntry.updateMany({
    where: { approvalStatus: "PENDING", clockOut: { not: null }, date: { lt: addDays(TODAY, GAP_START_OFFSET) } },
    data: {
      status: "APPROVED", approvalStatus: "APPROVED",
      approvedById: adminEmp.id, approvalDate: addDays(TODAY, GAP_START_OFFSET + 1),
    },
  });
  console.log(`   Approved old pending timesheets: ${catchUp.count}`);

  // ── 2. Schedules + ScheduledWork + TimeEntries (gap … +7d) ──────────
  let schedC = 0, swC = 0, swUpd = 0, teC = 0;
  let clockedInToday = 0, onBreakToday = 0, earlyOutToday = 0;
  for (let i = GAP_START_OFFSET; i <= 7; i++) {
    const day = addDays(TODAY, i);
    const dow = day.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const isPast = i < 0;
    const isToday = i === 0;

    // What already exists for this day (old seed pre-built 07-16 … 07-22).
    const existingSW = await db.scheduledWork.findMany({ where: { date: dayRange(day) } });
    const swByEmp = new Map(existingSW.map(r => [r.employeeId, r]));
    const schedSet = new Set(
      (await db.schedule.findMany({ where: { date: dayRange(day) }, select: { employeeId: true } })).map(r => r.employeeId),
    );
    const teSet = new Set(
      (await db.timeEntry.findMany({ where: { date: dayRange(day) }, select: { employeeId: true } })).map(r => r.employeeId),
    );

    for (const emp of employees) {
      const early = earlyDepts.has(emp.deptName);

      // Weekend: only occasional Manufacturing / Field Services Saturdays.
      if (isWeekend) {
        if (dow !== 6 || !early || !isPast || !chance(0.16) || teSet.has(emp.id)) continue;
        const clockIn = at(day, 7, randInt(0, 20));
        const spanMin = randInt(300, 380);
        const breakMin = 30;
        const clockOut = addMin(clockIn, spanMin);
        await db.timeEntry.create({
          data: {
            employeeId: emp.id, date: day, clockIn, clockOut,
            totalBreakMin: breakMin, totalWorkMin: spanMin - breakMin,
            status: "APPROVED", approvalStatus: "APPROVED",
            approvedById: adminEmp.id, approvalDate: pastCap(addMin(clockOut, randInt(600, 2400))),
            jobCode: emp.jobCode, rate: D(emp.rate), source: "KIOSK",
            kioskSlug: "plant-floor", kioskLabel: "Plant Floor Kiosk",
            timesheetNotes: pick(["Saturday overtime — rush order", "Weekend turnaround for Permian customer", "Saturday shift — field tool redress backlog"]),
            createdAt: clockOut,
            breaks: { create: [{ startTime: at(day, 10, 0), endTime: at(day, 10, 30), durationMin: 30, type: "BREAK" }] },
          },
        });
        teC++;
        continue;
      }

      // Weekday. ~8% fully absent unless the old seed already scheduled them.
      const hadSched = schedSet.has(emp.id);
      if (!hadSched && chance(0.08)) continue;

      const startH = early ? 7 : 8;
      const endH = early ? 15 : 17;
      const endM = early ? 30 : 0;
      const schedStart = at(day, startH, 0);
      const schedEnd = at(day, endH, endM);
      const netHours = (schedEnd.getTime() - schedStart.getTime()) / 3600000 - 1;

      const missed = isPast && !teSet.has(emp.id) && chance(0.05); // no-show
      if (!hadSched) {
        await db.schedule.create({
          data: {
            employeeId: emp.id, date: day, jobCode: emp.jobCode,
            startTime: `${String(startH).padStart(2, "0")}:00`,
            endTime: `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`,
            createdById: adminEmp.id,
          },
        });
        schedC++;
      }
      const existing = swByEmp.get(emp.id);
      if (existing) {
        if (isPast) {
          await db.scheduledWork.update({
            where: { id: existing.id },
            data: { status: missed ? "SCHEDULED" : "COMPLETED", timesheetGenerated: !missed },
          });
          swUpd++;
        }
      } else {
        await db.scheduledWork.create({
          data: {
            employeeId: emp.id, date: day, startTime: schedStart, endTime: schedEnd,
            status: isPast ? (missed ? "SCHEDULED" : "COMPLETED") : "SCHEDULED",
            timesheetGenerated: isPast && !missed,
            jobCode: emp.jobCode, rate: D(emp.rate),
            totalBreakMin: 60, netWorkHours: netHours,
          },
        });
        swC++;
      }

      if (!isPast && !isToday) continue; // future: schedule only
      if (missed || teSet.has(emp.id)) continue;

      // Punctuality: ~80% within ±10 min, ~10% late 15–45, ~10% a bit early.
      const roll = rnd();
      const offsetMin = roll < 0.8 ? randInt(-12, 9) : roll < 0.9 ? randInt(15, 45) : randInt(-28, -13);
      const clockIn = addMin(schedStart, offsetMin);

      if (isToday) {
        // Mid-day (~13:30): ~45% currently clocked in, some done early, rest
        // absent / not punched in. Hana Yoshida + Vanessa Chu must be on the clock.
        const asOf = new Date(Math.max(NOW.getTime(), at(day, 11, 30).getTime()));
        const forced = mustClockInToday.has(emp.email ?? "");
        const r = forced ? 0 : rnd();
        if (r < 0.45) {
          // Guarantee a couple ON_BREAK: fall back to forcing once enough
          // people are on the clock and none have taken a break yet.
          const onBreak = !forced && onBreakToday < 2 && (chance(0.22) || clockedInToday >= 4 + onBreakToday * 3);
          const elapsed = Math.max(45, Math.round((asOf.getTime() - clockIn.getTime()) / 60000));
          const brDone = elapsed > 300 ? randInt(25, 40) : 0;
          const breaks: Prisma.TimeBreakCreateWithoutTimeEntryInput[] = [];
          if (brDone > 0) breaks.push({ startTime: at(day, 11, 45), endTime: addMin(at(day, 11, 45), brDone), durationMin: brDone, type: "LUNCH" });
          if (onBreak) breaks.push({ startTime: addMin(asOf, -randInt(3, 15)), endTime: null, durationMin: 0, type: brDone > 0 ? "BREAK" : "LUNCH" });
          await db.timeEntry.create({
            data: {
              employeeId: emp.id, date: day, clockIn, clockOut: null,
              status: onBreak ? "ON_BREAK" : "ACTIVE",
              totalBreakMin: brDone, totalWorkMin: Math.max(0, elapsed - brDone),
              approvalStatus: "PENDING",
              jobCode: emp.jobCode, rate: D(emp.rate),
              source: early ? "KIOSK" : "WEB",
              kioskSlug: early ? "plant-floor" : null,
              kioskLabel: early ? "Plant Floor Kiosk" : null,
              createdAt: clockIn,
              breaks: { create: breaks },
            },
          });
          teC++; clockedInToday++;
          if (onBreak) onBreakToday++;
        } else if (r < 0.62) {
          // Completed early/short shift, awaiting approval.
          const breakMin = randInt(30, 45);
          const maxSpan = Math.round((asOf.getTime() - clockIn.getTime()) / 60000) - randInt(0, 45);
          const spanMin = Math.max(240, Math.min(maxSpan, randInt(390, 480)));
          const clockOut = addMin(clockIn, spanMin);
          await db.timeEntry.create({
            data: {
              employeeId: emp.id, date: day, clockIn, clockOut,
              totalBreakMin: breakMin, totalWorkMin: spanMin - breakMin,
              status: "PENDING_APPROVAL", approvalStatus: "PENDING",
              jobCode: emp.jobCode, rate: D(emp.rate),
              source: early ? "KIOSK" : "WEB",
              createdAt: clockOut,
              breaks: { create: [{ startTime: at(day, 11, 30), endTime: addMin(at(day, 11, 30), breakMin), durationMin: breakMin, type: "LUNCH" }] },
            },
          });
          teC++; earlyOutToday++;
        }
        continue;
      }

      // Past weekday, worked. Occasional 10–11h overtime day.
      const ot = chance(0.07);
      const breakMin = randInt(30, 60);
      const workMin = ot ? randInt(600, 660) : randInt(450, 565); // 7.5–9.4h, OT 10–11h
      const clockOut = addMin(clockIn, workMin + breakMin);
      const lunchStart = at(day, early ? 11 : 12, randInt(0, 30));
      const apprAt = addMin(clockOut, randInt(240, 2880));
      // Last 2–3 days: a pending/approved mix. Older: approved.
      const approved = (i < -3 ? true : chance(0.5)) && apprAt.getTime() <= NOW.getTime();
      await db.timeEntry.create({
        data: {
          employeeId: emp.id, date: day, clockIn, clockOut,
          totalBreakMin: breakMin, totalWorkMin: workMin,
          status: approved ? "APPROVED" : "PENDING_APPROVAL",
          approvalStatus: approved ? "APPROVED" : "PENDING",
          approvedById: approved ? adminEmp.id : null,
          approvalDate: approved ? apprAt : null,
          jobCode: emp.jobCode, rate: D(emp.rate),
          source: early ? (chance(0.7) ? "KIOSK" : "WEB") : chance(0.12) ? "AUTO" : "WEB",
          kioskSlug: early && chance(0.7) ? "plant-floor" : null,
          kioskLabel: early && chance(0.7) ? "Plant Floor Kiosk" : null,
          timesheetNotes: ot ? pick(["Stayed late to finish packer sub run", "Overtime — expedite order for Permian customer", "Covered second shift start", "Late finish — frac plug qualification build"]) : null,
          createdAt: clockOut,
          breaks: { create: [{ startTime: lunchStart, endTime: addMin(lunchStart, breakMin), durationMin: breakMin, type: "LUNCH" }] },
        },
      });
      teC++;
    }
  }
  console.log(`   Schedules: +${schedC}, ScheduledWork: +${swC} (updated ${swUpd}), TimeEntries: +${teC}`);
  console.log(`   Today: ${clockedInToday} clocked in (${onBreakToday} on break), ${earlyOutToday} early-out pending`);

  // ── 3. Leave requests over the gap + upcoming approved ──────────────
  const bumpLeave = async (empId: string, f: "approved" | "rejected", days: number, taken: number) => {
    await db.employee.update({
      where: { id: empId },
      data: {
        ...(f === "approved"
          ? { leavesApproved: { increment: days }, leavesTaken: { increment: taken }, leavesRemaining: { decrement: taken } }
          : { leavesRejected: { increment: days } }),
      },
    });
  };
  let lvC = 0;
  const leaveDescriptions: Record<string, string[]> = {
    VACATION: ["Beach week booked before the summer rush.", "Using banked vacation before Q3 push.", "Long weekend at Possum Kingdom Lake."],
    SICK: ["Summer flu — staying off the shop floor.", "Outpatient procedure + recovery day.", "Food poisoning, doctor's note available."],
    PERSONAL: ["Closing on a refinance, need the morning.", "DMV and personal errands.", "Helping my kid move into the dorms."],
    FAMILY: ["Family reunion in Oklahoma.", "Kid's orthodontist marathon.", "Parents visiting from out of state."],
    EMERGENCY: ["AC died in the Texas heat — waiting on the repair crew."],
  };
  // Past-gap leaves (mixed statuses).
  const pastLeaves: Array<{ type: "VACATION" | "SICK" | "PERSONAL" | "FAMILY" | "EMERGENCY"; status: "APPROVED" | "REJECTED" | "PENDING"; startAgo: number; days: number }> = [
    { type: "VACATION", status: "APPROVED", startAgo: 15, days: 3 },
    { type: "SICK", status: "APPROVED", startAgo: 10, days: 2 },
    { type: "EMERGENCY", status: "APPROVED", startAgo: 7, days: 1 },
    { type: "PERSONAL", status: "REJECTED", startAgo: 6, days: 2 },
    { type: "FAMILY", status: "PENDING", startAgo: -9, days: 2 }, // upcoming, still pending
  ];
  const leaveEmps = [...employees].sort(() => rnd() - 0.5).slice(0, pastLeaves.length + 2);
  for (let k = 0; k < pastLeaves.length; k++) {
    const s = pastLeaves[k];
    const emp = leaveEmps[k];
    const start = addDays(TODAY, -s.startAgo);
    const createdAt = pastCap(addDays(start, -randInt(2, 8)));
    await db.leaveRequest.create({
      data: {
        employeeId: emp.id, leaveType: s.type,
        startDate: start, endDate: addDays(start, s.days - 1), totalDays: s.days,
        noticeDays: Math.max(0, Math.round((start.getTime() - createdAt.getTime()) / 86400000)),
        description: pick(leaveDescriptions[s.type]),
        status: s.status,
        reviewerId: s.status === "PENDING" ? null : adminEmp.id,
        reviewedAt: s.status === "PENDING" ? null : pastCap(addDays(createdAt, randInt(1, 3))),
        reviewNotes: s.status === "APPROVED" ? pick(["Approved — coverage arranged.", "OK, enjoy.", "Approved, shift board updated."]) : s.status === "REJECTED" ? "Two techs already out that week — pick other dates." : null,
        createdAt,
      },
    });
    if (s.status === "APPROVED") await bumpLeave(emp.id, "approved", s.days, s.startAgo > 0 ? s.days : 0);
    if (s.status === "REJECTED") await bumpLeave(emp.id, "rejected", s.days, 0);
    lvC++;
  }
  // 2 APPROVED leaves overlapping the next 30 days.
  for (let k = 0; k < 2; k++) {
    const emp = leaveEmps[pastLeaves.length + k];
    const start = addDays(TODAY, randInt(4, 22));
    const days = randInt(2, 5);
    await db.leaveRequest.create({
      data: {
        employeeId: emp.id, leaveType: pick(["VACATION", "FAMILY"] as const),
        startDate: start, endDate: addDays(start, days - 1), totalDays: days,
        noticeDays: randInt(7, 21),
        description: pick(["Pre-approved late-summer vacation.", "Out-of-state wedding.", "Cabin trip booked in spring."]),
        status: "APPROVED", reviewerId: adminEmp.id,
        reviewedAt: addDays(TODAY, -randInt(1, 5)),
        reviewNotes: "Approved in advance — calendar updated.",
        createdAt: addDays(TODAY, -randInt(6, 14)),
      },
    });
    await bumpLeave(emp.id, "approved", days, 0);
    lvC++;
  }
  console.log(`   LeaveRequests: +${lvC}`);

  // ── 4. General requests (~6 over the gap) ───────────────────────────
  const reqSpecs: Array<{ type: Prisma.RequestCreateInput["type"]; title: string; description: string; daysAgo: number; final: "COMPLETED" | "REJECTED" | "PROCESSING" | "PENDING" }> = [
    { type: "EQUIPMENT_REQUEST", title: "Bandsaw blades for the cutoff saw", description: "Bay 2 cutoff saw is down to its last blade and the current one is drifting. Need a box of bi-metal 1.25\" blades before the next mandrel batch.", daysAgo: 16, final: "COMPLETED" },
    { type: "TRAINING_REQUEST", title: "Confined space entry refresher", description: "My confined-space cert lapses end of August and the Pecos job has tank work. Requesting the one-day refresher in Fort Worth.", daysAgo: 13, final: "COMPLETED" },
    { type: "SCHEDULE_CHANGE", title: "Early shift during school year", description: "School starts Aug 17 — requesting a move to the 6:00 start so I can handle afternoon pickup. Happy to keep Fridays flexible.", daysAgo: 10, final: "REJECTED" },
    { type: "PAYROLL_INQUIRY", title: "Per diem missing for Midland job", description: "Worked the four-day Midland completion string install in July but the per diem isn't on my last stub. Field tickets are in the truck folder.", daysAgo: 7, final: "PROCESSING" },
    { type: "ACCESS_REQUEST", title: "Shared drive access — API audit folder", description: "Prepping evidence binders for the Spec Q1 surveillance audit. Need read-write on the QA audit share through September.", daysAgo: 3, final: "PENDING" },
    { type: "DOCUMENT_REQUEST", title: "Employment letter for apartment lease", description: "Apartment complex needs an employment verification letter with salary before Friday. Please address to Trinity Bluff Leasing.", daysAgo: 1, final: "PENDING" },
  ];
  let reqC = 0;
  for (const s of reqSpecs) {
    const emp = pick(employees);
    const createdAt = addDays(NOW, -s.daysAgo);
    createdAt.setHours(randInt(8, 16), randInt(0, 59), 0, 0);
    const decided = s.final === "COMPLETED" || s.final === "REJECTED";
    const processingAt = pastCap(addMin(createdAt, randInt(4, 48) * 60));
    const decidedAt = pastCap(addMin(createdAt, randInt(24, 120) * 60));
    const history: Prisma.RequestStatusHistoryCreateWithoutRequestInput[] = [
      { status: "PENDING", note: "Request submitted.", updatedById: emp.id, updatedAt: createdAt },
    ];
    if (s.final !== "PENDING") {
      history.push({ status: "PROCESSING", note: pick(["Picked up for review.", "Gathering details from supervisor.", "Checking budget and coverage."]), updatedById: adminEmp.id, updatedAt: processingAt });
    }
    if (decided) {
      history.push({
        status: s.final,
        note: s.final === "COMPLETED" ? pick(["Done — see notes.", "Approved and processed.", "Completed, confirmation sent by email."]) : "Can't hold the 6:00 slot open — revisit after the audit.",
        updatedById: adminEmp.id, updatedAt: decidedAt,
      });
    }
    await db.request.create({
      data: {
        employeeId: emp.id, type: s.type, title: s.title, description: s.description,
        status: s.final,
        adminNotes: decided ? (s.final === "REJECTED" ? "Reviewed with department lead — cannot accommodate right now." : "Handled by admin — closed out.") : null,
        reviewerId: s.final === "PENDING" ? null : adminEmp.id,
        createdAt,
        updatedAt: decided ? decidedAt : s.final === "PROCESSING" ? processingAt : createdAt,
        history: { create: history },
      },
    });
    reqC++;
  }
  console.log(`   Requests: +${reqC}`);

  // ── 5. Reimbursements (~8 over the gap) ─────────────────────────────
  const reimbSpecs: Array<{ title: string; category: Prisma.ReimbursementCreateInput["category"]; amount: number; description: string; tags: string[]; daysAgo: number; status: "PAID" | "APPROVED" | "UNDER_REVIEW" | "PENDING" | "REJECTED" }> = [
    { title: "Fuel — service truck, Odessa run", category: "FUEL", amount: 182.6, description: "Diesel for the F-350 on a two-day frac plug delivery and setting-tool swap near Odessa.", tags: ["field", "truck"], daysAgo: 17, status: "PAID" },
    { title: "Hotel — 2 nights, Pecos completion job", category: "ACCOMMODATION", amount: 301.4, description: "La Quinta Pecos during the toe-sleeve install for the Delaware Basin pad.", tags: ["field", "hotel"], daysAgo: 15, status: "PAID" },
    { title: "Mileage — Cleburne heat-treat expedite", category: "TRAVEL", amount: 88.2, description: "Two round trips to the heat-treat vendor chasing the slip segment batch for the rush order.", tags: ["mileage"], daysAgo: 12, status: "PAID" },
    { title: "PPE — impact gloves and Z87 glasses", category: "EQUIPMENT", amount: 146.3, description: "Replacement impact gloves plus prescription-insert safety glasses for wireline work.", tags: ["ppe", "safety"], daysAgo: 10, status: "APPROVED" },
    { title: "Customer dinner — Halliburton completions", category: "MEALS", amount: 187.45, description: "Dinner with three Halliburton completions engineers reviewing the HPHT seal stack trial results.", tags: ["sales"], daysAgo: 8, status: "APPROVED" },
    { title: "Overnight shipping — thread gauges to Houston", category: "OTHER", amount: 64.5, description: "Overnighted the API ring gauges to the Houston lab for recalibration before the audit.", tags: ["quality", "shipping"], daysAgo: 5, status: "UNDER_REVIEW" },
    { title: "OSHA 10 course — new assembler", category: "TRAINING", amount: 189.0, description: "OSHA 10 general industry course for the new assembly hire, per plant policy.", tags: ["safety", "training"], daysAgo: 3, status: "REJECTED" },
    { title: "Hotel — frac plug field trial, Carlsbad", category: "ACCOMMODATION", amount: 265.8, description: "Two nights in Carlsbad NM supporting the composite frac plug field trial on the customer pad.", tags: ["field", "hotel"], daysAgo: 1, status: "PENDING" },
  ];
  let reimbC = 0;
  for (const s of reimbSpecs) {
    const emp = pick(employees);
    const createdAt = addDays(NOW, -s.daysAgo);
    createdAt.setHours(randInt(8, 17), randInt(0, 59), 0, 0);
    const expenseDate = addDays(createdAt, -randInt(1, 6));
    const reviewedAt = s.status === "PENDING" ? null : pastCap(addMin(createdAt, randInt(12, 72) * 60));
    const approvalDate = s.status === "APPROVED" || s.status === "PAID" ? reviewedAt : null;
    const paidDate = s.status === "PAID" ? pastCap(addMin(reviewedAt!, randInt(24, 96) * 60)) : null;
    const history: Prisma.ReimbursementStatusHistoryCreateWithoutReimbursementInput[] = [
      { status: "PENDING", note: "Submitted with receipt.", updatedById: emp.id, updatedAt: createdAt },
    ];
    if (s.status !== "PENDING") history.push({ status: "UNDER_REVIEW", note: "Reviewing receipt and coding.", updatedById: adminEmp.id, updatedAt: pastCap(addMin(createdAt, randInt(4, 24) * 60)) });
    if (s.status === "APPROVED" || s.status === "PAID" || s.status === "REJECTED") {
      history.push({ status: s.status === "REJECTED" ? "REJECTED" : "APPROVED", note: s.status === "REJECTED" ? "Course fee should go through the training budget, not reimbursement — resubmit as a training request." : "Approved for next payment run.", updatedById: adminEmp.id, updatedAt: reviewedAt! });
    }
    if (s.status === "PAID") history.push({ status: "PAID", note: "Paid via ACH with payroll run.", updatedById: adminEmp.id, updatedAt: paidDate! });
    await db.reimbursement.create({
      data: {
        employeeId: emp.id, title: s.title, category: s.category,
        amount: D(s.amount), description: s.description, expenseDate,
        status: s.status, priority: s.amount > 250 ? "HIGH" : "MEDIUM", tags: s.tags,
        reviewerId: s.status === "PENDING" ? null : adminEmp.id,
        reviewedAt, approvalDate,
        reviewNotes: s.status === "REJECTED" ? "Training costs route through the department training budget." : s.status === "PENDING" ? null : "Coded to department expense account.",
        paidDate, paidAmount: s.status === "PAID" ? D(s.amount) : null,
        createdAt, updatedAt: paidDate ?? reviewedAt ?? createdAt,
        history: { create: history },
      },
    });
    reimbC++;
  }
  console.log(`   Reimbursements: +${reimbC}`);

  // ── 6. Notifications (~5 over the gap) ──────────────────────────────
  const allEmpIds = [...employees.map(e => e.id), adminEmp.id];
  const deptIds = (...depts: string[]) => employees.filter(e => depts.includes(e.deptName)).map(e => e.id);
  const keepUnreadIds = new Set(employees.filter(e => mustClockInToday.has(e.email ?? "")).map(e => e.id));
  const notifSpecs: Array<{ type: Prisma.NotificationCreateInput["type"]; title: string; message: string; priority: Prisma.NotificationCreateInput["priority"]; daysAgo: number; recipients: string[]; keepUnread?: boolean }> = [
    { type: "PAYROLL", title: "July 20 – Aug 2 payroll processed", message: "The Jul 20 – Aug 2 period is closed and direct deposits post Saturday Aug 8. Check your stub in the portal and flag discrepancies to accounting by Wednesday.", priority: "HIGH", daysAgo: 1, recipients: allEmpIds, keepUnread: true },
    { type: "POLICY", title: "Heat safety — mandatory hydration breaks", message: "Heat index is running over 105 this week. Shop floor and field crews: 10-minute shaded water break every 2 hours is mandatory, and buddy-check for heat exhaustion symptoms.", priority: "URGENT", daysAgo: 5, recipients: deptIds("Manufacturing", "Field Services", "Quality Assurance") },
    { type: "ANNOUNCEMENT", title: "API Spec Q1 audit dates confirmed", message: "The registrar confirmed the surveillance audit for Sep 9–10. QA will run mock-audit walkthroughs the last week of August — leads, keep calibration records current.", priority: "HIGH", daysAgo: 4, recipients: allEmpIds, keepUnread: true },
    { type: "COMPANY", title: "Open enrollment closes Aug 15", message: "Benefits open enrollment is live through Aug 15. Two info sessions left: Tuesday 7 AM (break room) and Thursday 4 PM (training room). No changes = current elections roll over.", priority: "MEDIUM", daysAgo: 8, recipients: allEmpIds, keepUnread: true },
    { type: "ANNOUNCEMENT", title: "Haas ST-35Y is live in Bay 3", message: "The new lathe cut its first packer mandrels last week. Setup sheets are in the traveler binder; see Raul before running unattended lights-out jobs on it.", priority: "MEDIUM", daysAgo: 12, recipients: deptIds("Manufacturing", "Engineering", "Quality Assurance") },
  ];
  let notifC = 0;
  for (const s of notifSpecs) {
    const createdAt = addDays(NOW, -s.daysAgo);
    createdAt.setHours(randInt(7, 16), randInt(0, 59), 0, 0);
    await db.notification.create({
      data: {
        type: s.type, title: s.title, message: s.message, priority: s.priority,
        senderId: adminUser.id, createdAt: pastCap(createdAt),
        recipients: {
          create: s.recipients.map(empId => {
            const read = s.keepUnread && keepUnreadIds.has(empId) ? false : chance(0.6);
            return {
              employeeId: empId, read,
              readAt: read ? pastCap(addMin(createdAt, randInt(30, Math.max(60, s.daysAgo * 24 * 60)))) : null,
            };
          }),
        },
      },
    });
    notifC++;
  }
  console.log(`   Notifications: +${notifC}`);

  // ── 7. Payroll calendar roll-forward ────────────────────────────────
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const ended = await db.payrollCalendar.updateMany({
    where: { payPeriodEnd: { lt: TODAY }, status: { not: "COMPLETED" } },
    data: { status: "COMPLETED" },
  });
  let pcC = 0;
  // Bi-weekly cadence continues from Jul 20 – Aug 2: next periods start Aug 3.
  for (let p = 0; p <= 1; p++) {
    const start = addDays(TODAY, p * 14); // TODAY = 2026-08-03 is a period start
    const end = addDays(start, 13);
    const payDate = addDays(end, 6);
    const status: Prisma.PayrollCalendarCreateInput["status"] = p === 0 ? "CURRENT" : "UPCOMING";
    const exists = await db.payrollCalendar.findFirst({ where: { payPeriodStart: dayRange(start) } });
    if (exists) {
      if (exists.status !== status) await db.payrollCalendar.update({ where: { id: exists.id }, data: { status } });
      continue;
    }
    await db.payrollCalendar.create({
      data: {
        title: `Bi-weekly · ${fmt(start)} – ${fmt(end)}, ${end.getFullYear()}`,
        payPeriodStart: start, payPeriodEnd: end, payDate, status,
        notes: p === 0 ? "Current period — timesheet approvals due by Friday noon." : null,
        createdById: adminUser.id,
      },
    });
    pcC++;
  }
  console.log(`   PayrollCalendar: +${pcC} (marked ${ended.count} ended period(s) COMPLETED)`);

  // ── 8. Audit log (~60 rows over the gap) ────────────────────────────
  const auditActions: Array<{ action: string; resource: string; adminOnly: boolean }> = [
    { action: "auth.login", resource: "User", adminOnly: false },
    { action: "auth.login", resource: "User", adminOnly: false },
    { action: "auth.login", resource: "User", adminOnly: false },
    { action: "timesheet.approve", resource: "TimeEntry", adminOnly: true },
    { action: "timesheet.approve", resource: "TimeEntry", adminOnly: true },
    { action: "timesheet.clock_in", resource: "TimeEntry", adminOnly: false },
    { action: "timesheet.clock_out", resource: "TimeEntry", adminOnly: false },
    { action: "leave.create", resource: "LeaveRequest", adminOnly: false },
    { action: "leave.approve", resource: "LeaveRequest", adminOnly: true },
    { action: "leave.reject", resource: "LeaveRequest", adminOnly: true },
    { action: "employee.update", resource: "Employee", adminOnly: true },
    { action: "employee.view", resource: "Employee", adminOnly: true },
    { action: "schedule.create", resource: "Schedule", adminOnly: true },
    { action: "schedule.update", resource: "ScheduledWork", adminOnly: true },
    { action: "reimbursement.create", resource: "Reimbursement", adminOnly: false },
    { action: "reimbursement.approve", resource: "Reimbursement", adminOnly: true },
    { action: "reimbursement.pay", resource: "Reimbursement", adminOnly: true },
    { action: "request.create", resource: "Request", adminOnly: false },
    { action: "request.update", resource: "Request", adminOnly: true },
    { action: "notification.send", resource: "Notification", adminOnly: true },
    { action: "payroll.upload", resource: "Payroll", adminOnly: true },
    { action: "knowledge.search", resource: "KnowledgeDocument", adminOnly: false },
    { action: "knowledge.search", resource: "KnowledgeDocument", adminOnly: false },
    { action: "knowledge.upload", resource: "KnowledgeDocument", adminOnly: false },
    { action: "kiosk.session.create", resource: "KioskSession", adminOnly: true },
    { action: "document.download", resource: "Document", adminOnly: false },
  ];
  const cuidish = () => "c" + Math.floor(rnd() * 1e16).toString(36).padStart(11, "0");
  const gapDays = -GAP_START_OFFSET; // 18
  const auditRows: Prisma.AuditLogCreateManyInput[] = [];
  for (let k = 0; k < 60; k++) {
    const spec = pick(auditActions);
    const actor = spec.adminOnly || chance(0.35)
      ? { userId: adminUser.id, email: adminUser.email }
      : (() => { const e = pick(employees); return { userId: e.userId, email: e.email }; })();
    const t = addDays(TODAY, -randInt(0, gapDays));
    t.setHours(randInt(6, 18), randInt(0, 59), randInt(0, 59), 0);
    auditRows.push({
      actorId: actor.userId, actorEmail: actor.email,
      action: spec.action, resource: `${spec.resource}:${cuidish()}`,
      ip: `10.20.${randInt(0, 4)}.${randInt(2, 250)}`,
      createdAt: pastCap(t),
    });
  }
  await db.auditLog.createMany({ data: auditRows });
  console.log(`   AuditLog: +${auditRows.length}`);

  // ── 9. Idempotency marker ───────────────────────────────────────────
  await db.auditLog.create({
    data: {
      actorId: adminUser.id, actorEmail: adminUser.email,
      action: MARKER_ACTION, resource: "SeedScript:seed-topup",
      diff: {
        staleClosed: stale.length, oldApproved: catchUp.count,
        timeEntries: teC, schedules: schedC, scheduledWorkCreated: swC, scheduledWorkUpdated: swUpd,
        clockedInToday, onBreakToday, earlyOutToday,
        leaves: lvC, requests: reqC, reimbursements: reimbC, notifications: notifC, payrollPeriods: pcC, auditRows: auditRows.length,
      },
    },
  });
  console.log(`✓ done — marker written (delete AuditLog action '${MARKER_ACTION}' to allow re-running)`);
}

/**
 * Invariant repair (idempotent): a couple of today's clocked-in employees
 * should be ON_BREAK with an open TimeBreak row, so the live dashboard shows
 * a realistic mix. RNG can leave zero — flip up to two ACTIVE open entries.
 */
async function ensureSomeOnBreakToday() {
  const open = await db.timeEntry.findMany({
    where: { date: dayRange(TODAY), clockOut: null },
    include: { employee: { select: { email: true } } },
    orderBy: { clockIn: "asc" },
  });
  const onBreak = open.filter(te => te.status === "ON_BREAK").length;
  if (onBreak >= 2) {
    console.log(`   Today: ${open.length} open entries, ${onBreak} on break — nothing to repair.`);
    return;
  }
  // Keep the demo-featured pair (Hana / Vanessa) plainly ACTIVE.
  const featured = new Set(["hana.yoshida@actools.com", "vanessa.chu@actools.com"]);
  const candidates = open.filter(te => te.status === "ACTIVE" && !featured.has(te.employee.email ?? ""));
  let flipped = 0;
  for (const te of candidates.slice(0, 2 - onBreak)) {
    const startedAgo = randInt(4, 16);
    await db.timeEntry.update({
      where: { id: te.id },
      data: {
        status: "ON_BREAK",
        breaks: {
          create: [{
            startTime: addMin(NOW, -startedAgo), endTime: null, durationMin: 0,
            type: te.totalBreakMin > 0 ? "BREAK" : "LUNCH",
          }],
        },
      },
    });
    flipped++;
  }
  console.log(`   Repair: flipped ${flipped} open entr${flipped === 1 ? "y" : "ies"} to ON_BREAK (now ${onBreak + flipped} on break of ${open.length} open).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
