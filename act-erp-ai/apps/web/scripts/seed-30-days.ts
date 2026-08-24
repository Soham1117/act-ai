/**
 * Seeds 30 days of dense, realistic demo data for American Completion Tools
 * (oilfield completion-tools manufacturer), ending TODAY.
 *
 *   pnpm tsx --env-file=.env.local scripts/seed-30-days.ts
 *
 * Creates (only if missing): departments, job codes, ~22 active employees w/
 * User accounts (password Demo#Pass1), then 30 days of time entries + breaks,
 * schedules + scheduled work (past 30d + next 7d), leave requests, general
 * requests w/ status history, reimbursements w/ history, notifications,
 * bi-weekly payroll calendar, and an audit-log activity feed.
 *
 * Idempotent: exits early if an AuditLog row with action 'seed.30days'
 * exists (written as the last step of a successful run).
 */
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

// ── Seeded RNG (mulberry32) so re-generated data is stable-ish ────────
let __seed = 20260715;
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

// ── Org blueprint ─────────────────────────────────────────────────────
const DEPARTMENTS = [
  { name: "Manufacturing", code: "MFG", description: "CNC machining, welding and assembly of completion tools" },
  { name: "Engineering", code: "ENG", description: "Completion tool design, drafting and product engineering" },
  { name: "Quality Assurance", code: "QA", description: "Inspection, NDT and API 6A compliance" },
  { name: "Field Services", code: "FLD", description: "On-site tool service, installation and wireline support" },
  { name: "Sales & Marketing", code: "SLS", description: "Account management and channel sales" },
  { name: "HR & Admin", code: "HR", description: "People operations, accounting and office administration" },
] as const;

const JOB_CODES: Array<{ code: string; title: string; rate: number; dept: string }> = [
  { code: "MFG-SUP", title: "Production Supervisor", rate: 38, dept: "Manufacturing" },
  { code: "CNC001", title: "CNC Machinist", rate: 28, dept: "Manufacturing" },
  { code: "WLD001", title: "Welder (Structural/Pipe)", rate: 26, dept: "Manufacturing" },
  { code: "ASM001", title: "Assembly Technician", rate: 22, dept: "Manufacturing" },
  { code: "ENG-MGR", title: "Engineering Manager", rate: 65, dept: "Engineering" },
  { code: "ENG001", title: "Completion Tools Engineer", rate: 52, dept: "Engineering" },
  { code: "DRF001", title: "Design Drafter", rate: 32, dept: "Engineering" },
  { code: "QA-MGR", title: "QA Manager", rate: 45, dept: "Quality Assurance" },
  { code: "QAI001", title: "Quality Inspector", rate: 27, dept: "Quality Assurance" },
  { code: "NDT001", title: "NDT Technician", rate: 30, dept: "Quality Assurance" },
  { code: "FLD-SUP", title: "Field Services Supervisor", rate: 42, dept: "Field Services" },
  { code: "FST001", title: "Field Service Technician", rate: 30, dept: "Field Services" },
  { code: "WLS001", title: "Wireline Tool Specialist", rate: 34, dept: "Field Services" },
  { code: "SLS-DIR", title: "Sales Director", rate: 60, dept: "Sales & Marketing" },
  { code: "ACM001", title: "Account Manager", rate: 36, dept: "Sales & Marketing" },
  { code: "ISR001", title: "Inside Sales Representative", rate: 24, dept: "Sales & Marketing" },
  { code: "HRG001", title: "HR Generalist", rate: 28, dept: "HR & Admin" },
  { code: "ACC001", title: "Staff Accountant", rate: 33, dept: "HR & Admin" },
  { code: "ADM001", title: "Office Administrator", rate: 20, dept: "HR & Admin" },
];

