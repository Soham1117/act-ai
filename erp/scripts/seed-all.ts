/**
 * ACT ERP — comprehensive seed.
 *
 * Run with:  pnpm seed:all
 *
 * This script:
 *  1. Provisions Supabase Auth users for the 8 named accounts + 40 faker employees.
 *  2. Creates the matching User + Employee + JobCodeAssignment rows.
 *  3. Backfills 12 months of TimeEntry / LeaveRequest / Reimbursement /
 *     Request / Notification / Payroll data so the dashboard reads as a
 *     real, established workforce.
 *  4. Prints a credentials table at the end.
 *
 * Idempotent-ish: it always wipes seeded tables first. Designed for demo
 * environments — do not run against a database with real users.
 */

import "dotenv/config";
import { PrismaClient, Prisma } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { faker } from "@faker-js/faker";
import {
  addDays,
  format,
  isWeekend,
  setHours,
  setMinutes,
  startOfDay,
  subDays,
  subMonths,
  subYears,
} from "date-fns";
import {
  DEPARTMENTS,
  DEPT_QUOTAS,
  FAKER_NAMES,
  JOB_CODES,
  NAMED_USERS,
  TITLES_BY_DEPT,
  TX_AREA_CODES,
  TX_CITIES,
} from "./seed/data";

faker.seed(424242);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("\n❌  Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local first.\n");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const db = new PrismaClient();

const NOW = new Date();
const TWELVE_MONTHS_AGO = subMonths(NOW, 12);

// ─────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────

function rand<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function fakePhone(): string {
  const ac = rand(TX_AREA_CODES);
  return `(${ac}) 555-${String(faker.number.int({ min: 100, max: 999 })).padStart(3, "0")}${String(faker.number.int({ min: 0, max: 9 }))}`;
}

function fakeSSN(): string {
  // 9XX prefix → guaranteed invalid (ITIN-shape, never reused).
  return `9${faker.number.int({ min: 10, max: 99 })}-${String(faker.number.int({ min: 10, max: 99 }))}-${String(faker.number.int({ min: 1000, max: 9999 }))}`;
}

function emailFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/\s+/g, ".")
    + "@actools.com";
}

function pickAddress() {
  const c = rand(TX_CITIES);
  return {
    address: `${faker.location.buildingNumber()} ${faker.location.street()}`,
    city: c.city,
    state: c.state,
    zipCode: rand(c.zips),
  };
}

