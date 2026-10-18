/**
 * Seeds the E2E database with fixed test users and data. Run via
 * `pnpm e2e:db` (applies the schema, then this). Idempotent: wipes every
 * table first, so it REFUSES to run unless the database name contains "e2e".
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { businessDateOnly } from "../src/lib/format";
import {
  AGENCY,
  CONTRACT_WORKER,
  CONTRACT_WORKER_APPROVE,
  CONTRACT_WORKER_REJECT,
  EMPLOYEE,
  INACTIVE_EMPLOYEE,
  INACTIVE_JOB_CODE,
  JOB_CODE,
  KIOSK_ACTIVE_SLUG,
  KIOSK_CREW_SLUG,
  KIOSK_NEW_SLUG,
  PAYROLL_BLOCKED_TITLE,
  PAYROLL_PERIOD_TITLE,
  PIN_EMPLOYEE,
  env,
} from "./support/test-data";

const url = env("DATABASE_URL");
const dbName = new URL(url).pathname.replace(/^\//, "");
if (!dbName.includes("e2e")) {
  console.error(`Refusing to seed "${dbName}": the database name must contain "e2e".`);
  process.exit(1);
}

const db = new PrismaClient();
const hash = (v: string) => bcrypt.hash(v, 4); // low cost: test data only
const DAY = 24 * 60 * 60 * 1000;

function daysAgo(n: number) {
  return businessDateOnly(new Date(Date.now() - n * DAY));
}
/** An instant on a business date (hour is UTC-based and approximate; fine for tests). */
function at(date: Date, hourUtc: number, minute = 0) {
  return new Date(date.getTime() + hourUtc * 3600_000 + minute * 60_000);
}

async function wipe() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '\_prisma%'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

async function makeEmployee(opts: {
  employeeId: string;
  name: string;
  email: string;
  password: string;
  status?: "ACTIVE" | "TERMINATED";
  terminationDate?: Date;
  pin?: string | null;
}) {
  const user = await db.user.create({
    data: {
      email: opts.email,
      name: opts.name,
      role: "EMPLOYEE",
      passwordHash: await hash(opts.password),
    },
  });
  return db.employee.create({
    data: {
      employeeId: opts.employeeId,
      userId: user.id,
      name: opts.name,
      email: opts.email,
      gender: "OTHER",
      employmentType: "FULL_PART_TIME",
      compensationType: "HOURLY_RATE",
      compensationValue: 25,
      jobTitle: "Fabricator",
      dateOfHire: daysAgo(400),
      employmentStatus: opts.status ?? "ACTIVE",
      terminationDate: opts.terminationDate ?? null,
      kioskPinHash: opts.pin === null ? null : await hash(opts.pin ?? env("E2E_EMPLOYEE_PIN")),
    },
  });
}

export type SeedContext = {
  db: PrismaClient;
  hash: (v: string) => Promise<string>;
  daysAgo: (n: number) => Date;
  at: (date: Date, hourUtc: number, minute?: number) => Date;
  makeEmployee: typeof makeEmployee;
  admin: { id: string; email: string | null };
  erin: { id: string };
  pia: { id: string };
  agency: { id: string };
};

