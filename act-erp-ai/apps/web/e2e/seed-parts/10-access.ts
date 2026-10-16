/**
 * Seed data for the access-control + smoke specs (access-*.spec.ts, smoke.spec.ts).
 * Every user here is dedicated to this area, so no other spec shares their
 * sessions or login rate limits. Every ACTIVE employee gets one approved shift
 * inside the closed "E2E Pay Period" so payroll readiness stays "ready" for the
 * payroll CSV spec (readiness only blocks on ACTIVE employees without hours).
 */
import type { SeedContext } from "../seed";
import { ACC_IDS, ACC_KEYS, ACC_PASSWORD, ACC_USERS } from "../support/access";

export default async function (ctx: SeedContext) {
  const { db, daysAgo, at, makeEmployee, admin } = ctx;

  const emp = async (
    key: keyof typeof ACC_USERS,
    opts: { status?: "ACTIVE" | "TERMINATED"; terminationDays?: number } = {},
  ) => {
    const u = ACC_USERS[key];
    if (!("employeeId" in u)) throw new Error(`${key} has no employee record`);
    const e = await makeEmployee({
      employeeId: u.employeeId,
      name: u.name,
      email: u.email,
      password: ACC_PASSWORD,
      status: opts.status,
      terminationDate: opts.terminationDays ? daysAgo(opts.terminationDays) : undefined,
    });
    if ((opts.status ?? "ACTIVE") === "ACTIVE") {
      await db.timeEntry.create({
        data: {
          employeeId: e.id,
          date: daysAgo(55),
          clockIn: at(daysAgo(55), 14),
          clockOut: at(daysAgo(55), 22),
          totalWorkMin: 480,
          status: "APPROVED",
          jobCode: "E2E100",
          source: "MANUAL",
          approvalStatus: "APPROVED",
          approvalDate: new Date(),
        },
      });
    }
    return e;
  };

  const grace = await emp("grace", { status: "TERMINATED", terminationDays: 10 });
  const other = await emp("other");
  await emp("ended", {});
  await emp("dying");
  await emp("tokenVer");
  await emp("promo");
  await emp("logout");
  await emp("flip");
  await emp("mustGate");
  await emp("mustOk");
  await emp("settingsPw");
  const pending = await emp("pending", {});
  await db.employee.update({ where: { id: pending.id }, data: { employmentStatus: "PENDING_REVIEW" } });
  // "ended": terminated long ago but the account still holds a (soon dead) session in specs.
  // Seeded ACTIVE here; access-routes.spec.ts terminates it after logging in.

  // Admin linked to an employee record that ended long ago: no sign-in at all.
  const endedAdminEmp = await makeEmployee({
    employeeId: ACC_USERS.endedAdmin.employeeId,
    name: ACC_USERS.endedAdmin.name,
    email: ACC_USERS.endedAdmin.email,
    password: ACC_PASSWORD,
    status: "TERMINATED",
    terminationDate: daysAgo(200),
  });
  await db.user.update({ where: { id: endedAdminEmp.userId! }, data: { role: "ADMIN" } });

  // Forced password change users.
  for (const k of ["mustGate", "mustOk"] as const) {
    await db.user.update({
      where: { email: ACC_USERS[k].email },
      data: { mustChangePassword: true },
    });
  }
  // Admin with no employee record who must change a temporary password.
  await db.user.create({
    data: {
      email: ACC_USERS.mustAdmin.email,
      name: ACC_USERS.mustAdmin.name,
      role: "ADMIN",
      passwordHash: await ctx.hash(ACC_PASSWORD),
      mustChangePassword: true,
    },
  });

  // ── Files owned by Erin (base user), Olive (someone else) and Gina (grace window) ──
  const erin = ctx.erin;
  const pay = (id: string, employeeId: string, key: string, title: string) =>
    db.payroll.create({
      data: {
        id,
        employeeId,
        title,
        fileName: key.replace("payroll/", ""),
        fileType: "pdf",
        fileUrl: "",
        payPeriodStart: daysAgo(100),
        payPeriodEnd: daysAgo(90),
      },
    });
  await pay(ACC_IDS.payErin, erin.id, ACC_KEYS.payErin, "ACC Erin stub");
  await pay(ACC_IDS.payOther, other.id, ACC_KEYS.payOther, "ACC Olive stub");
  await pay(ACC_IDS.payGrace, grace.id, ACC_KEYS.payGrace, "ACC Gina stub");

  const docRow = (id: string, employeeId: string, key: string, title: string) =>
    db.document.create({
      data: {
        id,
        title,
        fileName: key.replace("documents/", ""),
        fileType: "pdf",
        fileUrl: "",
        documentType: "PERSONAL",
        employeeId,
      },
    });
  await docRow(ACC_IDS.docErin, erin.id, ACC_KEYS.docErin, "ACC Erin doc");
  await docRow(ACC_IDS.docOther, other.id, ACC_KEYS.docOther, "ACC Olive doc");
  await docRow(ACC_IDS.docGrace, grace.id, ACC_KEYS.docGrace, "ACC Gina doc");

  const reim = async (id: string, rcptId: string, employeeId: string, key: string, title: string) => {
    await db.reimbursement.create({
      data: {
        id,
        employeeId,
        title,
        category: "TRAVEL",
        amount: 12.5,
        description: "Access test receipt",
        expenseDate: daysAgo(100),
        status: "PENDING",
      },
    });
    await db.reimbursementReceipt.create({
      data: {
        id: rcptId,
        reimbursementId: id,
        fileName: key.replace("reimbursement-receipts/", ""),
        originalName: `${title}.pdf`,
        fileUrl: "",
        fileSize: 40,
        mimeType: "application/pdf",
      },
    });
  };
  await reim(ACC_IDS.reimErin, ACC_IDS.rcptErin, erin.id, ACC_KEYS.rcptErin, "ACC Erin receipt");
  await reim(ACC_IDS.reimOther, ACC_IDS.rcptOther, other.id, ACC_KEYS.rcptOther, "ACC Olive receipt");

  // Old, approved punches (outside every payroll window) with and without photos.
  const oldDay = daysAgo(120);
  const punch = (id: string, photoKey: string | null) =>
    db.timeEntry.create({
      data: {
        id,
        employeeId: other.id,
        date: oldDay,
        clockIn: at(oldDay, 14),
        clockOut: at(oldDay, 22),
        totalWorkMin: 480,
        status: "APPROVED",
        jobCode: "E2E100",
        source: "KIOSK",
        approvalStatus: "APPROVED",
        approvalDate: new Date(),
        clockInPhotoKey: photoKey,
      },
    });
  await punch(ACC_IDS.entryPhoto, ACC_KEYS.punchIn);
  await punch(ACC_IDS.entryNoPhoto, null);

  // An ended contract worker (so kiosk crew lists are untouched) with a photo punch.
  const cw = await db.contractWorker.create({
    data: {
      workerId: "CW-ACC1",
      name: "Acc Contract",
      agencyId: ctx.agency.id,
      jobCode: "E2E100",
      project: "E2E Project",
      startDate: daysAgo(200),
      endDate: daysAgo(100),
      status: "ENDED",
      createdById: admin.id,
    },
  });
  await db.contractTimeEntry.create({
    data: {
      id: ACC_IDS.contractEntryPhoto,
      contractWorkerId: cw.id,
      date: oldDay,
      clockIn: at(oldDay, 14),
      clockOut: at(oldDay, 22),
      totalWorkMin: 480,
      status: "APPROVED",
      jobCode: "E2E100",
      approvalStatus: "APPROVED",
      clockInPhotoKey: ACC_KEYS.contractPunchIn,
    },
  });

  // Rows that id-based admin pages need.
  await db.department.create({ data: { id: ACC_IDS.dept, name: "ACC Department", code: "ACC" } });
  await db.hirePacketImport.create({
    data: {
      id: ACC_IDS.hireImport,
      employeeId: erin.id,
      uploadedById: admin.id,
      status: "FAILED",
      zipFileName: "acc-hire.zip",
      zipStorageKey: "documents/hire-packets/acc-hire.zip",
      errorMessage: "Seeded failure for the access smoke test",
    },
  });
  await db.onboardingInvite.create({
    data: {
      token: ACC_IDS.inviteToken,
      status: "PENDING",
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      createdById: admin.id,
    },
  });
  await db.onboardingInvite.create({
    data: {
      token: ACC_IDS.inviteExpiredToken,
      status: "EXPIRED",
      expiresAt: daysAgo(5),
      createdById: admin.id,
    },
  });
}
