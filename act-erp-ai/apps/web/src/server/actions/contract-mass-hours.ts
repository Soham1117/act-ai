"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";
import { businessDateOnly } from "@/lib/format";
import {
  applyContractAssignmentOffers,
  middleShiftBreak,
  proposeContractAssignmentOffers,
  type ContractAssignmentOffers,
} from "@/lib/contract-workers";
import {
  BUSINESS_TZ,
  businessLocalToDate,
  computeEntryTotals,
  validateEntryTimes,
} from "@/lib/time-rules";
import {
  revalidateContractPages,
  withContractWorkerLock,
} from "@/server/contract-time-core";

const schema = z.object({
  contractWorkerIds: z.array(z.string().min(1)).min(1).max(200),
  /** YYYY-MM-DD */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** HH:mm local Central */
  clockInTime: z.string().regex(/^\d{2}:\d{2}$/),
  clockOutTime: z.string().regex(/^\d{2}:\d{2}$/),
  jobCode: z.string().trim().min(1).max(40),
  /** Unpaid break in minutes, taken as one break at the middle of the shift. */
  breakMin: z.number().int().min(0).max(240).default(0),
  reason: z
    .string()
    .trim()
    .min(3, "Enter a reason (at least 3 characters). It is recorded in the audit log.")
    .max(500, "Keep the reason under 500 characters."),
  approve: z.boolean().optional(),
});

const commitSchema = schema.extend({
  perWorkerOffers: z.record(
    z.string(),
    z.object({
      shiftStartTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      extendEndTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      reactivate: z.boolean().optional(),
    }),
  ),
});

function localStamp(date: string, hm: string): Date {
  const parsed = businessLocalToDate(`${date}T${hm}`);
  if (!parsed) throw new Error(`Invalid local time ${date} ${hm}`);
  return parsed;
}

function plan(data: z.infer<typeof schema>) {
  const clockIn = localStamp(data.date, data.clockInTime);
  const clockOut = localStamp(data.date, data.clockOutTime);
  const brk = middleShiftBreak(clockIn, clockOut, data.breakMin);
  const breaks = brk ? [{ id: undefined, ...brk }] : [];
  const timeErr = validateEntryTimes({ clockIn, clockOut, breaks });
  const totals = timeErr ? null : computeEntryTotals({ clockIn, clockOut, breaks });
  return { clockIn, clockOut, brk, timeErr, totals };
}

function acceptedOffers(raw: ContractAssignmentOffers | undefined): ContractAssignmentOffers {
  if (!raw) return {};
  const out: ContractAssignmentOffers = {};
  if (raw.shiftStartTo) out.shiftStartTo = raw.shiftStartTo;
  if (raw.extendEndTo) out.extendEndTo = raw.extendEndTo;
  if (raw.reactivate) out.reactivate = true;
  return out;
}

export type MassContractPreviewRow = {
  contractWorkerId: string;
  name: string;
  workerId: string;
  status: "ACTIVE" | "INACTIVE" | "ENDED";
  overlap: boolean;
  workMin: number;
  offers: ContractAssignmentOffers;
  defaults: {
    shiftStart: boolean;
    extendEnd: boolean;
    reactivate: boolean;
  };
};

export async function previewMassContractHours(
  input: z.infer<typeof schema>,
): Promise<ActionResult<{ rows: MassContractPreviewRow[] }>> {
  await requireAdmin();
  try {
    const data = schema.parse(input);
    const { clockIn, clockOut, timeErr, totals } = plan(data);
    if (timeErr || !totals) return fail(timeErr ?? "Invalid shift.");

    const workers = await db.contractWorker.findMany({
      where: { id: { in: data.contractWorkerIds } },
      select: {
        id: true,
        name: true,
        workerId: true,
        status: true,
        startDate: true,
        endDate: true,
      },
    });
    const byId = new Map(workers.map((w) => [w.id, w]));

    const overlaps = await db.contractTimeEntry.findMany({
      where: {
        contractWorkerId: { in: data.contractWorkerIds },
        status: { not: "REJECTED" },
        clockIn: { lt: clockOut },
        OR: [{ clockOut: null }, { clockOut: { gt: clockIn } }],
      },
      select: { contractWorkerId: true },
    });
    const overlapSet = new Set(overlaps.map((o) => o.contractWorkerId));
    const entryDate = businessDateOnly(clockIn);

    return ok({
      rows: data.contractWorkerIds.map((id) => {
        const w = byId.get(id);
        const proposal = w
          ? proposeContractAssignmentOffers(
              { startDate: w.startDate, endDate: w.endDate, status: w.status },
              entryDate,
            )
          : { offers: {}, defaults: { shiftStart: false, extendEnd: false, reactivate: false } };
        return {
          contractWorkerId: id,
          name: w?.name ?? id,
          workerId: w?.workerId ?? "—",
          status: (w?.status ?? "ACTIVE") as MassContractPreviewRow["status"],
          overlap: overlapSet.has(id),
          workMin: totals.totalWorkMin,
          offers: proposal.offers,
          defaults: proposal.defaults,
        };
      }),
    });
  } catch (err) {
    return failFromUnknown(err);
  }
}