type EmpSpec = {
  name: string; gender: "MALE" | "FEMALE"; dept: string; position: string;
  jobCode: string; hired: string; lead?: boolean; onLeave?: boolean;
  comp: "MONTHLY_SALARY" | "HOURLY_RATE"; city: string;
};
const EMPLOYEES: EmpSpec[] = [
  // Manufacturing (6)
  { name: "Raul Mendoza", gender: "MALE", dept: "Manufacturing", position: "Production Supervisor", jobCode: "MFG-SUP", hired: "2019-03-11", lead: true, comp: "MONTHLY_SALARY", city: "Fort Worth" },
  { name: "Dale Whitfield", gender: "MALE", dept: "Manufacturing", position: "CNC Machinist", jobCode: "CNC001", hired: "2020-06-01", comp: "HOURLY_RATE", city: "Burleson" },
  { name: "Tommy Nguyen", gender: "MALE", dept: "Manufacturing", position: "CNC Machinist", jobCode: "CNC001", hired: "2022-02-14", comp: "HOURLY_RATE", city: "Fort Worth" },
  { name: "Jerome Baptiste", gender: "MALE", dept: "Manufacturing", position: "Welder", jobCode: "WLD001", hired: "2021-09-20", comp: "HOURLY_RATE", city: "Crowley" },
  { name: "Kelsey Hardin", gender: "FEMALE", dept: "Manufacturing", position: "Assembly Technician", jobCode: "ASM001", hired: "2023-05-08", onLeave: true, comp: "HOURLY_RATE", city: "Cleburne" },
  { name: "Luis Carrillo", gender: "MALE", dept: "Manufacturing", position: "Welder", jobCode: "WLD001", hired: "2024-01-15", comp: "HOURLY_RATE", city: "Fort Worth" },
  // Engineering (3)
  { name: "Priya Raghunathan", gender: "FEMALE", dept: "Engineering", position: "Engineering Manager", jobCode: "ENG-MGR", hired: "2019-08-05", lead: true, comp: "MONTHLY_SALARY", city: "Fort Worth" },
  { name: "Ethan Kowalski", gender: "MALE", dept: "Engineering", position: "Completion Tools Engineer", jobCode: "ENG001", hired: "2021-04-12", comp: "MONTHLY_SALARY", city: "Arlington" },
  { name: "Sofia Delgado", gender: "FEMALE", dept: "Engineering", position: "Design Drafter", jobCode: "DRF001", hired: "2023-10-02", comp: "HOURLY_RATE", city: "Mansfield" },
  // Quality Assurance (3)
  { name: "Gloria Okafor", gender: "FEMALE", dept: "Quality Assurance", position: "QA Manager", jobCode: "QA-MGR", hired: "2020-01-20", lead: true, comp: "MONTHLY_SALARY", city: "Fort Worth" },
  { name: "Brent Sandoval", gender: "MALE", dept: "Quality Assurance", position: "Quality Inspector", jobCode: "QAI001", hired: "2022-07-05", comp: "HOURLY_RATE", city: "Joshua" },
  { name: "Hana Yoshida", gender: "FEMALE", dept: "Quality Assurance", position: "NDT Technician", jobCode: "NDT001", hired: "2024-03-18", comp: "HOURLY_RATE", city: "Fort Worth" },
  // Field Services (4)
  { name: "Wade Turnbull", gender: "MALE", dept: "Field Services", position: "Field Services Supervisor", jobCode: "FLD-SUP", hired: "2019-11-04", lead: true, comp: "MONTHLY_SALARY", city: "Godley" },
  { name: "Curtis Bell", gender: "MALE", dept: "Field Services", position: "Field Service Technician", jobCode: "FST001", hired: "2021-06-21", comp: "HOURLY_RATE", city: "Weatherford" },
  { name: "Maria Gutierrez", gender: "FEMALE", dept: "Field Services", position: "Field Service Technician", jobCode: "FST001", hired: "2023-02-27", comp: "HOURLY_RATE", city: "Fort Worth" },
  { name: "Deshawn Riley", gender: "MALE", dept: "Field Services", position: "Wireline Tool Specialist", jobCode: "WLS001", hired: "2022-10-10", comp: "HOURLY_RATE", city: "Benbrook" },
  // Sales & Marketing (3)
  { name: "Vanessa Chu", gender: "FEMALE", dept: "Sales & Marketing", position: "Sales Director", jobCode: "SLS-DIR", hired: "2020-09-14", lead: true, comp: "MONTHLY_SALARY", city: "Fort Worth" },
  { name: "Grant Pearson", gender: "MALE", dept: "Sales & Marketing", position: "Account Manager", jobCode: "ACM001", hired: "2022-03-07", onLeave: true, comp: "MONTHLY_SALARY", city: "Aledo" },
  { name: "Abby Solano", gender: "FEMALE", dept: "Sales & Marketing", position: "Inside Sales Representative", jobCode: "ISR001", hired: "2025-01-06", comp: "HOURLY_RATE", city: "Fort Worth" },
  // HR & Admin (3)
  { name: "Denise Albright", gender: "FEMALE", dept: "HR & Admin", position: "HR Generalist", jobCode: "HRG001", hired: "2019-05-13", lead: true, comp: "MONTHLY_SALARY", city: "Fort Worth" },
  { name: "Omar Farouk", gender: "MALE", dept: "HR & Admin", position: "Staff Accountant", jobCode: "ACC001", hired: "2021-11-01", comp: "MONTHLY_SALARY", city: "Arlington" },
  { name: "Jill Prather", gender: "FEMALE", dept: "HR & Admin", position: "Office Administrator", jobCode: "ADM001", hired: "2026-02-02", comp: "HOURLY_RATE", city: "Crowley" },
];

const DEMO_PASSWORD = "Demo#Pass1";
const MARKER_ACTION = "seed.30days";

type Emp = {
  id: string; userId: string; name: string; email: string | null; deptName: string;
  jobCode: string; rate: number; onLeave: boolean; lead: boolean;
};

