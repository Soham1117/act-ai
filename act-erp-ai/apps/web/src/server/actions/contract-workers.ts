"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";
import { businessDateOnly, formatBusinessTime, formatDateOnly } from "@/lib/format";
import { nextContractWorkerIdFrom } from "@/lib/contract-workers";
import {
  BUSINESS_TZ,
  breakMinutes,
  businessLocalToDate,
  computeEntryTotals,
  parseDateOnly,
  validateEntryTimes,
} from "@/lib/time-rules";
import {
  closeOpenContractEntry,
  revalidateContractPages,
  withContractWorkerLock,
  type ContractEntryWithBreaks,
  type Tx,
} from "@/server/contract-time-core";

// All actions here require an admin (`requireAdmin`, same guard as
// time-admin.ts). Approvals are stored against the admin USER id/name, never
// an Employee row.

const OPEN: readonly string[] = ["ACTIVE", "ON_BREAK"];
const isOpen = (e: { status: string }) => OPEN.includes(e.status);

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

const dateString = z.string().trim().min(1, "Enter a date.");

function parseDate(value: string, label: string): { date: Date } | { error: string } {
  const d = parseDateOnly(value);
  if (!d) return { error: `${label} isn't a valid date. Use the date picker (YYYY-MM-DD).` };
  return { date: d };
}

const reasonSchema = z
  .string()
  .trim()
  .min(3, "Enter a reason (at least 3 characters). It is recorded in the audit log.")
  .max(500, "Keep the reason under 500 characters.");

function revalidateAll() {
  revalidateContractPages();
  revalidatePath("/admin");
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

async function assertJobCode(code: string | null): Promise<string | null> {
  if (!code) return null;
  const jc = await db.jobCode.findUnique({ where: { code } });
  if (!jc) return `Job code ${code} doesn't exist.`;
  if (!jc.isActive) return `Job code ${code} is inactive. Choose an active job code.`;
  return null;
}

// ──────────────────────────────────────────────────────────────────────
// Agencies
// ──────────────────────────────────────────────────────────────────────

const agencySchema = z.object({
  name: z.string().trim().min(1, "Enter the agency name.").max(120),
  contactName: optText(120),
  phone: optText(40),
  email: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || z.string().email().safeParse(v).success, "Enter a valid email."),
  notes: optText(2000),
});
export type AgencyInput = z.input<typeof agencySchema>;

/** Create a staffing agency. Names are unique (case-sensitive match). */
export async function createAgency(input: AgencyInput): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  try {
    const data = agencySchema.parse(input);
    const agency = await db.staffingAgency.create({ data });
    await audit({
      action: "contract.agency.create",
      resource: `StaffingAgency:${agency.id}`,
      diff: { ...data },
    });
    revalidateAll();
    return ok({ id: agency.id });
  } catch (err) {
    if (isUniqueViolation(err)) return fail("An agency with that name already exists.");
    return failFromUnknown(err);
  }
}

export async function updateAgency(
  id: string,
  input: AgencyInput,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  try {
    const data = agencySchema.parse(input);
    const before = await db.staffingAgency.findUnique({ where: { id } });
    if (!before) return fail("That agency no longer exists. Refresh the page.");
    await db.staffingAgency.update({ where: { id }, data });
    await audit({
      action: "contract.agency.update",
      resource: `StaffingAgency:${id}`,
      diff: {
        before: {
          name: before.name,
          contactName: before.contactName,
          phone: before.phone,
          email: before.email,
          notes: before.notes,
        },
        after: { ...data },
      },
    });
    revalidateAll();
    return ok({ id });
  } catch (err) {
    if (isUniqueViolation(err)) return fail("An agency with that name already exists.");
    return failFromUnknown(err);
  }
}