export async function commitMassContractHours(
  input: z.infer<typeof commitSchema>,
): Promise<ActionResult<{ created: number; skipped: number; failed: string[] }>> {
  const admin = await requireAdmin();
  let created = 0;
  let skipped = 0;
  const failed: string[] = [];
  let data: z.infer<typeof commitSchema> | null = null;
  try {
    data = commitSchema.parse(input);
    const req = data;
    const { clockIn, clockOut, brk, timeErr, totals } = plan(req);
    if (timeErr || !totals) return fail(timeErr ?? "Invalid shift.");
    const now = new Date();
    const entryDate = businessDateOnly(clockIn);

    const jc = await db.jobCode.findFirst({
      where: { code: req.jobCode, isActive: true },
      select: { code: true },
    });
    if (!jc) return fail("That job code is not active.");

    const people = await db.contractWorker.findMany({
      where: { id: { in: req.contractWorkerIds } },
      select: {
        id: true,
        name: true,
        workerId: true,
        jobCode: true,
        startDate: true,
        endDate: true,
        status: true,
      },
    });
    const known = new Map(people.map((p) => [p.id, p]));
    const unknown = req.contractWorkerIds.filter((id) => !known.has(id));
    if (unknown.length) {
      return fail(`${unknown.length} selected workers no longer exist. Start again.`);
    }

    for (const contractWorkerId of req.contractWorkerIds) {
      const worker = known.get(contractWorkerId)!;
      const offers = acceptedOffers(req.perWorkerOffers[contractWorkerId]);

      try {
        const result = await withContractWorkerLock(contractWorkerId, async (tx) => {
          const live = await tx.contractWorker.findUnique({
            where: { id: contractWorkerId },
            select: {
              id: true,
              name: true,
              workerId: true,
              jobCode: true,
              startDate: true,
              endDate: true,
              status: true,
            },
          });
          if (!live) return { kind: "missing" as const };

          const next = applyContractAssignmentOffers(
            {
              startDate: live.startDate,
              endDate: live.endDate,
              status: live.status,
            },
            entryDate,
            offers,
          );
          if ("error" in next) return { kind: "error" as const, error: next.error };

          const assignmentChanged =
            next.startDate.getTime() !== live.startDate.getTime() ||
            (next.endDate?.getTime() ?? null) !== (live.endDate?.getTime() ?? null) ||
            next.status !== live.status;
          if (assignmentChanged) {
            await tx.contractWorker.update({
              where: { id: live.id },
              data: {
                startDate: next.startDate,
                endDate: next.endDate,
                status: next.status,
              },
            });
          }

          const overlap = await tx.contractTimeEntry.findFirst({
            where: {
              contractWorkerId,
              status: { not: "REJECTED" },
              clockIn: { lt: clockOut },
              OR: [{ clockOut: null }, { clockOut: { gt: clockIn } }],
            },
            select: { id: true },
          });
          if (overlap) return { kind: "skipped" as const };

          const entry = await tx.contractTimeEntry.create({
            data: {
              contractWorkerId,
              date: entryDate,
              clockIn,
              clockOut,
              jobCode: req.jobCode,
              status: "COMPLETED",
              approvalStatus: req.approve ? "APPROVED" : "PENDING",
              approvedById: req.approve ? admin.id : null,
              approvedByName: req.approve ? admin.name : null,
              approvalDate: req.approve ? now : null,
              approvalNotes: req.approve ? "Approved via mass hours." : null,
              totalBreakMin: totals.totalBreakMin,
              totalWorkMin: totals.totalWorkMin,
              lastEditedById: admin.id,
              editReason: `Mass hours: ${req.reason}`,
              ...(brk
                ? {
                    breaks: {
                      create: {
                        startTime: brk.startTime,
                        endTime: brk.endTime,
                        durationMin: totals.totalBreakMin,
                        type: "BREAK" as const,
                      },
                    },
                  }
                : {}),
            },
            select: { id: true },
          });
          return {
            kind: "ok" as const,
            id: entry.id,
            assignmentChanged,
            before: {
              startDate: live.startDate.toISOString(),
              endDate: live.endDate?.toISOString() ?? null,
              status: live.status,
            },
            after: assignmentChanged
              ? {
                  startDate: next.startDate.toISOString(),
                  endDate: next.endDate?.toISOString() ?? null,
                  status: next.status,
                }
              : null,
          };
        });

        if (result.kind === "skipped") {
          skipped += 1;
          continue;
        }
        if (result.kind === "missing") {
          failed.push(`${worker.name}: no longer exists`);
          continue;
        }
        if (result.kind === "error") {
          failed.push(`${worker.name}: ${result.error}`);
          continue;
        }

        created += 1;
        await audit({
          action: "contract.time.mass_create_entry",
          resource: `ContractTimeEntry:${result.id}`,
          diff: {
            contractWorkerId,
            date: req.date,
            jobCode: req.jobCode,
            reason: req.reason,
            assignmentBefore: result.before,
            assignmentAfter: result.after,
          },
        });
      } catch (err) {
        failed.push(`${worker.name}: ${err instanceof Error ? err.message : "failed"}`);
      }
    }

    await audit({
      action: "contract.time.mass_create",
      resource: `MassContractHours:${req.date}`,
      diff: {
        workerCount: req.contractWorkerIds.length,
        created,
        skipped,
        failed: failed.length,
        jobCode: req.jobCode,
        breakMin: req.breakMin,
        reason: req.reason,
        approve: !!req.approve,
        tz: BUSINESS_TZ,
      },
    });
    revalidateContractPages();

    if (created === 0 && failed.length > 0 && skipped === 0) {
      return fail(failed.slice(0, 3).join(" "));
    }
    return ok({ created, skipped, failed });
  } catch (err) {
    if (created > 0 && data) {
      revalidateContractPages();
      return fail(
        `Stopped after saving ${created} of ${data.contractWorkerIds.length} entries. Those are saved; check Contract workers → Hours before running it again.`,
      );
    }
    return failFromUnknown(err);
  }
}