async function wipeAll() {
  console.log("🧹  Wiping seeded tables…");
  // Order matters — children before parents.
  await db.notificationRecipient.deleteMany();
  await db.notification.deleteMany();
  await db.reimbursementStatusHistory.deleteMany();
  await db.reimbursementReceipt.deleteMany();
  await db.reimbursement.deleteMany();
  await db.requestStatusHistory.deleteMany();
  await db.request.deleteMany();
  await db.leaveRequest.deleteMany();
  await db.timeBreak.deleteMany();
  await db.timeEntry.deleteMany();
  await db.scheduledWork.deleteMany();
  await db.schedule.deleteMany();
  await db.scheduleTemplate.deleteMany();
  await db.kioskSession.deleteMany();
  await db.onboardingInvite.deleteMany();
  await db.payroll.deleteMany();
  await db.payrollCalendar.deleteMany();
  await db.document.deleteMany();
  await db.companyDefault.deleteMany();
  await db.jobCodeAssignment.deleteMany();
  await db.auditLog.deleteMany();
  await db.employee.deleteMany();
  await db.user.deleteMany();
  await db.jobCode.deleteMany();
  await db.department.deleteMany();

  // Wipe Supabase auth users that match @actools.com.
  const { data: existing } = await supabase.auth.admin.listUsers({ perPage: 200 });
  for (const u of existing?.users ?? []) {
    if (u.email?.endsWith("@actools.com")) {
      await supabase.auth.admin.deleteUser(u.id).catch(() => null);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// 1. Departments + Job codes
// ─────────────────────────────────────────────────────────────────────

async function seedOrg() {
  console.log("📋  Seeding departments, job codes…");
  const departmentsByName = new Map<string, string>();
  for (const d of DEPARTMENTS) {
    const dept = await db.department.create({ data: d });
    departmentsByName.set(d.name, dept.id);
  }

  const jobCodesByCode = new Map<string, string>();
  for (const j of JOB_CODES) {
    const jc = await db.jobCode.create({
      data: {
        code: j.code,
        title: j.title,
        rate: j.rate,
        isDefault: "isDefault" in j ? Boolean(j.isDefault) : false,
        isActive: true,
      },
    });
    jobCodesByCode.set(j.code, jc.id);
  }

  return { departmentsByName, jobCodesByCode };
}

// ─────────────────────────────────────────────────────────────────────
// 2. Employees (named + faker)
// ─────────────────────────────────────────────────────────────────────

type CreatedEmployee = {
  authId: string;
  empRowId: string;       // Employee.id
  employeeId: string;     // EMP-YYYY-NNNN
  email: string;
  name: string;
  password: string | null;
  department: string;
  primaryJobCode: string;
  employmentType: "FULL_PART_TIME" | "CONTRACT_HOURLY";
  defaultHourlyRate: number;
  hireDate: Date;
};

async function seedEmployees(
  ctx: Awaited<ReturnType<typeof seedOrg>>,
): Promise<CreatedEmployee[]> {
  console.log("👥  Provisioning Supabase auth users + employees…");
  const { departmentsByName, jobCodesByCode } = ctx;

  const created: CreatedEmployee[] = [];
  let employeeSeq = 1;

  async function provision(
    spec: {
      name: string;
      email: string;
      password: string;
      role: "ADMIN" | "EMPLOYEE";
      department: string;
      jobTitle: string;
      employmentType: "FULL_PART_TIME" | "CONTRACT_HOURLY";
      compensationType: "MONTHLY_SALARY" | "HOURLY_RATE" | "TOTAL_COMPENSATION";
      compensationValue: number;
      gender: "MALE" | "FEMALE" | "OTHER";
      primaryJobCode: string;
      hireYearsAgo?: number;
    },
  ) {
    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email: spec.email,
      password: spec.password,
      email_confirm: true,
      user_metadata: { name: spec.name },
    });
    if (authErr || !authData?.user) {
      throw new Error(`Auth user creation failed for ${spec.email}: ${authErr?.message}`);
    }
    const authId = authData.user.id;

    const hireYearsAgo = spec.hireYearsAgo ?? faker.number.int({ min: 0, max: 6 });
    const dateOfHire = subYears(NOW, hireYearsAgo);
    dateOfHire.setMonth(faker.number.int({ min: 0, max: 11 }));
    dateOfHire.setDate(faker.number.int({ min: 1, max: 28 }));

    const year = dateOfHire.getFullYear();
    const employeeId = `EMP-${year}-${String(employeeSeq++).padStart(4, "0")}`;
    const addr = pickAddress();

    const defaultHourlyRate =
      spec.compensationType === "HOURLY_RATE" ? spec.compensationValue : 25;

    const employee = await db.$transaction(async (tx) => {
      await tx.user.create({
        data: {
          id: authId,
          email: spec.email,
          name: spec.name,
          role: spec.role,
        },
      });
      const e = await tx.employee.create({
        data: {
          employeeId,
          userId: authId,
          name: spec.name,
          gender: spec.gender,
          email: spec.email,
          phoneNumber: fakePhone(),
          dateOfBirth: faker.date.birthdate({ min: 24, max: 58, mode: "age" }),
          ssn: fakeSSN(),
          ...addr,
          nationality: "American",
          educationLevel: faker.helpers.arrayElement([
            "High School", "Associate's", "Bachelor's", "Master's", "Trade School",
          ]),
          certifications: faker.helpers.arrayElements(
            ["OSHA-30", "H2S Awareness", "Forklift", "Welding Cert", "First Aid", "API Q1"],
            { min: 0, max: 3 },
          ),
          emergencyName: faker.person.fullName(),
          emergencyPhone: fakePhone(),
          departmentId: departmentsByName.get(spec.department) ?? null,
          jobTitle: spec.jobTitle,
          position: spec.jobTitle,
          dateOfHire,
          employmentType: spec.employmentType,
          employmentStatus: "ACTIVE",
          workEmail: spec.email,
          workPhoneNumber: fakePhone(),
          compensationType: spec.compensationType,
          compensationValue: new Prisma.Decimal(spec.compensationValue),
          primaryJobCodeId: jobCodesByCode.get(spec.primaryJobCode) ?? null,
          defaultHourlyRate: new Prisma.Decimal(defaultHourlyRate),
          totalLeaves: 20,
          leavesRemaining: 20,
        },
      });
      // Primary job code assignment.
      const jobCodeId = jobCodesByCode.get(spec.primaryJobCode);
      if (jobCodeId) {
        await tx.jobCodeAssignment.create({
          data: {
            jobCodeId,
            employeeId: e.id,
            isPrimary: true,
            assignedRate:
              spec.compensationType === "HOURLY_RATE"
                ? `$${spec.compensationValue.toFixed(2)}/hr`
                : "NA",
          },
        });
      }
      return e;
    });

    created.push({
      authId,
      empRowId: employee.id,
      employeeId,
      email: spec.email,
      name: spec.name,
      password: spec.password,
      department: spec.department,
      primaryJobCode: spec.primaryJobCode,
      employmentType: spec.employmentType,
      defaultHourlyRate,
      hireDate: dateOfHire,
    });
  }

  // Named accounts.
  for (const u of NAMED_USERS) {
    const { roles: legacyRoles, ...rest } = u;
    await provision({
      ...rest,
      role: (legacyRoles as readonly string[]).includes("admin") ? "ADMIN" : "EMPLOYEE",
      hireYearsAgo: faker.number.int({ min: 2, max: 6 }),
    });
  }

  // Faker accounts — assigned to departments by quota.
  const quotaState: Record<string, number> = Object.fromEntries(
    Object.entries(DEPT_QUOTAS).map(([k, v]) => [k, v]),
  );
  let i = 0;
  for (const fake of FAKER_NAMES) {
    // Pick a department that still has quota.
    const candidates = Object.entries(quotaState).filter(([, v]) => v > 0);
    if (candidates.length === 0) break;
    const [deptName] = candidates[i % candidates.length];
    quotaState[deptName] -= 1;

    const titles = TITLES_BY_DEPT[deptName] ?? ["Specialist"];
    const title = rand(titles);
    const isHourly = ["Assembly", "Manufacturing", "Warehouse"].includes(deptName);
    const hourlyRate = faker.number.int({ min: 22, max: 48 });
    const monthly = faker.number.int({ min: 6, max: 11 }) * 1000;
    const primaryCode = pickJobCodeFor(deptName);

    await provision({
      name: fake.name,
      email: emailFromName(fake.name),
      password: "Demo$2026",
      role: "EMPLOYEE",
      department: deptName,
      jobTitle: title,
      employmentType: isHourly ? "CONTRACT_HOURLY" : "FULL_PART_TIME",
      compensationType: isHourly ? "HOURLY_RATE" : "MONTHLY_SALARY",
      compensationValue: isHourly ? hourlyRate : monthly,
      gender: fake.gender,
      primaryJobCode: primaryCode,
    });
    i++;
  }

  console.log(`   created ${created.length} employees.`);
  return created;
}

function pickJobCodeFor(department: string): string {
  switch (department) {
    case "Engineering":   return rand(["ENG-MECH", "ENG-DSGN"]);
    case "Assembly":      return rand(["MFG-ASM", "PROD-QA"]);
    case "Manufacturing": return rand(["PROD-CNC", "PROD-WLD", "PROD-QA", "MFG-MAINT"]);
    case "Warehouse":     return rand(["WH-SHP", "WH-INV"]);
    case "Sales":         return rand(["SALES-AE", "SALES-SE"]);
    case "InsideSales":   return rand(["SALES-AE", "OFFICE"]);
    case "Admin":         return "OFFICE";
    case "Operations":    return "AUTO001";
    default:              return "ACT001";
  }
}

// ─────────────────────────────────────────────────────────────────────
// 3. Time entries — 12 months of approved timesheets
// ─────────────────────────────────────────────────────────────────────

async function seedTimeEntries(employees: CreatedEmployee[]) {
  console.log("⏰  Seeding 12 months of time entries…");
  const rows: Prisma.TimeEntryCreateManyInput[] = [];
  let count = 0;

  for (const e of employees) {
    if (e.email === "kiosk.plant@actools.com") continue;

    const isFieldCrew = e.primaryJobCode.startsWith("WS");
    const isShopFloor = ["PROD-CNC", "PROD-WLD", "PROD-QA", "MFG-ASM", "MFG-MAINT"].includes(e.primaryJobCode);
    const isWarehouse = e.primaryJobCode.startsWith("WH");

    let day = startOfDay(TWELVE_MONTHS_AGO);
    while (day <= NOW) {
      // Skip weekends for office; warehouse Mon-Sat; field crews 7-on-7-off (every other week).
      const dow = day.getDay();
      let work = false;
      let startH = 8, endH = 17, endM = 0;
      const startM = 0;
      if (isFieldCrew) {
        // Rotate weekly: weeks where week-number % 2 == 0 are on.
        const weekNo = Math.floor((day.getTime() - TWELVE_MONTHS_AGO.getTime()) / (7 * 24 * 3600_000));
        work = weekNo % 2 === 0;
        startH = 6; endH = 18;
      } else if (isShopFloor) {
        work = !isWeekend(day);
        startH = 6; endH = 14; endM = 30;
      } else if (isWarehouse) {
        work = dow !== 0; // Mon-Sat
        startH = 7; endH = 15; endM = 30;
      } else {
        work = !isWeekend(day);
      }
      if (!work) {
        day = addDays(day, 1);
        continue;
      }

      // Add ±10 min jitter
      const clockIn = setMinutes(setHours(new Date(day), startH), startM + faker.number.int({ min: -8, max: 10 }));
      const clockOut = setMinutes(setHours(new Date(day), endH), endM + faker.number.int({ min: -8, max: 10 }));
      const lunchMin = 30;
      const totalMs = clockOut.getTime() - clockIn.getTime();
      const totalWorkMin = Math.max(0, Math.floor(totalMs / 60_000) - lunchMin);

      // Approval mix: 85% approved, 10% pending (recent), 5% rejected.
      const recent = day > subDays(NOW, 14);
      const r = Math.random();
      const approval: Prisma.TimeEntryCreateManyInput["approvalStatus"] =
        recent && r < 0.4 ? "PENDING" :
        r < 0.85 ? "APPROVED" :
        r < 0.95 ? "PENDING" : "REJECTED";
      const status: Prisma.TimeEntryCreateManyInput["status"] =
        approval === "APPROVED" ? "APPROVED" :
        approval === "REJECTED" ? "REJECTED" :
        "PENDING_APPROVAL";

      rows.push({
        employeeId: e.empRowId,
        date: startOfDay(day),
        clockIn,
        clockOut,
        totalBreakMin: lunchMin,
        totalWorkMin,
        status,
        jobCode: e.primaryJobCode,
        rate: new Prisma.Decimal(e.defaultHourlyRate),
        approvalStatus: approval,
        source: "AUTO",
      });
      count++;

      day = addDays(day, 1);
    }
  }

  // Bulk insert in chunks to avoid statement-size limits.
  for (let i = 0; i < rows.length; i += 1000) {
    await db.timeEntry.createMany({ data: rows.slice(i, i + 1000) });
  }
  console.log(`   created ${count} time entries.`);
}

// ─────────────────────────────────────────────────────────────────────
// 4. Schedules — 4 weeks back + 4 weeks ahead
// ─────────────────────────────────────────────────────────────────────

async function seedSchedules(employees: CreatedEmployee[]) {
  console.log("📅  Seeding schedules (8-week window)…");
  const rows: Prisma.ScheduleCreateManyInput[] = [];
  for (const e of employees) {
    if (e.email === "kiosk.plant@actools.com") continue;
    const isShopFloor = ["PROD-CNC", "PROD-WLD", "PROD-QA", "MFG-ASM", "MFG-MAINT"].includes(e.primaryJobCode);
    const isWarehouse = e.primaryJobCode.startsWith("WH");
    const isFieldCrew = e.primaryJobCode.startsWith("WS");

    for (let d = -28; d <= 28; d++) {
      const day = addDays(NOW, d);
      const dow = day.getDay();
      let scheduled = false;
      let start = "08:00", end = "17:00";
      if (isFieldCrew) {
        const weekNo = Math.floor((day.getTime() - TWELVE_MONTHS_AGO.getTime()) / (7 * 24 * 3600_000));
        scheduled = weekNo % 2 === 0;
        start = "06:00"; end = "18:00";
      } else if (isShopFloor) {
        scheduled = !isWeekend(day);
        start = "06:00"; end = "14:30";
      } else if (isWarehouse) {
        scheduled = dow !== 0;
        start = "07:00"; end = "15:30";
      } else {
        scheduled = !isWeekend(day);
      }
      if (!scheduled) continue;
      rows.push({
        employeeId: e.empRowId,
        date: startOfDay(day),
        jobCode: e.primaryJobCode,
        startTime: start,
        endTime: end,
      });
    }
  }
  for (let i = 0; i < rows.length; i += 1000) {
    await db.schedule.createMany({ data: rows.slice(i, i + 1000) });
  }
  console.log(`   created ${rows.length} schedules.`);
}

// ─────────────────────────────────────────────────────────────────────
// 5. Leave requests — 40 across 12 months
// ─────────────────────────────────────────────────────────────────────

async function seedLeave(employees: CreatedEmployee[]) {
  console.log("✈️   Seeding leave requests…");
  const types = ["ANNUAL", "ANNUAL", "ANNUAL", "ANNUAL", "SICK", "SICK", "SICK", "PERSONAL", "FAMILY", "EMERGENCY", "OTHER"] as const;
  const statuses = [
    ...Array(6).fill("PENDING"),
    ...Array(28).fill("APPROVED"),
    ...Array(4).fill("REJECTED"),
    ...Array(2).fill("CANCELLED"),
  ];
  for (let i = 0; i < statuses.length; i++) {
    const e = rand(employees.filter((x) => x.email !== "kiosk.plant@actools.com"));
    const monthsAgo = faker.number.int({ min: 0, max: 11 });
    const start = subMonths(NOW, monthsAgo);
    start.setDate(faker.number.int({ min: 1, max: 26 }));
    const days = faker.number.int({ min: 1, max: 5 });
    const end = addDays(start, days - 1);
    const type = rand(types);
    const status = statuses[i] as "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

    await db.leaveRequest.create({
      data: {
        employeeId: e.empRowId,
        leaveType: type,
        startDate: startOfDay(start),
        endDate: startOfDay(end),
        totalDays: days,
        noticeDays: faker.number.int({ min: 0, max: 21 }),
        description: faker.lorem.sentence(),
        status,
        reviewedAt: status !== "PENDING" ? subDays(NOW, faker.number.int({ min: 1, max: 30 })) : null,
        reviewNotes: status === "APPROVED" ? "Approved." : status === "REJECTED" ? "Conflicts with prior commitment." : null,
      },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────
// 6. Reimbursements — 35 mixed status
// ─────────────────────────────────────────────────────────────────────

async function seedReimbursements(employees: CreatedEmployee[]) {
  console.log("💵  Seeding reimbursements…");
  const cats = ["TRAVEL", "TRAVEL", "TRAVEL", "TRAVEL", "TRAVEL", "FUEL", "FUEL", "FUEL", "FUEL", "FUEL", "FUEL", "FUEL", "MEALS", "MEALS", "MEALS", "MEALS", "EQUIPMENT", "EQUIPMENT", "EQUIPMENT", "TRAINING", "ACCOMMODATION", "ACCOMMODATION", "OFFICE_SUPPLIES", "MEDICAL"] as const;
  const statuses = [
    ...Array(4).fill("PENDING"),
    ...Array(3).fill("UNDER_REVIEW"),
    ...Array(8).fill("APPROVED"),
    ...Array(18).fill("PAID"),
    ...Array(2).fill("REJECTED"),
  ];

  for (let i = 0; i < statuses.length; i++) {
    const e = rand(employees.filter((x) => x.email !== "kiosk.plant@actools.com"));
    const cat = rand(cats);
    const monthsAgo = faker.number.int({ min: 0, max: 11 });
    const expense = subMonths(NOW, monthsAgo);
    const status = statuses[i] as "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "PAID";

    const amountRanges: Record<string, [number, number]> = {
      TRAVEL: [200, 2400],
      FUEL: [40, 180],
      MEALS: [20, 120],
      EQUIPMENT: [50, 1500],
      TRAINING: [150, 800],
      ACCOMMODATION: [120, 600],
      OFFICE_SUPPLIES: [25, 200],
      MEDICAL: [50, 400],
      OTHER: [25, 300],
    };
    const [lo, hi] = amountRanges[cat] ?? [50, 500];
    const amount = faker.number.float({ min: lo, max: hi, fractionDigits: 2 });

    const titles: Record<string, string[]> = {
      TRAVEL:        ["Client visit Midland", "Vendor meeting Tulsa", "Training travel", "Field deployment"],
      FUEL:          ["Service truck fuel", "Vehicle fuel — week 18", "Field crew gas"],
      MEALS:         ["Client dinner", "Team lunch", "Job-site meals"],
      EQUIPMENT:     ["Replacement tools", "Calibration kit", "Safety boots", "PPE replacement"],
      TRAINING:      ["OSHA-30 renewal", "API Q1 training"],
      ACCOMMODATION: ["Field hotel — 2 nights", "Lodging Odessa"],
      OFFICE_SUPPLIES:["Office supply order", "Print stock"],
      MEDICAL:       ["DOT physical", "First-aid kit refresh"],
    };

    const r = await db.reimbursement.create({
      data: {
        employeeId: e.empRowId,
        title: rand(titles[cat] ?? ["Expense claim"]),
        category: cat,
        amount: new Prisma.Decimal(amount.toFixed(2)),
        currency: "USD",
        description: faker.lorem.sentence(),
        expenseDate: startOfDay(expense),
        status,
        priority: rand(["LOW", "MEDIUM", "MEDIUM", "HIGH"] as const),
        approvalDate: status === "APPROVED" || status === "PAID" ? subDays(NOW, faker.number.int({ min: 1, max: 30 })) : null,
        paidDate: status === "PAID" ? subDays(NOW, faker.number.int({ min: 1, max: 14 })) : null,
        paidAmount: status === "PAID" ? new Prisma.Decimal(amount.toFixed(2)) : null,
      },
    });
    await db.reimbursementStatusHistory.create({
      data: { reimbursementId: r.id, status: "PENDING", note: "Submitted" },
    });
    if (status !== "PENDING") {
      await db.reimbursementStatusHistory.create({
        data: { reimbursementId: r.id, status, note: "Reviewed" },
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// 7. Requests — 25 across types/statuses
// ─────────────────────────────────────────────────────────────────────

async function seedRequests(employees: CreatedEmployee[]) {
  console.log("📨  Seeding requests…");
  const types = [
    "DETAILS_CHANGE", "DETAILS_CHANGE", "EQUIPMENT_REQUEST", "EQUIPMENT_REQUEST", "EQUIPMENT_REQUEST",
    "TRAINING_REQUEST", "TRAINING_REQUEST", "SCHEDULE_CHANGE", "SCHEDULE_CHANGE", "DOCUMENT_REQUEST",
    "DOCUMENT_REQUEST", "PAYROLL_INQUIRY", "ACCESS_REQUEST", "LOCATION_CHANGE", "TEAM_REQUEST",
    "PROJECT_REQUEST", "OTHER",
  ] as const;
  const statuses = [
    ...Array(4).fill("PENDING"),
    ...Array(3).fill("PROCESSING"),
    ...Array(15).fill("COMPLETED"),
    ...Array(3).fill("REJECTED"),
  ];
  const titles: Record<string, string> = {
    DETAILS_CHANGE: "Update emergency contact",
    EQUIPMENT_REQUEST: "New laptop / monitor request",
    TRAINING_REQUEST: "OSHA-30 renewal training",
    SCHEDULE_CHANGE: "Shift swap with teammate",
    DOCUMENT_REQUEST: "Employment verification letter",
    PAYROLL_INQUIRY: "Last paycheck question",
    ACCESS_REQUEST: "Access to job-code reports",
    LOCATION_CHANGE: "Transfer to Midland office",
    TEAM_REQUEST: "Team transfer",
    PROJECT_REQUEST: "Assignment to ESP-2K project",
    LEAVE_REQUEST: "Add a half-day off",
    OTHER: "General request",
  };

  for (let i = 0; i < statuses.length; i++) {
    const e = rand(employees);
    const t = rand(types);
    const status = statuses[i] as "PENDING" | "PROCESSING" | "COMPLETED" | "REJECTED";
    const r = await db.request.create({
      data: {
        employeeId: e.empRowId,
        type: t,
        title: titles[t],
        description: faker.lorem.paragraph(),
        status,
        adminNotes: status !== "PENDING" ? faker.lorem.sentence() : null,
      },
    });
    await db.requestStatusHistory.create({
      data: { requestId: r.id, status: "PENDING", note: "Submitted" },
    });
    if (status !== "PENDING") {
      await db.requestStatusHistory.create({
        data: { requestId: r.id, status, note: "Updated by admin" },
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// 8. Notifications — 12 months of broadcasts
// ─────────────────────────────────────────────────────────────────────

async function seedNotifications(employees: CreatedEmployee[]) {
  console.log("🔔  Seeding notifications…");
  const broadcasts: Array<{ type: "PAYROLL" | "COMPANY" | "ANNOUNCEMENT" | "POLICY" | "OTHER"; title: string; message: string; priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT" }> = [
    { type: "ANNOUNCEMENT", title: "Q2 Safety Stand-down — Friday 06:00", message: "All shop-floor and field personnel — mandatory safety stand-down this Friday at 06:00. Plan accordingly.", priority: "HIGH" },
    { type: "ANNOUNCEMENT", title: "Q3 All-Hands Recap",                  message: "Recap of Q3 results, downhole-tools division up 18% YoY. See linked deck.", priority: "MEDIUM" },
    { type: "ANNOUNCEMENT", title: "Holiday schedule",                    message: "Updated holiday schedule for the rest of the year is now in the documents portal.", priority: "MEDIUM" },
    { type: "ANNOUNCEMENT", title: "Benefits enrollment open",            message: "Open enrollment is live through the end of the month.", priority: "MEDIUM" },
    { type: "POLICY",       title: "Updated PPE policy — effective Mon",  message: "All field crews must complete the 5-min training video before next shift.", priority: "HIGH" },
    { type: "POLICY",       title: "Time-off policy update",              message: "PTO accrual cap increased to 40 days. Details in policy portal.", priority: "MEDIUM" },
    { type: "POLICY",       title: "Expense reporting policy refresh",    message: "Receipts now required for any reimbursement over $25.", priority: "MEDIUM" },
    { type: "POLICY",       title: "Harassment-prevention training",      message: "Annual training assigned — complete within 30 days.", priority: "HIGH" },
    { type: "PAYROLL",      title: "Pay stubs available",                 message: "Latest pay-stub is available in your payroll portal.", priority: "LOW" },
    { type: "PAYROLL",      title: "Direct deposit reminder",             message: "Confirm or update your direct-deposit details if recently changed.", priority: "LOW" },
    { type: "COMPANY",      title: "ACT named to top oilfield-completions list",   message: "Houston Business Journal recognised ACT in its top oilfield-completions companies list.", priority: "MEDIUM" },
    { type: "COMPANY",      title: "New equipment in the shop",           message: "Two new CNC mills installed in Bay 3 — operator training begins Tuesday.", priority: "MEDIUM" },
  ];

  // Stagger across 12 months.
  for (let i = 0; i < broadcasts.length; i++) {
    const b = broadcasts[i];
    const created = subMonths(NOW, faker.number.int({ min: 0, max: 11 }));
    const sender = NAMED_USERS[i % NAMED_USERS.length];
    const senderUser = employees.find((e) => e.email === sender.email);
    const notif = await db.notification.create({
      data: {
        type: b.type,
        title: b.title,
        message: b.message,
        priority: b.priority,
        senderId: senderUser?.authId ?? null,
        createdAt: created,
      },
    });
    // Recipients = all active employees, ~70% read
    const recipients = employees
      .filter((e) => e.email !== "kiosk.plant@actools.com")
      .map((e) => ({
        notificationId: notif.id,
        employeeId: e.empRowId,
        read: Math.random() < 0.7,
        readAt: Math.random() < 0.7 ? subDays(NOW, faker.number.int({ min: 0, max: 30 })) : null,
      }));
    for (let j = 0; j < recipients.length; j += 1000) {
      await db.notificationRecipient.createMany({ data: recipients.slice(j, j + 1000) });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// 9. Payroll calendar + onboarding invites + audit log
// ─────────────────────────────────────────────────────────────────────

async function seedPayrollAndAudit(employees: CreatedEmployee[]) {
  console.log("📆  Seeding pay calendar + onboarding invites + audit log…");
  // Bi-weekly Friday pay periods, 26 across 12 months.
  const admin = employees.find((e) => e.email === "marcus.holloway@actools.com")!;
  let cursor = subMonths(NOW, 12);
  // Find next Friday.
  while (cursor.getDay() !== 5) cursor = addDays(cursor, 1);
  const periods: Prisma.PayrollCalendarCreateManyInput[] = [];
  for (let i = 0; i < 26; i++) {
    const start = subDays(cursor, 13);
    const end = subDays(cursor, 0);
    const payDate = addDays(end, 5); // following Wed
    const status: "UPCOMING" | "CURRENT" | "COMPLETED" =
      payDate < NOW ? "COMPLETED" : payDate <= addDays(NOW, 7) ? "CURRENT" : "UPCOMING";
    periods.push({
      title: `Bi-weekly · ${format(start, "MMM d")} → ${format(end, "MMM d, yyyy")}`,
      payPeriodStart: startOfDay(start),
      payPeriodEnd: startOfDay(end),
      payDate: startOfDay(payDate),
      status,
      createdById: admin.authId,
    });
    cursor = addDays(cursor, 14);
  }
  await db.payrollCalendar.createMany({ data: periods });

  // Onboarding invites
  await db.onboardingInvite.createMany({
    data: [
      { token: faker.string.uuid(), email: "newhire1@actools.com", status: "PENDING",   expiresAt: addDays(NOW, 5),  createdById: admin.authId },
      { token: faker.string.uuid(), email: "newhire2@actools.com", status: "PENDING",   expiresAt: addDays(NOW, 6),  createdById: admin.authId },
      { token: faker.string.uuid(), email: "newhire3@actools.com", status: "PENDING",   expiresAt: addDays(NOW, 7),  createdById: admin.authId },
      { token: faker.string.uuid(), email: "newhire4@actools.com", status: "PENDING",   expiresAt: addDays(NOW, 7),  createdById: admin.authId },
      { token: faker.string.uuid(), email: "completed1@actools.com", status: "COMPLETED", expiresAt: subDays(NOW, 5),  createdById: admin.authId, completedAt: subDays(NOW, 4) },
      { token: faker.string.uuid(), email: "completed2@actools.com", status: "COMPLETED", expiresAt: subDays(NOW, 8),  createdById: admin.authId, completedAt: subDays(NOW, 7) },
      { token: faker.string.uuid(), email: "completed3@actools.com", status: "COMPLETED", expiresAt: subDays(NOW, 12), createdById: admin.authId, completedAt: subDays(NOW, 11) },
      { token: faker.string.uuid(), email: "expired1@actools.com",   status: "EXPIRED",   expiresAt: subDays(NOW, 14), createdById: admin.authId },
      { token: faker.string.uuid(), email: "expired2@actools.com",   status: "EXPIRED",   expiresAt: subDays(NOW, 22), createdById: admin.authId },
    ],
  });

  // Audit log — synthetic events for the activity feed.
  const actions = [
    "employee.create", "employee.update", "leave.approve", "leave.reject",
    "reimbursement.approve", "reimbursement.pay", "schedule.create",
    "request.update", "ssn.view", "payroll.upload", "kiosk.provision",
    "notification.broadcast", "timeentry.approve",
  ];
  const audit: Prisma.AuditLogCreateManyInput[] = [];
  for (let i = 0; i < 200; i++) {
    const actor = rand(employees.filter((e) => e.email.endsWith("@actools.com")));
    audit.push({
      actorId: actor.authId,
      actorEmail: actor.email,
      action: rand(actions),
      resource: `Employee:${rand(employees).empRowId}`,
      createdAt: subDays(NOW, faker.number.int({ min: 0, max: 60 })),
    });
  }
  await db.auditLog.createMany({ data: audit });
}

// ─────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🚀  Seeding ACT ERP demo data…\n");
  const t0 = Date.now();

  await wipeAll();
  const ctx = await seedOrg();
  const employees = await seedEmployees(ctx);
  await seedTimeEntries(employees);
  await seedSchedules(employees);
  await seedLeave(employees);
  await seedReimbursements(employees);
  await seedRequests(employees);
  await seedNotifications(employees);
  await seedPayrollAndAudit(employees);

  const elapsedSec = Math.round((Date.now() - t0) / 1000);
  console.log(`\n✅  Done in ${elapsedSec}s. Credentials:\n`);

  // Print credentials table.
  const creds = employees
    .filter((e) => e.password)
    .sort((a, b) => a.email.localeCompare(b.email));
  const widthEmail = Math.max(...creds.map((c) => c.email.length));
  const widthName = Math.max(...creds.map((c) => c.name.length));
  console.log(`  ${"Email".padEnd(widthEmail)}   ${"Name".padEnd(widthName)}   Password`);
  console.log(`  ${"-".repeat(widthEmail)}   ${"-".repeat(widthName)}   ---------------`);
  for (const c of creds) {
    console.log(`  ${c.email.padEnd(widthEmail)}   ${c.name.padEnd(widthName)}   ${c.password}`);
  }
  console.log(`\n→ open http://localhost:3000  ·  primary admin: marcus.holloway@actools.com / Holloway$2026\n`);
}

main()
  .catch((e) => {
    console.error("\n❌  Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
