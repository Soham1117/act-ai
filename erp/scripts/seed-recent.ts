/**
 * Seeds recent activity (last ~10 days) so the admin dashboard looks full
 * for demo: time entries, ScheduledWork, notifications, leave/requests/
 * reimbursements, audit log, and a current payroll period.
 *
 * Run:  pnpm tsx --env-file=.env.local scripts/seed-recent.ts
 *
 * Idempotent-ish: checks the gap day-by-day and only inserts if a row for
 * (employee, date) doesn't already exist.
 */
import "dotenv/config";
import { PrismaClient, Prisma } from "@prisma/client";

const db = new PrismaClient();

// "Today" is taken from system clock. Seeded data anchors to it.
const NOW = new Date();
const TODAY = new Date(NOW); TODAY.setHours(0, 0, 0, 0);

const rand = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const chance = (p: number) => Math.random() < p;
const addDays = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };

async function main() {
  console.log("→ Seed recent activity. NOW =", NOW.toISOString());

  const employees = await db.employee.findMany({
    where: { employmentStatus: "ACTIVE" },
    select: {
      id: true, name: true, userId: true, employmentType: true,
      departmentId: true, primaryJobCodeId: true, defaultHourlyRate: true,
      department: { select: { name: true } },
      primaryJobCode: { select: { code: true } },
    },
  });
  console.log(`   ${employees.length} active employees`);

  const marcus = employees.find(e => e.name === "Marcus Holloway");
  if (!marcus) throw new Error("Marcus Holloway not found");
  const admins = employees.filter(e => ["Marcus Holloway","Jennifer Walsh","Diego Ramirez"].includes(e.name));

  // ── 1. TIME ENTRIES (10-day backfill) ──────────────────────────────
  // Generate for the last 10 days. Skip weekends for ~70% of employees.
  // Today (incomplete day): some ACTIVE entries (clocked-in now), some
  // completed but PENDING approval.
  let teCreated = 0, teSkipped = 0;
  const DAYS_BACK = 10;

  for (let i = DAYS_BACK; i >= 0; i--) {
    const day = addDays(TODAY, -i);
    const isWeekend = day.getDay() === 0 || day.getDay() === 6;
    const isToday = i === 0;

    for (const emp of employees) {
      // Skip some employees on weekends
      if (isWeekend && chance(0.8)) continue;
      // Skip some randomly to add variance (sick day, etc.)
      if (!isToday && chance(0.05)) continue;

      // Skip if entry exists
      const existing = await db.timeEntry.findFirst({
        where: { employeeId: emp.id, date: day }, select: { id: true },
      });
      if (existing) { teSkipped++; continue; }

      const jobCode = emp.primaryJobCode?.code ?? "ACT001";
      const rate = new Prisma.Decimal(emp.defaultHourlyRate);

      if (isToday) {
        // ~25% currently clocked in (status ACTIVE, no clockOut)
        // ~25% completed today, PENDING approval
        // 50% haven't worked today
        const roll = Math.random();
        if (roll < 0.25) {
          // Clocked in 2-6 hours ago, still active
          const hoursAgo = randInt(2, 6);
          const clockIn = new Date(NOW); clockIn.setHours(NOW.getHours() - hoursAgo, randInt(0,59), 0, 0);
          await db.timeEntry.create({
            data: {
              employeeId: emp.id, date: day, clockIn,
              status: chance(0.15) ? "ON_BREAK" : "ACTIVE",
              jobCode, rate, source: chance(0.4) ? "KIOSK" : "WEB",
              kioskSlug: chance(0.4) ? "plant-floor" : null,
              kioskLabel: chance(0.4) ? "Plant Floor Kiosk" : null,
              totalWorkMin: hoursAgo * 60 - randInt(15, 45),
              approvalStatus: "PENDING",
            },
          });
          teCreated++;
        } else if (roll < 0.5) {
          // Completed early shift, pending approval
          const clockIn = new Date(day); clockIn.setHours(6, randInt(0, 30), 0, 0);
          const workMin = randInt(360, 540); // 6-9h
          const clockOut = new Date(clockIn.getTime() + (workMin + randInt(30, 60)) * 60000);
          await db.timeEntry.create({
            data: {
              employeeId: emp.id, date: day, clockIn, clockOut,
              totalBreakMin: randInt(30, 60), totalWorkMin: workMin,
              status: "PENDING_APPROVAL", jobCode, rate,
              source: chance(0.3) ? "KIOSK" : "WEB", approvalStatus: "PENDING",
            },
          });
          teCreated++;
        }
        continue;
      }

      // Past days: completed, mostly approved, some pending
      const startHr = emp.employmentType === "CONTRACT_HOURLY" ? randInt(6, 9) : randInt(7, 9);
      const workMin = emp.employmentType === "CONTRACT_HOURLY"
        ? randInt(380, 580) // hourly: 6.3-9.7h, more variance
        : randInt(420, 510); // FT: 7-8.5h
      const breakMin = randInt(30, 60);
      const clockIn = new Date(day); clockIn.setHours(startHr, randInt(0, 30), 0, 0);
      const clockOut = new Date(clockIn.getTime() + (workMin + breakMin) * 60000);

      const isApproved = chance(0.85);
      await db.timeEntry.create({
        data: {
          employeeId: emp.id, date: day, clockIn, clockOut,
          totalBreakMin: breakMin, totalWorkMin: workMin,
          status: isApproved ? "APPROVED" : "PENDING_APPROVAL",
          jobCode, rate,
          source: chance(0.3) ? "KIOSK" : (chance(0.1) ? "AUTO" : "WEB"),
          kioskSlug: chance(0.3) ? "plant-floor" : null,
          kioskLabel: chance(0.3) ? "Plant Floor Kiosk" : null,
          approvalStatus: isApproved ? "APPROVED" : "PENDING",
          approvedById: isApproved ? rand(admins).id : null,
          approvalDate: isApproved ? new Date(clockOut.getTime() + randInt(1, 48) * 3600000) : null,
        },
      });
      teCreated++;
    }
  }
  console.log(`   TimeEntries: +${teCreated} (skipped ${teSkipped} existing)`);

  // Marcus: ensure he has a strong full week
  for (let i = 0; i <= 6; i++) {
    const day = addDays(TODAY, -i);
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    const exists = await db.timeEntry.findFirst({ where: { employeeId: marcus.id, date: day } });
    if (exists) continue;
    const isToday = i === 0;
    const clockIn = new Date(day); clockIn.setHours(7, randInt(45, 59), 0, 0);
    if (isToday) {
      await db.timeEntry.create({
        data: {
          employeeId: marcus.id, date: day, clockIn,
          status: "ACTIVE", jobCode: "AUTO001",
          rate: new Prisma.Decimal(marcus.defaultHourlyRate), source: "WEB",
          totalWorkMin: randInt(180, 300), approvalStatus: "PENDING",
        },
      });
    } else {
      const workMin = randInt(480, 540);
      const clockOut = new Date(clockIn.getTime() + (workMin + 45) * 60000);
      await db.timeEntry.create({
        data: {
          employeeId: marcus.id, date: day, clockIn, clockOut,
          totalBreakMin: 45, totalWorkMin: workMin,
          status: "APPROVED", jobCode: "AUTO001",
          rate: new Prisma.Decimal(marcus.defaultHourlyRate), source: "WEB",
          approvalStatus: "APPROVED",
          approvedById: marcus.id, approvalDate: new Date(clockOut.getTime() + 3600000),
        },
      });
    }
    teCreated++;
  }

  // ── 2. SCHEDULED WORK (for live coverage + utilization charts) ────
  let swCreated = 0;
  for (let i = 7; i >= 0; i--) {
    const day = addDays(TODAY, -i);
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    for (const emp of employees) {
      if (chance(0.4)) continue; // not everyone has ScheduledWork
      const exists = await db.scheduledWork.findFirst({
        where: { employeeId: emp.id, date: day }, select: { id: true },
      });
      if (exists) continue;
      const startTime = new Date(day); startTime.setHours(8, 0, 0, 0);
      const endTime = new Date(day); endTime.setHours(17, 0, 0, 0);
      await db.scheduledWork.create({
        data: {
          employeeId: emp.id, date: day, startTime, endTime,
          status: i === 0 ? "SCHEDULED" : "COMPLETED",
          jobCode: emp.primaryJobCode?.code ?? "ACT001",
          rate: new Prisma.Decimal(emp.defaultHourlyRate),
          totalBreakMin: 60, netWorkHours: 8,
        },
      });
      swCreated++;
    }
  }
  // Make sure scheduledNow > 0 for the "live coverage" chart: add some
  // entries covering RIGHT NOW for employees not already there.
  const liveStart = new Date(NOW); liveStart.setHours(8, 0, 0, 0);
  const liveEnd = new Date(NOW); liveEnd.setHours(17, 0, 0, 0);
  for (const emp of employees.slice(0, 20)) {
    const exists = await db.scheduledWork.findFirst({
      where: { employeeId: emp.id, date: TODAY }, select: { id: true },
    });
    if (exists) continue;
    await db.scheduledWork.create({
      data: {
        employeeId: emp.id, date: TODAY, startTime: liveStart, endTime: liveEnd,
        status: "SCHEDULED", jobCode: emp.primaryJobCode?.code ?? "ACT001",
        rate: new Prisma.Decimal(emp.defaultHourlyRate),
        totalBreakMin: 60, netWorkHours: 8,
      },
    });
    swCreated++;
  }
  console.log(`   ScheduledWork: +${swCreated}`);

  // ── 3. NOTIFICATIONS ──────────────────────────────────────────────
  const notifSpecs = [
    { type: "ANNOUNCEMENT", title: "Q2 All-Hands · Friday 3 PM", message: "Join us in the main conference room for Q2 review, new product roadmap, and the safety milestone award. Pizza after.", priority: "HIGH" },
    { type: "POLICY", title: "Updated PPE policy in shop floor", message: "Cut-resistant gloves now required for all forging handling. New stock available at supervisor stations.", priority: "URGENT" },
    { type: "PAYROLL", title: "Pay date moved up one day", message: "Bank holiday Monday — direct deposits will land Friday instead. No action needed.", priority: "MEDIUM" },
    { type: "COMPANY", title: "New customer portal launching next month", message: "Sales & customer-facing teams will get walkthrough sessions next week. Watch your calendar for invites.", priority: "MEDIUM" },
    { type: "ANNOUNCEMENT", title: "Welcome Aboard – 3 new hires", message: "Please welcome our new welders and a QA inspector starting Monday. Tour times posted in #plant-floor.", priority: "LOW" },
    { type: "POLICY", title: "Vacation request window for July", message: "Submit July time-off by end of this week so we can coordinate plant coverage.", priority: "HIGH" },
  ];
  let notifCreated = 0;
  for (let i = 0; i < notifSpecs.length; i++) {
    const spec = notifSpecs[i];
    const daysAgo = randInt(0, 6);
    const created = addDays(NOW, -daysAgo); created.setHours(randInt(8, 17), randInt(0, 59), 0, 0);
    // Recipients: ~25 random employees
    const recipients = employees.sort(() => Math.random() - 0.5).slice(0, randInt(20, 35));
    await db.notification.create({
      data: {
        type: spec.type as Prisma.NotificationCreateInput["type"],
        title: spec.title, message: spec.message,
        priority: spec.priority as Prisma.NotificationCreateInput["priority"],
        senderId: rand(admins).userId,
        createdAt: created,
        recipients: {
          create: recipients.map(r => ({
            employeeId: r.id,
            read: chance(0.45),
            readAt: chance(0.45) ? addDays(created, randInt(0, daysAgo + 1)) : null,
          })),
        },
      },
    });
    notifCreated++;
  }
  console.log(`   Notifications: +${notifCreated}`);

  // ── 4. NEW LEAVE / REQUESTS / REIMBURSEMENTS (pending mostly) ─────
  const leaveTypes = ["VACATION", "SICK", "PERSONAL", "FAMILY"] as const;
  const empPool = employees.filter(e => e.id !== marcus.id);
  let leavesC = 0;
  for (let i = 0; i < 5; i++) {
    const emp = rand(empPool);
    const startDate = addDays(TODAY, randInt(3, 25));
    const days = randInt(1, 5);
    const endDate = addDays(startDate, days - 1);
    await db.leaveRequest.create({
      data: {
        employeeId: emp.id, leaveType: rand([...leaveTypes]),
        startDate, endDate, totalDays: days, noticeDays: 3,
        description: rand([
          "Family vacation already booked.",
          "Personal time off — appreciate the consideration.",
          "Annual physical and follow-up appointments.",
          "Wedding out of state.",
          "Helping family with a move.",
        ]),
        status: chance(0.7) ? "PENDING" : "APPROVED",
        reviewerId: chance(0.7) ? null : marcus.id,
        reviewedAt: chance(0.7) ? null : addDays(NOW, -randInt(1, 4)),
        createdAt: addDays(NOW, -randInt(1, 6)),
      },
    });
    leavesC++;
  }
  console.log(`   LeaveRequests: +${leavesC}`);

  const reqSpecs: Array<{ type: Prisma.RequestCreateInput["type"]; title: string; description: string }> = [
    { type: "EQUIPMENT_REQUEST", title: "Replacement torque wrench (1/2\" drive)", description: "Current unit is reading 8% low against the master. Need a calibrated replacement for the assembly cell." },
    { type: "TRAINING_REQUEST", title: "API 6A inspector certification", description: "Would like to enroll in the API 6A inspector course in Houston next quarter — directly applicable to our christmas tree QA work." },
    { type: "ACCESS_REQUEST", title: "Access to ERP payroll module", description: "Taking over Lisa's payroll prep while she's out. Need read-write access for the next two pay periods." },
    { type: "SCHEDULE_CHANGE", title: "Switch to 4x10 schedule June onward", description: "Childcare arrangement requires Fridays off. Happy to extend M-Th to 10-hour days." },
    { type: "DOCUMENT_REQUEST", title: "Employment verification letter", description: "Need a letter for mortgage refinance — please address to Wells Fargo." },
    { type: "DETAILS_CHANGE", title: "Address change", description: "Moved last weekend, new address is 4421 Oak Ridge Dr., Burleson TX 76028." },
  ];
  let reqC = 0;
  for (const s of reqSpecs) {
    const emp = rand(empPool);
    await db.request.create({
      data: {
        employeeId: emp.id, type: s.type, title: s.title, description: s.description,
        status: chance(0.65) ? "PENDING" : (chance(0.5) ? "PROCESSING" : "COMPLETED"),
        createdAt: addDays(NOW, -randInt(1, 6)),
      },
    });
    reqC++;
  }
  console.log(`   Requests: +${reqC}`);

  const reimbSpecs = [
    { title: "Customer site visit – Midland", category: "TRAVEL" as const, amount: 412.85, description: "Hotel + fuel for two-day customer site visit, Midland TX." },
    { title: "Hammer union sample shipping", category: "OTHER" as const, amount: 87.4, description: "Overnight ship to customer engineering team for spec review." },
    { title: "Lunch w/ vendor – Steel forge rep", category: "MEALS" as const, amount: 54.2, description: "Discussed Q3 forging capacity reservation." },
    { title: "Calipers (digital, 8-inch)", category: "EQUIPMENT" as const, amount: 189.0, description: "Replacement for the pair that walked off the inspection table." },
    { title: "OSHA 30-hour refresher", category: "TRAINING" as const, amount: 295.0, description: "Recertification — expires next month." },
  ];
  let reimC = 0;
  for (const s of reimbSpecs) {
    const emp = rand(empPool);
    const r = Math.random();
    const status = r < 0.5 ? "PENDING" : r < 0.7 ? "UNDER_REVIEW" : r < 0.9 ? "APPROVED" : "PAID";
    await db.reimbursement.create({
      data: {
        employeeId: emp.id, title: s.title, category: s.category,
        amount: new Prisma.Decimal(s.amount), description: s.description,
        expenseDate: addDays(NOW, -randInt(2, 14)),
        status: status as Prisma.ReimbursementCreateInput["status"],
        priority: "MEDIUM",
        createdAt: addDays(NOW, -randInt(1, 6)),
        reviewerId: status === "PENDING" ? null : marcus.id,
        reviewedAt: status === "PENDING" ? null : addDays(NOW, -randInt(0, 3)),
        paidDate: status === "PAID" ? addDays(NOW, -1) : null,
        paidAmount: status === "PAID" ? new Prisma.Decimal(s.amount) : null,
      },
    });
    reimC++;
  }
  console.log(`   Reimbursements: +${reimC}`);

  // ── 5. AUDIT LOG (activity feed) ──────────────────────────────────
  const actions = [
    "timesheet.approve", "leave.approve", "leave.create", "employee.update",
    "schedule.create", "reimbursement.approve", "request.update",
    "notification.send", "payroll.upload", "kiosk.session.create",
  ];
  const resources = ["TimeEntry", "LeaveRequest", "Employee", "Schedule", "Reimbursement", "Request", "Notification", "Payroll"];
  let auditC = 0;
  for (let i = 0; i < 60; i++) {
    const actor = rand(admins);
    const created = new Date(NOW.getTime() - randInt(5, 7 * 24 * 60) * 60000);
    await db.auditLog.create({
      data: {
        actorId: actor.userId,
        actorEmail: `${actor.name.toLowerCase().replace(" ", ".")}@actools.com`,
        action: rand(actions),
        resource: `${rand(resources)}:${Math.random().toString(36).slice(2, 10)}`,
        createdAt: created,
      },
    });
    auditC++;
  }
  console.log(`   AuditLog: +${auditC}`);

  // ── 6. CURRENT PAYROLL CALENDAR ───────────────────────────────────
  const currentStart = new Date(TODAY); currentStart.setDate(TODAY.getDate() - 7);
  const currentEnd = new Date(TODAY); currentEnd.setDate(TODAY.getDate() + 6);
  const payDate = new Date(currentEnd); payDate.setDate(currentEnd.getDate() + 5);
  const existsCal = await db.payrollCalendar.findFirst({
    where: { payPeriodStart: currentStart, payPeriodEnd: currentEnd },
  });
  if (!existsCal) {
    await db.payrollCalendar.create({
      data: {
        title: `Bi-weekly · ${currentStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} → ${currentEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
        payPeriodStart: currentStart, payPeriodEnd: currentEnd,
        payDate, status: "CURRENT",
        createdById: marcus.userId,
      },
    });
    console.log(`   PayrollCalendar: +1 (current period)`);
  }

  console.log("✓ done");
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