/** Deactivate (hide from new-worker pickers) or reactivate an agency. Workers are untouched. */
export async function setAgencyActive(id: string, isActive: boolean): Promise<ActionResult> {
  await requireAdmin();
  try {
    const agency = await db.staffingAgency.update({ where: { id }, data: { isActive } });
    await audit({
      action: isActive ? "contract.agency.activate" : "contract.agency.deactivate",
      resource: `StaffingAgency:${id}`,
      diff: { name: agency.name },
    });
    revalidateAll();
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Workers
// ──────────────────────────────────────────────────────────────────────

const workerSchema = z.object({
  name: z.string().trim().min(1, "Enter the worker's name.").max(120),
  phone: optText(40),
  agencyId: z.string().min(1, "Choose an agency."),
  /** JobCode.code */
  jobCode: z
    .string()
    .trim()
    .max(40)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
  project: optText(200),
  /** YYYY-MM-DD */
  startDate: dateString,
  /** YYYY-MM-DD, empty/null for open-ended. */
  endDate: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
  notes: optText(2000),
});
export type ContractWorkerInput = z.input<typeof workerSchema>;

function parseWorkerDates(data: z.output<typeof workerSchema>) {
  const start = parseDate(data.startDate, "Start date");
  if ("error" in start) return start;
  let end: Date | null = null;
  if (data.endDate) {
    const e = parseDate(data.endDate, "End date");
    if ("error" in e) return e;
    end = e.date;
  }
  if (end && end.getTime() < start.date.getTime()) {
    return { error: "The end date can't be before the start date." };
  }
  return { startDate: start.date, endDate: end };
}

async function checkWorkerRefs(data: z.output<typeof workerSchema>): Promise<string | null> {
  const agency = await db.staffingAgency.findUnique({ where: { id: data.agencyId } });
  if (!agency) return "That agency no longer exists. Refresh the page.";
  if (!agency.isActive) return "That agency is inactive. Reactivate it under Agencies, or pick another agency.";
  return assertJobCode(data.jobCode);
}

/** Create a contract worker with the next `CW-####` ID. */
export async function createContractWorker(
  input: ContractWorkerInput,
): Promise<ActionResult<{ id: string; workerId: string }>> {
  const admin = await requireAdmin();
  try {
    const data = workerSchema.parse(input);
    const dates = parseWorkerDates(data);
    if ("error" in dates) return fail(dates.error);
    const refErr = await checkWorkerRefs(data);
    if (refErr) return fail(refErr);

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const worker = await db.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('contract-worker-id-seq'))`;
          const rows = await tx.contractWorker.findMany({ select: { workerId: true } });
          const workerId = nextContractWorkerIdFrom(rows.map((r) => r.workerId));
          return tx.contractWorker.create({
            data: {
              workerId,
              name: data.name,
              phone: data.phone,
              agencyId: data.agencyId,
              jobCode: data.jobCode,
              project: data.project,
              startDate: dates.startDate,
              endDate: dates.endDate,
              notes: data.notes,
              createdById: admin.id,
            },
          });
        });
        await audit({
          action: "contract.worker.create",
          resource: `ContractWorker:${worker.id}`,
          diff: { workerId: worker.workerId, name: data.name, agencyId: data.agencyId },
        });
        revalidateAll();
        return ok({ id: worker.id, workerId: worker.workerId });
      } catch (err) {
        if (isUniqueViolation(err) && attempt < 4) continue;
        throw err;
      }
    }
    return fail("Could not allocate a worker ID. Try again.");
  } catch (err) {
    return failFromUnknown(err);
  }
}

export async function updateContractWorker(
  id: string,
  input: ContractWorkerInput,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  try {
    const data = workerSchema.parse(input);
    const dates = parseWorkerDates(data);
    if ("error" in dates) return fail(dates.error);
    const before = await db.contractWorker.findUnique({ where: { id } });
    if (!before) return fail("That worker no longer exists. Refresh the page.");
    // Only validate refs that changed, so old workers stay editable if an agency/job code was retired.
    if (data.agencyId !== before.agencyId) {
      const agency = await db.staffingAgency.findUnique({ where: { id: data.agencyId } });
      if (!agency) return fail("That agency no longer exists. Refresh the page.");
      if (!agency.isActive) return fail("That agency is inactive. Reactivate it under Agencies, or pick another agency.");
    }
    if (data.jobCode !== before.jobCode) {
      const jcErr = await assertJobCode(data.jobCode);
      if (jcErr) return fail(jcErr);
    }
    await db.contractWorker.update({
      where: { id },
      data: {
        name: data.name,
        phone: data.phone,
        agencyId: data.agencyId,
        jobCode: data.jobCode,
        project: data.project,
        startDate: dates.startDate,
        endDate: dates.endDate,
        notes: data.notes,
      },
    });
    await audit({
      action: "contract.worker.update",
      resource: `ContractWorker:${id}`,
      diff: {
        workerId: before.workerId,
        before: {
          name: before.name,
          agencyId: before.agencyId,
          jobCode: before.jobCode,
          project: before.project,
          startDate: before.startDate.toISOString().slice(0, 10),
          endDate: before.endDate?.toISOString().slice(0, 10) ?? null,
        },
        after: { ...data },
      },
    });
    revalidateAll();
    return ok({ id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

/**
 * End a contract now (or on `endDate`, `YYYY-MM-DD`, default today). Sets
 * status ENDED. If the worker is clocked in, the open entry is closed at the
 * current time and left pending approval.
 */
export async function endContractWorker(
  id: string,
  endDate?: string | null,
): Promise<ActionResult<{ id: string; closedOpenEntry: boolean }>> {
  const admin = await requireAdmin();
  try {
    let end = businessDateOnly();
    if (endDate) {
      const e = parseDate(endDate, "End date");
      if ("error" in e) return fail(e.error);
      end = e.date;
    }
    const result = await withContractWorkerLock(id, async (tx) => {
      const worker = await tx.contractWorker.findUnique({ where: { id } });
      if (!worker) return { error: "That worker no longer exists. Refresh the page." };
      if (end.getTime() < worker.startDate.getTime()) {
        return { error: "The end date can't be before the start date." };
      }
      const open = await tx.contractTimeEntry.findFirst({
        where: { contractWorkerId: id, status: { in: ["ACTIVE", "ON_BREAK"] } },
        orderBy: { clockIn: "desc" },
        include: { breaks: true },
      });
      let closedId: string | null = null;
      if (open) {
        await closeOpenContractEntry(tx, open, new Date(), {
          lastEditedById: admin.id,
          editReason: "Clocked out because the contract was ended by an admin.",
        });
        closedId = open.id;
      }
      await tx.contractWorker.update({
        where: { id },
        data: { status: "ENDED", endDate: end },
      });
      return { worker, closedId };
    });
    if ("error" in result) return fail(result.error!);

    await audit({
      action: "contract.worker.end",
      resource: `ContractWorker:${id}`,
      diff: {
        workerId: result.worker.workerId,
        endDate: end.toISOString().slice(0, 10),
        closedTimeEntryId: result.closedId,
      },
    });
    revalidateAll();
    return ok({ id, closedOpenEntry: !!result.closedId });
  } catch (err) {
    return failFromUnknown(err);
  }
}

/** Pause/resume a worker, retaining the assignment dates and all history. */
export async function setContractWorkerActive(
  id: string,
  isActive: boolean,
): Promise<ActionResult<{ id: string; closedOpenEntries: number }>> {
  const admin = await requireAdmin();
  try {
    const active = z.boolean().parse(isActive);
    const status = active ? "ACTIVE" : "INACTIVE";
    const result = await withContractWorkerLock(id, async (tx) => {
      const worker = await tx.contractWorker.findUnique({ where: { id } });
      if (!worker) return { error: "That worker no longer exists. Refresh the page." };
      if (worker.status === "ENDED") return { error: "Reactivate the ended assignment before changing active status." };
      if (worker.status === status) return { worker, changed: false, closedIds: [] };
      const open = active ? [] : await tx.contractTimeEntry.findMany({
        where: { contractWorkerId: id, status: { in: ["ACTIVE", "ON_BREAK"] } },
        include: { breaks: true },
      });
      const now = new Date();
      for (const entry of open) {
        await closeOpenContractEntry(tx, entry, now, {
          lastEditedById: admin.id,
          editReason: "Clocked out because the worker was made inactive by an admin.",
        });
      }
      await tx.contractWorker.update({ where: { id }, data: { status } });
      return { worker, changed: true, closedIds: open.map((entry) => entry.id) };
    });
    if ("error" in result) return fail(result.error!);
    if (result.changed) {
      await audit({
        action: active ? "contract.worker.activate" : "contract.worker.deactivate",
        resource: `ContractWorker:${id}`,
        diff: { workerId: result.worker.workerId, from: result.worker.status, to: status, closedTimeEntryIds: result.closedIds },
      });
    }
    revalidateAll();
    return ok({ id, closedOpenEntries: result.closedIds.length });
  } catch (err) {
    return failFromUnknown(err);
  }
}

/** Set an ENDED worker back to ACTIVE. Optionally set a new end date (`YYYY-MM-DD`); default clears it. */
export async function reactivateContractWorker(
  id: string,
  endDate?: string | null,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  try {
    let end: Date | null = null;
    if (endDate) {
      const e = parseDate(endDate, "End date");
      if ("error" in e) return fail(e.error);
      end = e.date;
    }
    const result = await withContractWorkerLock(id, async (tx) => {
      const worker = await tx.contractWorker.findUnique({ where: { id } });
      if (!worker) return { error: "That worker no longer exists. Refresh the page." };
      if (worker.status === "INACTIVE") return { error: "Use Activate for an inactive worker to keep the assignment dates unchanged." };
      if (end && end.getTime() < worker.startDate.getTime()) {
        return { error: "The end date can't be before the start date." };
      }
      await tx.contractWorker.update({ where: { id }, data: { status: "ACTIVE", endDate: end } });
      return { worker };
    });
    if ("error" in result) return fail(result.error!);
    const worker = result.worker;
    await audit({
      action: "contract.worker.reactivate",
      resource: `ContractWorker:${id}`,
      diff: { workerId: worker.workerId, endDate: end?.toISOString().slice(0, 10) ?? null },
    });
    revalidateAll();
    return ok({ id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

/** Admin: put a worker back on the temporary kiosk PIN (they choose a new one next punch). */
export async function resetContractWorkerKioskPin(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    const worker = await db.contractWorker.update({
      where: { id },
      data: { kioskPinHash: null },
      select: { workerId: true },
    });
    await audit({
      action: "kiosk.contract.pin_reset",
      resource: `ContractWorker:${id}`,
      diff: { workerId: worker.workerId, resetToDefault: true },
    });
    revalidateAll();
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Hours
// ──────────────────────────────────────────────────────────────────────

const reviewSchema = z.object({
  id: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  notes: z.string().trim().max(1000).optional(),
});

/** Approve or reject one closed entry that is still pending. Rejecting needs notes. */
export async function reviewContractTimeEntry(
  input: z.infer<typeof reviewSchema>,
): Promise<ActionResult<{ id: string; approvalStatus: string }>> {
  const admin = await requireAdmin();
  try {
    const data = reviewSchema.parse(input);
    const notes = data.notes?.trim() || null;
    if (data.decision === "REJECTED" && !notes) {
      return fail("Enter a reason for rejecting this entry.");
    }
    const found = await db.contractTimeEntry.findUnique({
      where: { id: data.id },
      select: { contractWorkerId: true },
    });
    if (!found) return fail("That time entry no longer exists. Refresh the page.");

    const result = await withContractWorkerLock(found.contractWorkerId, async (tx) => {
      const entry = await tx.contractTimeEntry.findUnique({ where: { id: data.id } });
      if (!entry) return { error: "That time entry no longer exists. Refresh the page." };
      if (!entry.clockOut || isOpen(entry)) {
        return { error: "This entry is still open. Clock the worker out or edit it before reviewing." };
      }
      if (entry.approvalStatus !== "PENDING") {
        return {
          error: `This entry was already ${entry.approvalStatus.toLowerCase()}. Refresh the page.`,
        };
      }
      const updated = await tx.contractTimeEntry.update({
        where: { id: entry.id },
        data: {
          approvalStatus: data.decision,
          status: data.decision,
          approvedById: admin.id,
          approvedByName: admin.name,
          approvalDate: new Date(),
          approvalNotes: notes,
        },
      });
      return { entry, updated };
    });
    if ("error" in result) return fail(result.error!);

    await audit({
      action: `contract.time.${data.decision === "APPROVED" ? "approve" : "reject"}`,
      resource: `ContractTimeEntry:${result.entry.id}`,
      diff: {
        contractWorkerId: result.entry.contractWorkerId,
        before: { approvalStatus: result.entry.approvalStatus, status: result.entry.status },
        after: { approvalStatus: result.updated.approvalStatus, status: result.updated.status },
        notes,
      },
    });
    revalidateAll();
    return ok({ id: result.entry.id, approvalStatus: result.updated.approvalStatus });
  } catch (err) {
    return failFromUnknown(err);
  }
}

const bulkSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
  decision: z.enum(["APPROVED", "REJECTED"]),
  notes: z.string().trim().max(1000).optional(),
});

/** Approve or reject many pending closed entries at once. Non-pending ones are skipped. */
export async function bulkReviewContractTimeEntries(
  input: z.infer<typeof bulkSchema>,
): Promise<ActionResult<{ updated: number; skipped: number }>> {
  const admin = await requireAdmin();
  try {
    const data = bulkSchema.parse(input);
    const notes = data.notes?.trim() || null;
    if (data.decision === "REJECTED" && !notes) {
      return fail("Enter a reason for rejecting these entries.");
    }
    const ids = [...new Set(data.ids)];
    const changed = await db.contractTimeEntry.updateManyAndReturn({
      where: {
        id: { in: ids },
        approvalStatus: "PENDING",
        status: "COMPLETED",
        clockOut: { not: null },
      },
      data: {
        approvalStatus: data.decision,
        status: data.decision,
        approvedById: admin.id,
        approvedByName: admin.name,
        approvalDate: new Date(),
        approvalNotes: notes,
      },
      select: { id: true },
    });
    if (changed.length === 0) {
      return fail("None of the selected entries are pending review any more. Refresh the page.");
    }
    await audit({
      action: `contract.time.bulk_${data.decision === "APPROVED" ? "approve" : "reject"}`,
      resource: "ContractTimeEntry:bulk",
      diff: {
        ids: changed.map((e) => e.id),
        requested: ids.length,
        updated: changed.length,
        skipped: ids.length - changed.length,
        decision: data.decision,
        notes,
      },
    });
    revalidateAll();
    return ok({ updated: changed.length, skipped: ids.length - changed.length });
  } catch (err) {
    return failFromUnknown(err);
  }
}

/** Force a clocked-in worker out at the current time. The entry goes to pending approval. */
export async function adminClockOutContractWorker(
  workerId: string,
): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  try {
    const result = await withContractWorkerLock(workerId, async (tx) => {
      const entry = await tx.contractTimeEntry.findFirst({
        where: { contractWorkerId: workerId, status: { in: ["ACTIVE", "ON_BREAK"] } },
        orderBy: { clockIn: "desc" },
        include: { breaks: true },
      });
      if (!entry) return null;
      const closed = await closeOpenContractEntry(tx, entry, new Date(), {
        lastEditedById: admin.id,
        editReason: "Clocked out by an admin.",
      });
      return closed.entry;
    });
    if (!result) return fail("That worker is not clocked in. Refresh the page.");
    await audit({
      action: "contract.time.force_clock_out",
      resource: `ContractTimeEntry:${result.id}`,
      diff: { contractWorkerId: workerId, autoClosed: result.autoClosed },
    });
    revalidateAll();
    return ok({ id: result.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

function parseLocal(value: string, label: string): { date: Date } | { error: string } {
  // Same policy as time-admin.ts: the repeated fall-back hour means the later occurrence.
  const d = businessLocalToDate(value, BUSINESS_TZ, "later");
  if (!d) {
    return {
      error: `${label} isn't a valid America/Chicago date and time. During spring-forward, 2:00–2:59 AM does not exist; choose the actual time before or after the clock change.`,
    };
  }
  return { date: d };
}

