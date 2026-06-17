/**
 * Fills out Marcus Holloway's personal data: requests, reimbursements,
 * leave, payroll docs, personal documents.  Run after seed-recent.
 *
 *   pnpm tsx --env-file=.env.local scripts/seed-marcus.ts
 *
 * Idempotent-ish: skips inserts if the same title already exists.
 */
import "dotenv/config";
import {
  PrismaClient,
  Prisma,
  type RequestStatus,
  type RequestType,
  type ReimbursementCategory,
  type ReimbursementStatus,
  type LeaveType,
  type LeaveStatus,
  type DocumentType,
} from "@prisma/client";

const db = new PrismaClient();
const NOW = new Date();
const addDays = (d: Date, n: number) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};

async function main() {
  const m = await db.employee.findFirst({
    where: { name: "Marcus Holloway" },
    select: { id: true, userId: true, defaultHourlyRate: true },
  });
  if (!m) throw new Error("Marcus not found");

  // ── REQUESTS ─────────────────────────────────────────────────────
  const requests: Array<{
    type: RequestType;
    title: string;
    description: string;
    status: RequestStatus;
    daysAgo: number;
  }> = [
    {
      type: "EQUIPMENT_REQUEST",
      title: "Standing desk for VP office",
      description:
        "Current setup is wreaking havoc on my back. Need a sit/stand desk for the corner office.",
      status: "COMPLETED",
      daysAgo: 32,
    },
    {
      type: "TRAINING_REQUEST",
      title: "API 6A spec refresher · Houston",
      description:
        "Three-day course in Houston covering API 6A updates. Directly applicable to QA program oversight.",
      status: "PROCESSING",
      daysAgo: 12,
    },
    {
      type: "ACCESS_REQUEST",
      title: "Supabase prod read-access for analytics",
      description:
        "Need read-only Postgres access to pull KPI dashboards into our weekly ops review.",
      status: "PENDING",
      daysAgo: 4,
    },
    {
      type: "TEAM_REQUEST",
      title: "Add a second QA inspector headcount for Q3",
      description:
        "Inspection backlog is hurting on-time shipments. Looking to open a req for one more inspector reporting to Lambert.",
      status: "PENDING",
      daysAgo: 2,
    },
    {
      type: "DOCUMENT_REQUEST",
      title: "Updated org chart for board packet",
      description:
        "Need the current org chart exported to PDF for next week's board meeting.",
      status: "COMPLETED",
      daysAgo: 18,
    },
  ];

  let reqCreated = 0;
  for (const r of requests) {
    const exists = await db.request.findFirst({
      where: { employeeId: m.id, title: r.title },
      select: { id: true },
    });
    if (exists) continue;
    const createdAt = addDays(NOW, -r.daysAgo);
    await db.request.create({
      data: {
        employeeId: m.id,
        type: r.type,
        title: r.title,
        description: r.description,
        status: r.status,
        createdAt,
        history: {
          create: [
            { status: "PENDING", note: "Submitted.", updatedAt: createdAt },
            ...(r.status !== "PENDING"
              ? [
                  {
                    status: r.status,
                    note:
                      r.status === "COMPLETED"
                        ? "Approved and actioned."
                        : "In progress.",
                    updatedAt: addDays(createdAt, 2),
                  },
                ]
              : []),
          ],
        },
      },
    });
    reqCreated++;
  }
  console.log(`Requests: +${reqCreated}`);

  // ── REIMBURSEMENTS ───────────────────────────────────────────────
  const reimbursements: Array<{
    title: string;
    category: ReimbursementCategory;
    amount: number;
    description: string;
    status: ReimbursementStatus;
    daysAgo: number;
    expenseDaysAgo: number;
  }> = [
    {
      title: "Customer visit – Permian Basin",
      category: "TRAVEL",
      amount: 1245.6,
      description:
        "Two-day customer visit covering three completion job sites. Hotel + flights + rental.",
      status: "PAID",
      daysAgo: 45,
      expenseDaysAgo: 50,
    },
    {
      title: "OTC 2026 conference registration",
      category: "TRAINING",
      amount: 895.0,
      description:
        "Offshore Technology Conference — full pass for keynotes and supplier track.",
      status: "APPROVED",
      daysAgo: 22,
      expenseDaysAgo: 28,
    },
    {
      title: "Dinner – key account close",
      category: "MEALS",
      amount: 312.45,
      description: "Closing dinner with Chevron procurement team in Midland.",
      status: "PAID",
      daysAgo: 38,
      expenseDaysAgo: 41,
    },
    {
      title: "Sample shipping – christmas tree drawings",
      category: "OFFICE_SUPPLIES",
      amount: 64.2,
      description: "Overnight FedEx of signed drawings to customer engineering.",
      status: "UNDER_REVIEW",
      daysAgo: 6,
      expenseDaysAgo: 8,
    },
    {
      title: "Replacement laptop battery",
      category: "EQUIPMENT",
      amount: 189.0,
      description:
        "Battery on the work MacBook died at 18 months. Replaced via authorized service.",
      status: "PENDING",
      daysAgo: 2,
      expenseDaysAgo: 4,
    },
    {
      title: "Hotel – ACT board retreat",
      category: "ACCOMMODATION",
      amount: 412.0,
      description: "Two nights, Sundance Square. Board retreat April session.",
      status: "PAID",
      daysAgo: 55,
      expenseDaysAgo: 60,
    },
  ];

  let reimC = 0;
  for (const r of reimbursements) {
    const exists = await db.reimbursement.findFirst({
      where: { employeeId: m.id, title: r.title },
      select: { id: true },
    });
    if (exists) continue;
    const createdAt = addDays(NOW, -r.daysAgo);
    const isPaid = r.status === "PAID";
    const isApprovedOrPaid = isPaid || r.status === "APPROVED";
    await db.reimbursement.create({
      data: {
        employeeId: m.id,
        title: r.title,
        category: r.category,
        amount: new Prisma.Decimal(r.amount),
        description: r.description,
        expenseDate: addDays(NOW, -r.expenseDaysAgo),
        status: r.status,
        priority: "MEDIUM",
        createdAt,
        reviewerId: isApprovedOrPaid ? m.id : null,
        reviewedAt: isApprovedOrPaid ? addDays(createdAt, 2) : null,
        approvalDate: isApprovedOrPaid ? addDays(createdAt, 2) : null,
        paidDate: isPaid ? addDays(createdAt, 7) : null,
        paidAmount: isPaid ? new Prisma.Decimal(r.amount) : null,
      },
    });
    reimC++;
  }
  console.log(`Reimbursements: +${reimC}`);

  // ── LEAVE REQUESTS ───────────────────────────────────────────────
  const leaves: Array<{
    leaveType: LeaveType;
    description: string;
    status: LeaveStatus;
    startDaysFromNow: number;
    days: number;
  }> = [
    {
      leaveType: "VACATION",
      description: "Family trip to Colorado — long-planned.",
      status: "APPROVED",
      startDaysFromNow: 28,
      days: 5,
    },
    {
      leaveType: "PERSONAL",
      description: "Annual physical and follow-ups.",
      status: "APPROVED",
      startDaysFromNow: -35,
      days: 1,
    },
    {
      leaveType: "SICK",
      description: "Flu — kept me out two days.",
      status: "APPROVED",
      startDaysFromNow: -60,
      days: 2,
    },
  ];

  let leaveC = 0;
  for (const l of leaves) {
    const start = addDays(NOW, l.startDaysFromNow);
    const end = addDays(start, l.days - 1);
    const exists = await db.leaveRequest.findFirst({
      where: { employeeId: m.id, startDate: start, leaveType: l.leaveType },
      select: { id: true },
    });
    if (exists) continue;
    await db.leaveRequest.create({
      data: {
        employeeId: m.id,
        leaveType: l.leaveType,
        startDate: start,
        endDate: end,
        totalDays: l.days,
        noticeDays: l.startDaysFromNow > 0 ? l.startDaysFromNow : 0,
        description: l.description,
        status: l.status,
        reviewerId: m.id,
        reviewedAt:
          l.status !== "PENDING"
            ? addDays(start, l.startDaysFromNow > 0 ? -2 : 0)
            : null,
        createdAt:
          l.startDaysFromNow > 0
            ? addDays(start, -5)
            : addDays(start, -2),
      },
    });
    leaveC++;
  }
  console.log(`LeaveRequests: +${leaveC}`);

  // Recompute Marcus's leave summary so the page shows the right counters.
  const approved = await db.leaveRequest.aggregate({
    _sum: { totalDays: true },
    where: { employeeId: m.id, status: "APPROVED" },
  });
  const usedDays = approved._sum.totalDays ?? 0;
  await db.employee.update({
    where: { id: m.id },
    data: {
      leavesTaken: usedDays,
      leavesApproved: usedDays,
      leavesRemaining: Math.max(0, 20 - usedDays),
    },
  });

  // ── PAYROLL DOCS ─────────────────────────────────────────────────
  // Tie one PDF stub to each of the last 5 completed pay periods.
  const recentCalendars = await db.payrollCalendar.findMany({
    where: { status: "COMPLETED" },
    orderBy: { payPeriodEnd: "desc" },
    take: 5,
  });

  let payC = 0;
  for (const cal of recentCalendars) {
    const title = `Pay stub · ${cal.payPeriodStart.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    })} – ${cal.payPeriodEnd.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}`;
    const exists = await db.payroll.findFirst({
      where: {
        employeeId: m.id,
        payPeriodStart: cal.payPeriodStart,
        payPeriodEnd: cal.payPeriodEnd,
      },
      select: { id: true },
    });
    if (exists) continue;
    await db.payroll.create({
      data: {
        employeeId: m.id,
        title,
        description: "Bi-weekly pay stub",
        category: "Pay stub",
        fileName: `pay-stub-${cal.payPeriodEnd.toISOString().slice(0, 10)}.pdf`,
        fileType: "application/pdf",
        fileUrl: `https://example.supabase.co/storage/v1/object/public/payroll/marcus-${cal.payPeriodEnd
          .toISOString()
          .slice(0, 10)}.pdf`,
        payPeriodStart: cal.payPeriodStart,
        payPeriodEnd: cal.payPeriodEnd,
        uploadedById: m.userId,
        uploaderEmployeeId: m.id,
        uploadedAt: addDays(cal.payPeriodEnd, 3),
      },
    });
    payC++;
  }
  console.log(`Payroll docs: +${payC}`);

  // ── PERSONAL DOCUMENTS ───────────────────────────────────────────
  const documents: Array<{
    title: string;
    documentType: DocumentType;
    fileName: string;
    daysAgo: number;
  }> = [
    {
      title: "Signed employment agreement",
      documentType: "ONBOARDING",
      fileName: "marcus-holloway-employment-agreement.pdf",
      daysAgo: 1200,
    },
    {
      title: "W-4 (2026)",
      documentType: "ONBOARDING",
      fileName: "w4-2026.pdf",
      daysAgo: 140,
    },
    {
      title: "Direct deposit authorization",
      documentType: "PERSONAL",
      fileName: "direct-deposit.pdf",
      daysAgo: 1180,
    },
    {
      title: "Medical plan election (Q1 2026)",
      documentType: "BENEFITS",
      fileName: "medical-enrollment-2026.pdf",
      daysAgo: 160,
    },
    {
      title: "401(k) deferral change form",
      documentType: "BENEFITS",
      fileName: "401k-deferral-change.pdf",
      daysAgo: 75,
    },
    {
      title: "OSHA 30 completion certificate",
      documentType: "TRAINING",
      fileName: "osha-30-cert.pdf",
      daysAgo: 220,
    },
  ];

  let docC = 0;
  for (const d of documents) {
    const exists = await db.document.findFirst({
      where: { employeeId: m.id, title: d.title },
      select: { id: true },
    });
    if (exists) continue;
    await db.document.create({
      data: {
        employeeId: m.id,
        title: d.title,
        description: null,
        fileName: d.fileName,
        fileType: "application/pdf",
        fileUrl: `https://example.supabase.co/storage/v1/object/public/documents/marcus/${d.fileName}`,
        documentType: d.documentType,
        uploadedById: m.userId,
        uploaderEmployeeId: m.id,
        uploadedAt: addDays(NOW, -d.daysAgo),
      },
    });
    docC++;
  }
  console.log(`Documents: +${docC}`);

  // ── SCHEDULED WORK (extra for Marcus, next 10 weekdays) ──────────
  let swC = 0;
  for (let i = 1; i <= 14; i++) {
    const day = addDays(NOW, i);
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    const exists = await db.scheduledWork.findFirst({
      where: {
        employeeId: m.id,
        date: new Date(day.getFullYear(), day.getMonth(), day.getDate()),
      },
      select: { id: true },
    });
    if (exists) continue;
    const startTime = new Date(day);
    startTime.setHours(8, 0, 0, 0);
    const endTime = new Date(day);
    endTime.setHours(17, 0, 0, 0);
    await db.scheduledWork.create({
      data: {
        employeeId: m.id,
        date: new Date(day.getFullYear(), day.getMonth(), day.getDate()),
        startTime,
        endTime,
        status: "SCHEDULED",
        jobCode: "AUTO001",
        rate: new Prisma.Decimal(m.defaultHourlyRate),
        totalBreakMin: 60,
        netWorkHours: 8,
      },
    });
    swC++;
  }
  console.log(`ScheduledWork: +${swC}`);

  console.log("✓ Marcus seeded");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
