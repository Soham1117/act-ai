/**
 * Read helpers for the admin contract-worker pages. Server-only: these query
 * the DB directly with no auth check, so call them from admin pages / actions
 * that have already run `requireAdmin()`.
 *
 * Date arguments (`from`, `to`) are date-only values (UTC midnight of the
 * business day, same as `@db.Date`), both inclusive. Use `parseDateOnly` from
 * `@/lib/time-rules` to build them from `YYYY-MM-DD`.
 */
import type { ApprovalStatus, ContractWorkerStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { businessDateOnly, formatBusinessTime } from "@/lib/format";
import { isEndingSoon } from "@/lib/contract-workers";
import { csvRow } from "@/lib/payroll-overtime";
import { dateOnlyToString, isStaleShift } from "@/lib/time-rules";

export type ContractLiveStatus = "ACTIVE" | "ON_BREAK" | "OUT";

export async function listAgencies() {
  return db.staffingAgency.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: {
      _count: { select: { workers: true } },
    },
  });
}

export type ContractWorkerListItem = Awaited<ReturnType<typeof listContractWorkers>>[number];

/**
 * Contract workers with agency name, live clock status (`liveStatus`, "OUT"
 * when not clocked in or the open entry is stale) and `endingSoon` (end date
 * within 7 business days).
 */
export async function listContractWorkers(
  filter: { agencyId?: string; status?: ContractWorkerStatus; search?: string } = {},
) {
  const search = filter.search?.trim();
  const where: Prisma.ContractWorkerWhereInput = {
    ...(filter.agencyId ? { agencyId: filter.agencyId } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { workerId: { contains: search, mode: "insensitive" } },
            { project: { contains: search, mode: "insensitive" } },
            { agency: { name: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const rows = await db.contractWorker.findMany({
    where,
    orderBy: [{ status: "asc" }, { name: "asc" }],
    include: {
      agency: { select: { id: true, name: true } },
      timeEntries: {
        where: { status: { in: ["ACTIVE", "ON_BREAK"] } },
        take: 1,
        orderBy: { clockIn: "desc" },
        select: { id: true, status: true, clockIn: true },
      },
    },
  });
  const today = businessDateOnly();
  return rows.map(({ timeEntries, ...w }) => {
    const open = timeEntries[0];
    const live = open && !isStaleShift(open.clockIn) ? open : undefined;
    return {
      ...w,
      agencyName: w.agency.name,
      liveStatus: (live?.status ?? "OUT") as ContractLiveStatus,
      openEntryId: live?.id ?? null,
      clockedInAt: live?.clockIn ?? null,
      endingSoon: w.status === "ACTIVE" && isEndingSoon(w.endDate, today, 7),
    };
  });
}

/** One worker with agency and their most recent entries (newest first, with breaks). */
export async function getContractWorker(id: string, recentLimit = 30) {
  return db.contractWorker.findUnique({
    where: { id },
    include: {
      agency: true,
      timeEntries: {
        orderBy: { clockIn: "desc" },
        take: recentLimit,
        include: { breaks: { orderBy: { startTime: "asc" } } },
      },
    },
  });
}

export type ContractTimeEntryRow = Awaited<ReturnType<typeof listContractTimeEntries>>[number];

/** Entries whose business `date` is within [from, to], with breaks, worker and agency. */
export async function listContractTimeEntries(args: {
  from: Date;
  to: Date;
  agencyId?: string;
  approvalStatus?: ApprovalStatus;
}) {
  return db.contractTimeEntry.findMany({
    where: {
      date: { gte: args.from, lte: args.to },
      ...(args.approvalStatus ? { approvalStatus: args.approvalStatus } : {}),
      ...(args.agencyId ? { contractWorker: { agencyId: args.agencyId } } : {}),
    },
    orderBy: [{ date: "desc" }, { clockIn: "desc" }],
    include: {
      breaks: { orderBy: { startTime: "asc" } },
      contractWorker: {
        select: {
          id: true,
          workerId: true,
          name: true,
          project: true,
          agencyId: true,
          agency: { select: { id: true, name: true } },
        },
      },
    },
  });
}

/**
 * Open entries (ACTIVE / ON_BREAK). Each has `stale: true` when the shift has
 * run past the max shift length: it is not counted as on site, but an admin
 * must still be able to close it.
 */
export async function onSiteNow() {
  const open = await db.contractTimeEntry.findMany({
    where: { status: { in: ["ACTIVE", "ON_BREAK"] } },
    orderBy: { clockIn: "asc" },
    include: {
      contractWorker: {
        select: { id: true, workerId: true, name: true, project: true, agency: { select: { name: true } } },
      },
    },
  });
  const now = new Date();
  return open.map((e) => ({ ...e, stale: isStaleShift(e.clockIn, now) }));
}

/**
 * CSV (RFC 4180, formula-injection safe via the payroll `csvRow` helper): one
 * row per worker per business day. Columns: Agency, Worker ID, Name, Date,
 * Clock in, Clock out, Break min, Work hours (2 dp), Job code, Approval.
 * Several punches on one day are merged (first in, last out, summed minutes);
 * REJECTED entries add no hours. Times are America/Chicago.
 */
export async function contractHoursCsv(args: {
  from: Date;
  to: Date;
  agencyId?: string;
}): Promise<string> {
  const entries = await listContractTimeEntries(args);
  type Group = {
    agency: string;
    workerId: string;
    name: string;
    date: Date;
    first: Date;
    last: Date | null;
    breakMin: number;
    workMin: number;
    jobCodes: Set<string>;
    approvals: Set<string>;
  };
  const groups = new Map<string, Group>();
  for (const e of entries) {
    const key = `${e.contractWorkerId}|${dateOnlyToString(e.date)}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        agency: e.contractWorker.agency.name,
        workerId: e.contractWorker.workerId,
        name: e.contractWorker.name,
        date: e.date,
        first: e.clockIn,
        last: e.clockOut,
        breakMin: 0,
        workMin: 0,
        jobCodes: new Set(),
        approvals: new Set(),
      };
      groups.set(key, g);
    } else {
      if (e.clockIn < g.first) g.first = e.clockIn;
      if (g.last !== null && (e.clockOut === null || e.clockOut > g.last)) g.last = e.clockOut;
    }
    if (e.approvalStatus !== "REJECTED") {
      g.breakMin += e.totalBreakMin;
      g.workMin += e.totalWorkMin;
    }
    g.jobCodes.add(e.jobCode);
    g.approvals.add(e.approvalStatus);
  }

  const sorted = [...groups.values()].sort(
    (a, b) =>
      a.agency.localeCompare(b.agency) ||
      a.workerId.localeCompare(b.workerId) ||
      a.date.getTime() - b.date.getTime(),
  );
  const header = csvRow([
    "Agency",
    "Worker ID",
    "Name",
    "Date",
    "Clock in",
    "Clock out",
    "Break min",
    "Work hours",
    "Job code",
    "Approval",
  ]);
  const lines = sorted.map((g) =>
    csvRow([
      g.agency,
      g.workerId,
      g.name,
      dateOnlyToString(g.date),
      formatBusinessTime(g.first),
      g.last ? formatBusinessTime(g.last) : "",
      g.breakMin,
      (g.workMin / 60).toFixed(2),
      [...g.jobCodes].join(" / "),
      g.approvals.size === 1 ? [...g.approvals][0]! : "MIXED",
    ]),
  );
  return [header, ...lines].join("\r\n");
}