async function findOverlap(
  tx: Tx,
  contractWorkerId: string,
  excludeId: string,
  start: Date,
  end: Date,
) {
  return tx.contractTimeEntry.findFirst({
    where: {
      contractWorkerId,
      id: { not: excludeId },
      status: { not: "REJECTED" },
      clockIn: { lt: end },
      OR: [{ clockOut: null }, { clockOut: { gt: start } }],
    },
    select: { clockIn: true, clockOut: true },
  });
}

function snapshot(e: ContractEntryWithBreaks) {
  return {
    clockIn: e.clockIn.toISOString(),
    clockOut: e.clockOut?.toISOString() ?? null,
    status: e.status,
    approvalStatus: e.approvalStatus,
    totalBreakMin: e.totalBreakMin,
    totalWorkMin: e.totalWorkMin,
    autoClosed: e.autoClosed,
  };
}

const editSchema = z.object({
  id: z.string().min(1),
  /** America/Chicago local time, `YYYY-MM-DDTHH:mm` (datetime-local value). */
  clockIn: z.string().min(1, "Enter a date and time."),
  clockOut: z.string().min(1, "Enter a date and time."),
  reason: reasonSchema,
});

/**
 * Correct the clock-in / clock-out of a CLOSED entry. Existing breaks are
 * kept (and re-clamped to the new window). Approval is reset to PENDING.
 */