async function main() {
  console.log("→ seed-30-days. NOW =", NOW.toISOString());

  const marker = await db.auditLog.findFirst({ where: { action: MARKER_ACTION } });
  if (marker) {
    console.log("✓ marker 'seed.30days' already present — DB is seeded. Exiting.");
    return;
  }

  const adminUser = await db.user.findUnique({ where: { email: "admin@actools.com" } });
  if (!adminUser) throw new Error("admin@actools.com not found — create the admin first.");

  // ── 1. Departments + JobCodes (only if missing) ─────────────────────
  const deptByName = new Map<string, string>();
  for (const d of DEPARTMENTS) {
    const row = await db.department.upsert({
      where: { name: d.name },
      create: { name: d.name, code: d.code, description: d.description },
      update: {},
    });
    deptByName.set(d.name, row.id);
  }
  const jobCodeByCode = new Map<string, { id: string; rate: number }>();
  for (const jc of JOB_CODES) {
    const row = await db.jobCode.upsert({
      where: { code: jc.code },
      create: {
        code: jc.code, title: jc.title, rate: jc.rate.toFixed(2),
        departmentId: deptByName.get(jc.dept), isActive: true,
        description: `${jc.title} — ${jc.dept}`,
      },
      update: {},
    });
    jobCodeByCode.set(jc.code, { id: row.id, rate: jc.rate });
  }
  console.log(`   Departments: ${deptByName.size}, JobCodes: ${jobCodeByCode.size}`);

  // ── 2. Admin employee record (approver) ─────────────────────────────
  let adminEmp = await db.employee.findUnique({ where: { userId: adminUser.id } });
  if (!adminEmp) {
    adminEmp = await db.employee.create({
      data: {
        employeeId: "EMP-2018-0001",
        userId: adminUser.id,
        name: adminUser.name,
        email: adminUser.email,
        personalEmail: adminUser.email ?? "admin@actools.com",
        gender: "MALE",
        ssnLast4: "0001",
        departmentId: deptByName.get("HR & Admin"),
        position: "Operations Manager",
        jobTitle: "Operations Manager",
        dateOfHire: new Date("2018-06-04"),
        employmentType: "FULL_PART_TIME",
        employmentStatus: "ACTIVE",
        compensationType: "MONTHLY_SALARY",
        compensationValue: D(11500),
        defaultHourlyRate: D(66),
        city: "Fort Worth", state: "TX", nationality: "USA",
        createdAt: new Date("2018-06-04"),
      },
    });
  }

  // ── 3. Employees + User accounts (reuse if enough already exist) ────
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const existingCount = await db.employee.count({
    where: { employmentStatus: { in: ["ACTIVE", "ON_LEAVE"] }, id: { not: adminEmp.id } },
  });
  const employees: Emp[] = [];
  if (existingCount >= 18) {
    console.log(`   Reusing ${existingCount} existing employees`);
    const rows = await db.employee.findMany({
      where: { employmentStatus: { in: ["ACTIVE", "ON_LEAVE"] }, id: { not: adminEmp.id } },
      include: { department: true, primaryJobCode: true },
    });
    for (const r of rows) {
      employees.push({
        id: r.id, userId: r.userId, name: r.name, email: r.email,
        deptName: r.department?.name ?? "Manufacturing",
        jobCode: r.primaryJobCode?.code ?? "ASM001",
        rate: Number(r.defaultHourlyRate),
        onLeave: r.employmentStatus === "ON_LEAVE", lead: false,
      });
    }
  } else {
    const perYear = new Map<number, number>();
    for (const spec of EMPLOYEES) {
      const hired = new Date(spec.hired);
      const year = hired.getFullYear();
      const n = (perYear.get(year) ?? 0) + 1;
      perYear.set(year, n);
      const employeeId = `EMP-${year}-${String(n).padStart(4, "0")}`;
      const [first, ...rest] = spec.name.toLowerCase().split(" ");
      const email = `${first}.${rest.join("")}@actools.com`;
      const jc = jobCodeByCode.get(spec.jobCode)!;
      const ssnLast4 = String(1000 + employees.length).slice(-4);

      const existing = await db.user.findUnique({ where: { email } });
      if (existing) {
        const emp = await db.employee.findUnique({ where: { userId: existing.id } });
        if (emp) {
          employees.push({ id: emp.id, userId: existing.id, name: spec.name, email, deptName: spec.dept, jobCode: spec.jobCode, rate: jc.rate, onLeave: !!spec.onLeave, lead: !!spec.lead });
          continue;
        }
      }
      const user = await db.user.create({
        data: { email, name: spec.name, role: "EMPLOYEE", passwordHash },
      });
      const compValue = spec.comp === "MONTHLY_SALARY" ? Math.round(jc.rate * 173.33) : jc.rate;
      const emp = await db.employee.create({
        data: {
          employeeId, userId: user.id, name: spec.name, email,
          personalEmail: `${first}.${rest.join("")}.personal@example.com`,
          gender: spec.gender, ssnLast4,
          phoneNumber: `817-${randInt(200, 899)}-${String(randInt(1000, 9999))}`,
          dateOfBirth: new Date(randInt(1968, 2000), randInt(0, 11), randInt(1, 28)),
          address: `${randInt(100, 9800)} ${pick(["Oak Ridge Dr", "Mesa View Ln", "Rig Rd", "Prairie Wind Ct", "Cedar Bluff Ave", "Longhorn Trl"])}`,
          city: spec.city, state: "TX", zipCode: `76${String(randInt(100, 199))}`,
          nationality: "USA",
          educationLevel: pick(["High School", "Associate Degree", "Bachelor's Degree", "Trade Certification"]),
          certifications: spec.dept === "Quality Assurance" ? ["API 6A awareness", "ASNT Level II"] : spec.dept === "Manufacturing" ? ["OSHA 10", "Forklift"] : spec.dept === "Field Services" ? ["OSHA 30", "H2S Alive", "TWIC"] : [],
          departmentId: deptByName.get(spec.dept),
          position: spec.position, jobTitle: spec.position,
          dateOfHire: hired,
          employmentType: spec.comp === "HOURLY_RATE" && chance(0.25) ? "CONTRACT_HOURLY" : "FULL_PART_TIME",
          employmentStatus: spec.onLeave ? "ON_LEAVE" : "ACTIVE",
          compensationType: spec.comp,
          compensationValue: D(compValue),
          primaryJobCodeId: jc.id,
          defaultHourlyRate: D(jc.rate),
          emergencyName: pick(["Sam", "Alex", "Jordan", "Casey", "Riley"]) + " " + spec.name.split(" ")[1],
          emergencyPhone: `817-${randInt(200, 899)}-${String(randInt(1000, 9999))}`,
          createdAt: hired,
        },
      });
      await db.jobCodeAssignment.upsert({
        where: { jobCodeId_employeeId: { jobCodeId: jc.id, employeeId: emp.id } },
        create: { jobCodeId: jc.id, employeeId: emp.id, assignedRate: jc.rate.toFixed(2), isPrimary: true },
        update: {},
      });
      employees.push({ id: emp.id, userId: user.id, name: spec.name, email, deptName: spec.dept, jobCode: spec.jobCode, rate: jc.rate, onLeave: !!spec.onLeave, lead: !!spec.lead });
    }
    // Supervisors: dept lead for members, admin for leads.
    const leadByDept = new Map(employees.filter(e => e.lead).map(e => [e.deptName, e.id]));
    for (const e of employees) {
      const supId = e.lead ? adminEmp.id : leadByDept.get(e.deptName) ?? adminEmp.id;
      await db.employee.update({ where: { id: e.id }, data: { supervisorId: supId } });
    }
  }
  console.log(`   Employees: ${employees.length} (+admin)`);

  const working = employees.filter(e => !e.onLeave);
  const earlyDepts = new Set(["Manufacturing", "Field Services"]);

  // ── 4. Schedules + ScheduledWork + TimeEntries (−30d … +7d) ─────────
  let schedC = 0, swC = 0, teC = 0;
  for (let i = -30; i <= 7; i++) {
    const day = addDays(TODAY, i);
    const dow = day.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const isPast = i < 0;
    const isToday = i === 0;

    for (const emp of employees) {
      if (emp.onLeave && i >= -12) continue; // on leave: nothing recent/future
      const early = earlyDepts.has(emp.deptName);

      // Weekend: only occasional Manufacturing / Field Services Saturdays.
      if (isWeekend) {
        if (dow !== 6 || !early || !chance(0.16) || !isPast) continue;
        const clockIn = at(day, 7, randInt(0, 20));
        const spanMin = randInt(300, 380);
        const breakMin = 30;
        const clockOut = addMin(clockIn, spanMin);
        await db.timeEntry.create({
          data: {
            employeeId: emp.id, date: day, clockIn, clockOut,
            totalBreakMin: breakMin, totalWorkMin: spanMin - breakMin,
            status: "APPROVED", approvalStatus: "APPROVED",
            approvedById: adminEmp.id, approvalDate: addMin(clockOut, randInt(600, 2400)),
            jobCode: emp.jobCode, rate: D(emp.rate), source: "KIOSK",
            kioskSlug: "plant-floor", kioskLabel: "Plant Floor Kiosk",
            timesheetNotes: "Saturday overtime — rush order",
            createdAt: clockOut,
            breaks: { create: [{ startTime: at(day, 10, 0), endTime: at(day, 10, 30), durationMin: 30, type: "BREAK" }] },
          },
        });
        teC++;
        continue;
      }

      // Weekday. ~8% fully absent (no schedule at all).
      if (chance(0.08)) continue;

      const startH = early ? 7 : 8;
      const endH = early ? 15 : 17;
      const endM = early ? 30 : 0;
      const schedStart = at(day, startH, 0);
      const schedEnd = at(day, endH, endM);
      const netHours = (schedEnd.getTime() - schedStart.getTime()) / 3600000 - 1;

      const missed = isPast && chance(0.04); // scheduled, never clocked in
      await db.schedule.create({
        data: {
          employeeId: emp.id, date: day, jobCode: emp.jobCode,
          startTime: `${String(startH).padStart(2, "0")}:00`,
          endTime: `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`,
          createdById: adminEmp.id,
        },
      });
      schedC++;
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

      if (!isPast && !isToday) continue; // future: schedule only
      if (missed) continue;

      // Punctuality: 80% within ±10 min, ~10% late 15–45, ~10% early.
      const roll = rnd();
      const offsetMin = roll < 0.8 ? randInt(-10, 8) : roll < 0.9 ? randInt(15, 45) : randInt(-25, -11);
      const clockIn = addMin(schedStart, offsetMin);

      if (isToday) {
        // Today mid-shift: ~40% currently clocked in, ~20% done early, rest none yet.
        // If the script runs outside working hours (e.g. just after midnight),
        // anchor "as of" to late morning so today's live entries make sense
        // when the dashboards are viewed during the demo day.
        const asOf = new Date(Math.max(NOW.getTime(), at(day, 11, 30).getTime()));
        const r = rnd();
        if (r < 0.4) {
          const onBreak = chance(0.2);
          const elapsed = Math.max(45, Math.round((asOf.getTime() - clockIn.getTime()) / 60000));
          const brDone = elapsed > 300 ? randInt(25, 40) : 0;
          const breaks: Prisma.TimeBreakCreateWithoutTimeEntryInput[] = [];
          if (brDone > 0) breaks.push({ startTime: at(day, 11, 45), endTime: addMin(at(day, 11, 45), brDone), durationMin: brDone, type: "LUNCH" });
          if (onBreak) breaks.push({ startTime: addMin(asOf, -randInt(3, 18)), endTime: null, durationMin: 0, type: brDone > 0 ? "BREAK" : "LUNCH" });
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
          teC++;
        } else if (r < 0.6) {
          // Completed early/short shift — ends at or before the "as of" anchor.
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
          teC++;
        }
        continue;
      }

      // Past weekday, worked. Occasional 10–11h overtime day.
      const ot = chance(0.07);
      const breakMin = randInt(30, 60);
      const workMin = ot ? randInt(600, 660) : randInt(450, 555); // 7.5–9.25h, OT 10–11h
      const clockOut = addMin(clockIn, workMin + breakMin);
      const lunchStart = at(day, early ? 11 : 12, randInt(0, 30));
      const apprAt = addMin(clockOut, randInt(240, 2880));
      // Approval can't post-date "now" — very recent entries stay pending.
      const approved = (i < -3 ? true : chance(0.55)) && apprAt.getTime() <= NOW.getTime();
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
          timesheetNotes: ot ? pick(["Stayed late to finish packer sub run", "Overtime — expedite order for Permian customer", "Covered second shift start"]) : null,
          createdAt: clockOut,
          breaks: { create: [{ startTime: lunchStart, endTime: addMin(lunchStart, breakMin), durationMin: breakMin, type: "LUNCH" }] },
        },
      });
      teC++;
    }
  }
  console.log(`   Schedules: +${schedC}, ScheduledWork: +${swC}, TimeEntries: +${teC}`);

  // ── 5. Leave requests (past 30d + upcoming approved) ────────────────
  const onLeaveEmps = employees.filter(e => e.onLeave);
  let lvC = 0;
  // Current leave for the two ON_LEAVE employees.
  if (onLeaveEmps[0]) {
    await db.leaveRequest.create({
      data: {
        employeeId: onLeaveEmps[0].id, leaveType: "MATERNITY",
        startDate: addDays(TODAY, -12), endDate: addDays(TODAY, 47), totalDays: 42,
        noticeDays: 30, description: "Maternity leave — return date confirmed with HR.",
        status: "APPROVED", reviewerId: adminEmp.id,
        reviewedAt: addDays(TODAY, -20), reviewNotes: "Approved per policy. Congratulations!",
        createdAt: addDays(TODAY, -35),
      },
    });
    lvC++;
  }
  if (onLeaveEmps[1]) {
    await db.leaveRequest.create({
      data: {
        employeeId: onLeaveEmps[1].id, leaveType: "FAMILY",
        startDate: addDays(TODAY, -4), endDate: addDays(TODAY, 5), totalDays: 8,
        noticeDays: 10, description: "Family emergency out of state — will check email when possible.",
        status: "APPROVED", reviewerId: adminEmp.id,
        reviewedAt: addDays(TODAY, -6), reviewNotes: "Approved. Accounts covered by Vanessa.",
        createdAt: addDays(TODAY, -8),
      },
    });
    lvC++;
  }
  const leaveDescriptions: Record<string, string[]> = {
    VACATION: ["Family trip to Gulf Shores booked months back.", "Using banked vacation before Q3 rush.", "Long weekend at the lake house."],
    SICK: ["Flu — doctor's note available on request.", "Dental surgery + recovery day.", "Migraine, staying off the shop floor."],
    PERSONAL: ["Closing on a house, need the day for paperwork.", "DMV + personal errands, half-week off.", "Moving apartments."],
    FAMILY: ["Kid's school event and doctor visit.", "Helping parents relocate to Fort Worth.", "Family reunion out of state."],
    BEREAVEMENT: ["Funeral for a family member in Oklahoma."],
    EMERGENCY: ["Burst pipe at home — insurance adjuster visit."],
  };
  const leaveTypes = ["VACATION", "VACATION", "SICK", "SICK", "PERSONAL", "FAMILY", "BEREAVEMENT", "EMERGENCY"] as const;
  const takenByEmp = new Map<string, { taken: number; approved: number; rejected: number }>();
  const bump = (id: string, f: "taken" | "approved" | "rejected", n: number) => {
    const c = takenByEmp.get(id) ?? { taken: 0, approved: 0, rejected: 0 };
    c[f] += n;
    takenByEmp.set(id, c);
  };
  if (onLeaveEmps[0]) { bump(onLeaveEmps[0].id, "approved", 42); bump(onLeaveEmps[0].id, "taken", 12); }
  if (onLeaveEmps[1]) { bump(onLeaveEmps[1].id, "approved", 8); bump(onLeaveEmps[1].id, "taken", 4); }

  // Past-30-day leaves.
  for (let k = 0; k < 12; k++) {
    const emp = pick(working);
    const type = pick(leaveTypes);
    const start = addDays(TODAY, -randInt(2, 28));
    const days = type === "SICK" ? randInt(1, 2) : randInt(1, 5);
    const createdAt = addDays(start, -randInt(2, 10));
    const r = rnd();
    const status = r < 0.6 ? "APPROVED" : r < 0.75 ? "REJECTED" : "PENDING";
    await db.leaveRequest.create({
      data: {
        employeeId: emp.id, leaveType: type,
        startDate: start, endDate: addDays(start, days - 1), totalDays: days,
        noticeDays: Math.max(0, Math.round((start.getTime() - createdAt.getTime()) / 86400000)),
        description: pick(leaveDescriptions[type] ?? ["Time off request."]),
        status,
        reviewerId: status === "PENDING" ? null : adminEmp.id,
        reviewedAt: status === "PENDING" ? null : addDays(createdAt, randInt(1, 3)),
        reviewNotes: status === "APPROVED" ? pick(["Approved — coverage arranged.", "OK, enjoy.", "Approved, please update the shift board."]) : status === "REJECTED" ? pick(["Overlaps plant shutdown week — please pick other dates.", "Two techs already out that week."]) : null,
        createdAt,
      },
    });
    if (status === "APPROVED") { bump(emp.id, "approved", days); bump(emp.id, "taken", days); }
    if (status === "REJECTED") bump(emp.id, "rejected", days);
    lvC++;
  }
  // Upcoming approved leaves (next 30 days) for the coverage heatmap.
  for (let k = 0; k < 5; k++) {
    const emp = pick(working);
    const start = addDays(TODAY, randInt(3, 26));
    const days = randInt(1, 4);
    await db.leaveRequest.create({
      data: {
        employeeId: emp.id, leaveType: pick(["VACATION", "PERSONAL", "FAMILY"] as const),
        startDate: start, endDate: addDays(start, days - 1), totalDays: days,
        noticeDays: randInt(7, 21),
        description: pick(["Pre-approved summer vacation.", "Out-of-state wedding.", "College visit with daughter.", "Cabin trip — booked in spring."]),
        status: "APPROVED", reviewerId: adminEmp.id,
        reviewedAt: addDays(TODAY, -randInt(1, 6)),
        reviewNotes: "Approved in advance — calendar updated.",
        createdAt: addDays(TODAY, -randInt(3, 12)),
      },
    });
    bump(emp.id, "approved", days);
    lvC++;
  }
  // A few fresh pending ones for the approvals queue.
  for (let k = 0; k < 4; k++) {
    const emp = pick(working);
    const start = addDays(TODAY, randInt(5, 24));
    const days = randInt(1, 5);
    await db.leaveRequest.create({
      data: {
        employeeId: emp.id, leaveType: pick(["VACATION", "SICK", "PERSONAL"] as const),
        startDate: start, endDate: addDays(start, days - 1), totalDays: days,
        noticeDays: randInt(5, 20),
        description: pick(["Requesting time off for a medical procedure.", "Vacation days before they expire.", "Personal matters — flexible on exact dates."]),
        status: "PENDING", createdAt: addDays(TODAY, -randInt(0, 3)),
      },
    });
    lvC++;
  }
  // Sync employee leave cache counters.
  for (const [empId, c] of takenByEmp) {
    await db.employee.update({
      where: { id: empId },
      data: {
        leavesTaken: c.taken,
        leavesApproved: c.approved,
        leavesRejected: c.rejected,
        leavesRemaining: Math.max(0, 20 - c.taken),
      },
    });
  }
  console.log(`   LeaveRequests: +${lvC}`);

  // ── 6. General requests (all 12 types, 0–90 days back) ──────────────
  const reqSpecs: Array<{ type: Prisma.RequestCreateInput["type"]; title: string; description: string; daysAgo: number; final: "COMPLETED" | "REJECTED" | "PROCESSING" | "PENDING" }> = [
    { type: "EQUIPMENT_REQUEST", title: "Replacement torque wrench (3/4\" drive)", description: "Current unit reads 8% low against the calibration master. Need a certified replacement for the packer assembly cell.", daysAgo: 82, final: "COMPLETED" },
    { type: "TRAINING_REQUEST", title: "API 6A inspector certification", description: "Requesting enrollment in the API 6A course in Houston next quarter — directly applicable to wellhead QA sign-offs.", daysAgo: 74, final: "COMPLETED" },
    { type: "ACCESS_REQUEST", title: "ERP payroll module access", description: "Covering payroll prep while Denise is at the HR conference. Need read-write for two pay periods.", daysAgo: 66, final: "COMPLETED" },
    { type: "LOCATION_CHANGE", title: "Transfer to Midland service center", description: "Family is relocating to Midland in the fall. Requesting transfer to the west Texas field services team.", daysAgo: 58, final: "REJECTED" },
    { type: "PROJECT_REQUEST", title: "Join HPHT frac plug redesign project", description: "I have 3 years of elastomer testing background and would like to contribute to the HPHT seal stack redesign.", daysAgo: 52, final: "COMPLETED" },
    { type: "TEAM_REQUEST", title: "Add second-shift assembly floater", description: "Second shift keeps borrowing my assembler mid-run. Requesting a dedicated floater for the cell.", daysAgo: 45, final: "REJECTED" },
    { type: "PAYROLL_INQUIRY", title: "Missing Saturday overtime on last check", description: "Worked the June 13 rush order Saturday but the OT premium isn't on my stub. Kiosk punches should confirm.", daysAgo: 30, final: "COMPLETED" },
    { type: "DOCUMENT_REQUEST", title: "Employment verification letter", description: "Need a letter for a mortgage refinance — please address it to Lone Star Credit Union.", daysAgo: 24, final: "COMPLETED" },
    { type: "SCHEDULE_CHANGE", title: "Move to 4x10 schedule", description: "Childcare falls through on Fridays starting August. Happy to run Mon–Thu 10-hour days instead.", daysAgo: 18, final: "PROCESSING" },
    { type: "DETAILS_CHANGE", title: "Address + emergency contact update", description: "Moved to 4421 Oak Ridge Dr, Burleson TX 76028. Emergency contact is now my brother (817-555-0182).", daysAgo: 12, final: "COMPLETED" },
    { type: "LEAVE_REQUEST", title: "Extend approved vacation by one day", description: "Return flight from Denver got moved — requesting one extra day tacked onto my approved vacation.", daysAgo: 9, final: "PROCESSING" },
    { type: "EQUIPMENT_REQUEST", title: "Steel-toe boot allowance renewal", description: "Annual boot allowance — current pair has a split sole. Receipt to follow through reimbursements.", daysAgo: 6, final: "PENDING" },
    { type: "ACCESS_REQUEST", title: "Badge access to NDT bay after hours", description: "Magnetic particle inspections keep spilling past 17:00 — need badge access until 20:00 weekdays.", daysAgo: 4, final: "PENDING" },
    { type: "TRAINING_REQUEST", title: "CNC 5-axis programming course", description: "Haas just released the new 5-axis post for our UMC-750. Requesting the two-day programming course in Dallas.", daysAgo: 3, final: "PENDING" },
    { type: "OTHER", title: "Standing desk for drafting station", description: "Back trouble after long CAD sessions — requesting a sit/stand converter for my drafting station.", daysAgo: 2, final: "PENDING" },
    { type: "PAYROLL_INQUIRY", title: "401k deduction looks doubled", description: "This period's 401k deduction is exactly 2x my election. Can accounting check the import?", daysAgo: 1, final: "PENDING" },
  ];
  let reqC = 0;
  for (const s of reqSpecs) {
    const emp = pick(working);
    const createdAt = addDays(NOW, -s.daysAgo);
    createdAt.setHours(randInt(8, 16), randInt(0, 59), 0, 0);
    const decided = s.final === "COMPLETED" || s.final === "REJECTED";
    const processingAt = pastCap(addMin(createdAt, randInt(4, 48) * 60));
    const decidedAt = pastCap(addMin(createdAt, randInt(24, 120) * 60)); // 1–5 days
    const history: Prisma.RequestStatusHistoryCreateWithoutRequestInput[] = [
      { status: "PENDING", note: "Request submitted.", updatedById: emp.id, updatedAt: createdAt },
    ];
    if (s.final !== "PENDING") {
      history.push({ status: "PROCESSING", note: pick(["Picked up for review.", "Gathering details from supervisor.", "Checking budget and coverage."]), updatedById: adminEmp.id, updatedAt: processingAt });
    }
    if (decided) {
      history.push({
        status: s.final,
        note: s.final === "COMPLETED" ? pick(["Done — see notes.", "Approved and processed.", "Completed, confirmation sent by email."]) : pick(["Not feasible this quarter.", "Denied — see admin notes."]),
        updatedById: adminEmp.id, updatedAt: decidedAt,
      });
    }
    await db.request.create({
      data: {
        employeeId: emp.id, type: s.type, title: s.title, description: s.description,
        status: s.final,
        adminNotes: decided ? (s.final === "REJECTED" ? "Reviewed with department lead — cannot accommodate right now; revisit next quarter." : "Handled by admin — closed out.") : null,
        reviewerId: s.final === "PENDING" ? null : adminEmp.id,
        createdAt,
        updatedAt: decided ? decidedAt : s.final === "PROCESSING" ? processingAt : createdAt,
        history: { create: history },
      },
    });
    reqC++;
  }
  console.log(`   Requests: +${reqC}`);

  // ── 7. Reimbursements (90 days, weighted to last 30) ────────────────
  const reimbSpecs: Array<{ title: string; category: Prisma.ReimbursementCreateInput["category"]; amount: number; description: string; tags: string[] }> = [
    { title: "Mileage — Eagle Ford well site visit", category: "TRAVEL", amount: 214.5, description: "312 miles round trip to customer pad near Kenedy TX for on-site packer retrieval support.", tags: ["mileage", "field"] },
    { title: "Hotel — 3 nights, Midland field job", category: "ACCOMMODATION", amount: 487.2, description: "Fairfield Inn Midland during completion string installation for Concho pad.", tags: ["field", "hotel"] },
    { title: "PPE — FR coveralls and gloves", category: "EQUIPMENT", amount: 268.75, description: "Two sets of FR coveralls plus impact gloves for wireline work, per site HSE requirements.", tags: ["ppe", "safety"] },
    { title: "Calibration training — micrometer & bore gauge", category: "TRAINING", amount: 395.0, description: "One-day metrology calibration workshop at TMAC Fort Worth for the inspection lab.", tags: ["quality"] },
    { title: "Fuel — service truck, Permian run", category: "FUEL", amount: 176.4, description: "Diesel for the F-350 service truck, two-day run to Midland and back.", tags: ["field", "truck"] },
    { title: "Customer lunch — Baker Hughes buyers", category: "MEALS", amount: 96.3, description: "Lunch with two procurement contacts to review Q3 blanket PO for hammer unions.", tags: ["sales"] },
    { title: "Overnight shipping — seal stack samples", category: "OTHER", amount: 88.9, description: "Overnight two elastomer seal stacks to customer engineering for HPHT qualification.", tags: ["shipping"] },
    { title: "Digital calipers (8 in) replacement", category: "EQUIPMENT", amount: 189.0, description: "Replacement Mitutoyo calipers for the receiving inspection bench.", tags: ["quality", "tools"] },
    { title: "OSHA 30 recertification", category: "TRAINING", amount: 295.0, description: "OSHA 30-hour general industry refresher — card expires next month.", tags: ["safety"] },
    { title: "Hotel — API Spec Q1 audit prep, Houston", category: "ACCOMMODATION", amount: 342.6, description: "Two nights near the registrar's office for audit preparation sessions.", tags: ["quality", "audit"] },
    { title: "Booth supplies — Permian Basin oil show", category: "OFFICE_SUPPLIES", amount: 154.2, description: "Banner stand, literature racks and giveaways for the Odessa trade show booth.", tags: ["marketing"] },
    { title: "Mileage — Cleburne heat-treat vendor", category: "TRAVEL", amount: 64.8, description: "Round trips to the heat-treat vendor to expedite mandrel batch #4417.", tags: ["mileage"] },
    { title: "Team safety lunch — 500 days no LTI", category: "MEALS", amount: 412.0, description: "BBQ lunch for the plant floor celebrating 500 days without a lost-time incident.", tags: ["safety", "team"] },
    { title: "H2S monitor calibration gas", category: "EQUIPMENT", amount: 132.5, description: "Cal-gas cylinder for the four-gas monitors used on sour service jobs.", tags: ["field", "safety"] },
    { title: "Flight — customer failure review, OKC", category: "TRAVEL", amount: 428.9, description: "Round-trip DFW–OKC for the on-site RCA of a returned bridge plug.", tags: ["engineering"] },
    { title: "Prescription safety glasses", category: "MEDICAL", amount: 218.0, description: "ANSI Z87.1 prescription safety glasses, shop floor requirement.", tags: ["ppe"] },
    { title: "SolidWorks training add-on module", category: "TRAINING", amount: 675.0, description: "Advanced surfacing module for the drafting team's seat, needed for the new mandrel profiles.", tags: ["engineering"] },
    { title: "Fuel + parking — downtown bank & vendor runs", category: "FUEL", amount: 47.25, description: "Weekly errand runs: bank deposits, notary, and pickup at fastener vendor.", tags: ["admin"] },
  ];
  let reimbC = 0;
  for (let k = 0; k < reimbSpecs.length; k++) {
    const s = reimbSpecs[k];
    const emp = pick(working);
    // Weighted: first 12 in last 30 days, rest 31–90 days back.
    const daysAgo = k < 12 ? randInt(0, 29) : randInt(31, 88);
    const createdAt = addDays(NOW, -daysAgo);
    createdAt.setHours(randInt(8, 17), randInt(0, 59), 0, 0);
    const expenseDate = addDays(createdAt, -randInt(1, 7));
    const r = rnd();
    const status: Prisma.ReimbursementCreateInput["status"] =
      daysAgo > 30 ? (r < 0.7 ? "PAID" : r < 0.9 ? "APPROVED" : "REJECTED")
      : daysAgo > 10 ? (r < 0.35 ? "PAID" : r < 0.6 ? "APPROVED" : r < 0.75 ? "UNDER_REVIEW" : r < 0.9 ? "PENDING" : "REJECTED")
      : r < 0.45 ? "PENDING" : r < 0.75 ? "UNDER_REVIEW" : "APPROVED";
    const reviewedAt = status === "PENDING" ? null : pastCap(addMin(createdAt, randInt(12, 96) * 60));
    const approvalDate = status === "APPROVED" || status === "PAID" ? reviewedAt : null;
    const paidDate = status === "PAID" ? pastCap(addMin(reviewedAt!, randInt(24, 96) * 60)) : null;
    const history: Prisma.ReimbursementStatusHistoryCreateWithoutReimbursementInput[] = [
      { status: "PENDING", note: "Submitted with receipt.", updatedById: emp.id, updatedAt: createdAt },
    ];
    if (status !== "PENDING") history.push({ status: "UNDER_REVIEW", note: "Reviewing receipt and coding.", updatedById: adminEmp.id, updatedAt: addMin(createdAt, randInt(4, 24) * 60) });
    if (status === "APPROVED" || status === "PAID" || status === "REJECTED") {
      history.push({ status: status === "REJECTED" ? "REJECTED" : "APPROVED", note: status === "REJECTED" ? "Missing itemized receipt — please resubmit." : "Approved for next payment run.", updatedById: adminEmp.id, updatedAt: reviewedAt! });
    }
    if (status === "PAID") history.push({ status: "PAID", note: "Paid via ACH with payroll run.", updatedById: adminEmp.id, updatedAt: paidDate! });
    await db.reimbursement.create({
      data: {
        employeeId: emp.id, title: s.title, category: s.category,
        amount: D(s.amount), description: s.description, expenseDate,
        status, priority: s.amount > 400 ? "HIGH" : "MEDIUM", tags: s.tags,
        reviewerId: status === "PENDING" ? null : adminEmp.id,
        reviewedAt, approvalDate,
        reviewNotes: status === "REJECTED" ? "Card statement isn't sufficient — need the itemized receipt." : status === "PENDING" ? null : "Coded to department expense account.",
        paidDate, paidAmount: status === "PAID" ? D(s.amount) : null,
        createdAt, updatedAt: paidDate ?? reviewedAt ?? createdAt,
        history: { create: history },
      },
    });
    reimbC++;
  }
  console.log(`   Reimbursements: +${reimbC}`);

  // ── 8. Notifications ────────────────────────────────────────────────
  const allEmpIds = [...employees.map(e => e.id), adminEmp.id];
  const deptIds = (dept: string) => employees.filter(e => e.deptName === dept).map(e => e.id);
  const notifSpecs: Array<{ type: Prisma.NotificationCreateInput["type"]; title: string; message: string; priority: Prisma.NotificationCreateInput["priority"]; daysAgo: number; recipients: string[] }> = [
    { type: "PAYROLL", title: "Timesheets due Friday noon", message: "Reminder: all timesheets for the current bi-weekly period must be submitted and approved by Friday 12:00 so payroll can process Monday.", priority: "HIGH", daysAgo: 1, recipients: allEmpIds },
    { type: "ANNOUNCEMENT", title: "500 days without a lost-time incident", message: "The plant hit 500 days LTI-free this week. BBQ lunch on the company Thursday — thank you for keeping each other safe.", priority: "MEDIUM", daysAgo: 3, recipients: allEmpIds },
    { type: "POLICY", title: "Updated PPE policy — shop floor", message: "Cut-resistant gloves are now required for all forging and saw operations. New stock is at the supervisor stations; sign the acknowledgment by end of week.", priority: "URGENT", daysAgo: 5, recipients: [...deptIds("Manufacturing"), ...deptIds("Quality Assurance")] },
    { type: "COMPANY", title: "New CNC lathe arriving in Bay 3", message: "The new Haas ST-35Y lands week after next. Bay 3 will be re-striped over the weekend — keep the aisle clear starting Friday.", priority: "MEDIUM", daysAgo: 8, recipients: deptIds("Manufacturing") },
    { type: "PAYROLL", title: "Direct deposit lands one day early", message: "Because of the bank holiday, this period's direct deposits will post Thursday instead of Friday. No action needed.", priority: "MEDIUM", daysAgo: 11, recipients: allEmpIds },
    { type: "ANNOUNCEMENT", title: "Q3 all-hands — customer wins & roadmap", message: "Join us Friday 3 PM in the training room for Q3 kickoff: two new frac plug qualifications, the Midland expansion, and service award announcements.", priority: "HIGH", daysAgo: 14, recipients: allEmpIds },
    { type: "POLICY", title: "Vacation blackout — API audit week", message: "Heads up: the API Spec Q1 surveillance audit is scheduled in six weeks. QA and Manufacturing leads, please avoid approving PTO for audit week.", priority: "HIGH", daysAgo: 18, recipients: [...deptIds("Quality Assurance"), ...deptIds("Manufacturing")] },
    { type: "COMPANY", title: "Welcome our summer interns", message: "Two engineering interns from UT Arlington start Monday — they'll be shadowing the drafting team and helping with the test-stand data logger.", priority: "LOW", daysAgo: 22, recipients: allEmpIds },
    { type: "ANNOUNCEMENT", title: "Parking lot repaving — use east lot", message: "The main lot gets repaved Wednesday–Thursday. Park in the east gravel lot; the shuttle golf cart runs 6:30–8:30 AM.", priority: "MEDIUM", daysAgo: 26, recipients: allEmpIds },
    { type: "OTHER", title: "Benefits open enrollment opens Aug 1", message: "Open enrollment for medical/dental/vision runs Aug 1–15. HR will hold two info sessions; packets go out next week.", priority: "MEDIUM", daysAgo: 29, recipients: allEmpIds },
  ];
  let notifC = 0;
  for (const s of notifSpecs) {
    const createdAt = addDays(NOW, -s.daysAgo);
    createdAt.setHours(randInt(7, 16), randInt(0, 59), 0, 0);
    await db.notification.create({
      data: {
        type: s.type, title: s.title, message: s.message, priority: s.priority,
        senderId: adminUser.id, createdAt,
        recipients: {
          create: s.recipients.map(empId => {
            const read = chance(0.6);
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

  // ── 9. Payroll calendar (bi-weekly: 6 completed + current + next) ───
  // Current period: started 9 days ago, ends in 4 days.
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  let pcC = 0;
  for (let p = -6; p <= 1; p++) {
    const start = addDays(TODAY, -9 + p * 14);
    const end = addDays(start, 13);
    const payDate = addDays(end, 6);
    const status: Prisma.PayrollCalendarCreateInput["status"] = p < 0 ? "COMPLETED" : p === 0 ? "CURRENT" : "UPCOMING";
    const exists = await db.payrollCalendar.findFirst({ where: { payPeriodStart: start, payPeriodEnd: end } });
    if (exists) continue;
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
  console.log(`   PayrollCalendar: +${pcC}`);

  // ── 10. Audit log (~150 rows over 30 days) ──────────────────────────
  const auditActions: Array<{ action: string; resource: string; adminOnly: boolean }> = [
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
    { action: "knowledge.upload", resource: "KnowledgeDocument", adminOnly: false },
    { action: "knowledge.search", resource: "KnowledgeDocument", adminOnly: false },
    { action: "kiosk.session.create", resource: "KioskSession", adminOnly: true },
    { action: "document.download", resource: "Document", adminOnly: false },
  ];
  const cuidish = () => "c" + Math.floor(rnd() * 1e16).toString(36).padStart(11, "0");
  const auditRows: Prisma.AuditLogCreateManyInput[] = [];
  for (let k = 0; k < 150; k++) {
    const spec = pick(auditActions);
    const actor = spec.adminOnly || chance(0.35)
      ? { userId: adminUser.id, email: adminUser.email }
      : (() => { const e = pick(working); return { userId: e.userId, email: e.email }; })();
    const t = addDays(NOW, -randInt(0, 29));
    t.setHours(randInt(6, 18), randInt(0, 59), randInt(0, 59), 0);
    const ts = pastCap(t);
    auditRows.push({
      actorId: actor.userId, actorEmail: actor.email,
      action: spec.action, resource: `${spec.resource}:${cuidish()}`,
      ip: `10.20.${randInt(0, 4)}.${randInt(2, 250)}`,
      createdAt: ts,
    });
  }
  await db.auditLog.createMany({ data: auditRows });
  console.log(`   AuditLog: +${auditRows.length}`);

  // ── 11. Idempotency marker ──────────────────────────────────────────
  await db.auditLog.create({
    data: {
      actorId: adminUser.id, actorEmail: adminUser.email,
      action: MARKER_ACTION, resource: "SeedScript:seed-30-days",
      diff: { employees: employees.length, timeEntries: teC, schedules: schedC, scheduledWork: swC, leaves: lvC, requests: reqC, reimbursements: reimbC, notifications: notifC },
    },
  });
  console.log("✓ done — marker written (delete AuditLog action 'seed.30days' to allow re-seeding)");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