async function main() {
  await wipe();

  // Admin (no Employee record, like a bootstrap admin).
  const admin = await db.user.create({
    data: {
      email: env("E2E_ADMIN_EMAIL"),
      name: "Alex Admin",
      role: "ADMIN",
      passwordHash: await hash(env("E2E_ADMIN_PASSWORD")),
    },
  });

  const erin = await makeEmployee({
    ...EMPLOYEE,
    email: env("E2E_EMPLOYEE_EMAIL"),
    password: env("E2E_EMPLOYEE_PASSWORD"),
  });
  await makeEmployee({
    ...INACTIVE_EMPLOYEE,
    email: env("E2E_INACTIVE_EMAIL"),
    password: env("E2E_INACTIVE_PASSWORD"),
    status: "TERMINATED",
    terminationDate: daysAgo(200), // past the 60-day read-only grace: no access
  });
  const pia = await makeEmployee({
    ...PIN_EMPLOYEE,
    email: "pia@e2e.test",
    password: "E2e-Pia-Pass-1!",
    pin: null,
  });

  // Job codes: one real, one retired. "ACT001" deliberately does NOT exist.
  await db.jobCode.create({
    data: { ...JOB_CODE, rate: "NA", isActive: true, isDefault: true },
  });
  await db.jobCode.create({
    data: { ...INACTIVE_JOB_CODE, rate: "NA", isActive: false },
  });

  // Kiosks: one already bound to the test device cookie, one waiting for activation.
  const expiresAt = new Date(Date.now() + 90 * DAY);
  await db.kioskSession.create({
    data: {
      slug: KIOSK_ACTIVE_SLUG,
      label: "E2E Kiosk",
      requirePin: true, // PIN tests use this kiosk; the no-PIN flow has its own kiosk
      provisionedBy: admin.id,
      expiresAt,
      cookieHash: createHash("sha256").update(env("E2E_KIOSK_COOKIE")).digest("hex"),
    },
  });
  await db.kioskSession.create({
    data: {
      slug: KIOSK_CREW_SLUG,
      label: "E2E Crew Kiosk",
      provisionedBy: admin.id,
      expiresAt,
      cookieHash: createHash("sha256")
        .update(`${env("E2E_KIOSK_COOKIE")}-crew`)
        .digest("hex"),
    },
  });
  await db.kioskSession.create({
    data: { slug: KIOSK_NEW_SLUG, label: "E2E New Kiosk", provisionedBy: admin.id, expiresAt },
  });

  // Staffing agency + contract workers.
  const agency = await db.staffingAgency.create({ data: { name: AGENCY.name } });
  const worker = (w: { workerId: string; name: string }) =>
    db.contractWorker.create({
      data: {
        ...w,
        agencyId: agency.id,
        jobCode: JOB_CODE.code,
        project: "E2E Project",
        startDate: daysAgo(30),
        createdById: admin.id,
      },
    });
  await worker(CONTRACT_WORKER);
  const cwApprove = await worker(CONTRACT_WORKER_APPROVE);
  const cwReject = await worker(CONTRACT_WORKER_REJECT);

  // Two finished, still-pending contract shifts (yesterday) for approve/reject.
  const yesterday = daysAgo(1);
  for (const w of [cwApprove, cwReject]) {
    await db.contractTimeEntry.create({
      data: {
        contractWorkerId: w.id,
        date: yesterday,
        clockIn: at(yesterday, 14),
        clockOut: at(yesterday, 22),
        totalWorkMin: 480,
        status: "COMPLETED",
        jobCode: JOB_CODE.code,
        approvalStatus: "PENDING",
      },
    });
  }

  // A finished, pending employee shift (yesterday) for the manual-edit test.
  await db.timeEntry.create({
    data: {
      employeeId: erin.id,
      date: yesterday,
      clockIn: at(yesterday, 14),
      clockOut: at(yesterday, 22),
      totalWorkMin: 480,
      status: "COMPLETED",
      jobCode: JOB_CODE.code,
      source: "MANUAL",
      approvalStatus: "PENDING",
    },
  });

  // Old, approved shifts inside a closed pay period (everyone has hours, so payroll is
  // "ready"), for the payroll CSV test.
  for (const emp of [erin, pia])
  await db.timeEntry.create({
    data: {
      employeeId: emp.id,
      date: daysAgo(55),
      clockIn: at(daysAgo(55), 14),
      clockOut: at(daysAgo(55), 22),
      totalWorkMin: 480,
      status: "APPROVED",
      jobCode: JOB_CODE.code,
      source: "MANUAL",
      approvalStatus: "APPROVED",
      approvalDate: new Date(),
    },
  });
  await db.payrollCalendar.create({
    data: {
      title: PAYROLL_PERIOD_TITLE,
      payPeriodStart: daysAgo(60),
      payPeriodEnd: daysAgo(46),
      payDate: daysAgo(44),
      status: "COMPLETED",
      createdById: admin.id,
    },
  });

  // A closed period with nobody's hours: payroll readiness is blocking, so export needs an override.
  await db.payrollCalendar.create({
    data: {
      title: PAYROLL_BLOCKED_TITLE,
      payPeriodStart: daysAgo(90),
      payPeriodEnd: daysAgo(76),
      payDate: daysAgo(74),
      status: "COMPLETED",
      createdById: admin.id,
    },
  });

  // Area-specific extra data: every e2e/seed-parts/*.ts (sorted) default-exports
  // `async (ctx: SeedContext) => void`. Keeps each spec area's data in its own file.
  const ctx: SeedContext = { db, hash, daysAgo, at, makeEmployee, admin, erin, pia, agency };
  const partsDir = path.resolve(__dirname, "seed-parts");
  if (existsSync(partsDir)) {
    for (const f of readdirSync(partsDir).filter((n) => n.endsWith(".ts")).sort()) {
      const mod = await import(pathToFileURL(path.join(partsDir, f)).href);
      await mod.default(ctx);
    }
  }

  // Payroll "ready to export" needs every ACTIVE employee to have approved hours in
  // the E2E Pay Period (payroll-csv.spec.ts). Seed parts add people freely; this
  // gives anyone still without hours one approved shift so no part has to care.
  const period = await db.payrollCalendar.findFirstOrThrow({ where: { title: PAYROLL_PERIOD_TITLE } });
  const needHours = await db.employee.findMany({
    where: {
      employmentStatus: "ACTIVE",
      timeEntries: {
        none: {
          approvalStatus: "APPROVED",
          date: { gte: period.payPeriodStart, lte: period.payPeriodEnd },
        },
      },
    },
    select: { id: true },
  });
  for (const emp of needHours) {
    await db.timeEntry.create({
      data: {
        employeeId: emp.id,
        date: daysAgo(55),
        clockIn: at(daysAgo(55), 14),
        clockOut: at(daysAgo(55), 22),
        totalWorkMin: 480,
        status: "APPROVED",
        jobCode: JOB_CODE.code,
        source: "MANUAL",
        approvalStatus: "APPROVED",
        approvalDate: new Date(),
      },
    });
  }

  console.log(`E2E seed done in "${dbName}".`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