export async function adminEditContractTimeEntry(
  input: z.infer<typeof editSchema>,
): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  try {
    const data = editSchema.parse(input);
    const ci = parseLocal(data.clockIn, "Clock-in");
    if ("error" in ci) return fail(ci.error);
    const co = parseLocal(data.clockOut, "Clock-out");
    if ("error" in co) return fail(co.error);

    const found = await db.contractTimeEntry.findUnique({
      where: { id: data.id },
      select: { contractWorkerId: true },
    });
    if (!found) return fail("That time entry no longer exists. Refresh the page.");

    const result = await withContractWorkerLock(found.contractWorkerId, async (tx) => {
      const entry = await tx.contractTimeEntry.findUnique({
        where: { id: data.id },
        include: { breaks: true },
      });
      if (!entry) return { error: "That time entry no longer exists. Refresh the page." };
      if (isOpen(entry) || !entry.clockOut) {
        return { error: "This shift is still open. Use Clock out to close it first." };
      }
      const breaks = entry.breaks.map((b) => ({ startTime: b.startTime, endTime: b.endTime }));
      const timeErr = validateEntryTimes({ clockIn: ci.date, clockOut: co.date, breaks });
      if (timeErr) return { error: timeErr };
      const overlap = await findOverlap(tx, entry.contractWorkerId, entry.id, ci.date, co.date);
      if (overlap) {
        return {
          error: `That time overlaps another entry (${formatDateOnly(businessDateOnly(overlap.clockIn))} ${formatBusinessTime(overlap.clockIn)} to ${overlap.clockOut ? formatBusinessTime(overlap.clockOut) : "still open"}). Adjust the times or fix the other entry first.`,
        };
      }

      const before = snapshot(entry);
      for (const b of entry.breaks) {
        await tx.contractTimeBreak.update({
          where: { id: b.id },
          data: { durationMin: breakMinutes(b, ci.date, co.date) },
        });
      }
      const totals = computeEntryTotals({ clockIn: ci.date, clockOut: co.date, breaks });
      const updated = await tx.contractTimeEntry.update({
        where: { id: entry.id },
        data: {
          clockIn: ci.date,
          clockOut: co.date,
          date: businessDateOnly(ci.date),
          totalBreakMin: totals.totalBreakMin,
          totalWorkMin: totals.totalWorkMin,
          status: "COMPLETED",
          approvalStatus: "PENDING",
          approvedById: null,
          approvedByName: null,
          approvalDate: null,
          approvalNotes: null,
          autoClosed: false,
          lastEditedById: admin.id,
          editReason: data.reason,
        },
        include: { breaks: true },
      });
      return { entry, before, after: snapshot(updated) };
    });
    if ("error" in result) return fail(result.error!);

    await audit({
      action: "contract.time.edit",
      resource: `ContractTimeEntry:${result.entry.id}`,
      diff: {
        contractWorkerId: result.entry.contractWorkerId,
        reason: data.reason,
        before: result.before,
        after: result.after,
      },
    });
    revalidateAll();
    return ok({ id: result.entry.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}
