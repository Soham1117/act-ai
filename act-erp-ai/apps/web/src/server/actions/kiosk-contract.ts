"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { rateLimited } from "@/lib/rate-limit";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";
import { businessDateOnly } from "@/lib/format";
import { isContractWorkerEligible } from "@/lib/contract-workers";
import { isStaleShift } from "@/lib/time-rules";
import { getActiveKioskSession } from "@/server/actions/kiosk";
import {
  _contractClockIn,
  _contractClockOut,
  _contractEndBreak,
  _contractStartBreak,
  type ContractPunchResult,
} from "@/server/contract-time-core";

const NOT_ACTIVATED_MESSAGE =
  "This kiosk session is not active on this device. An admin must activate the kiosk here first.";

/** One row of the kiosk contract-worker picker. Only workers eligible today are listed. */
export type KioskContractWorker = {
  /** ContractWorker.id (pass this as `workerId` to {@link kioskContractAction}). */
  id: string;
  /** Business ID, e.g. CW-0001. */
  workerId: string;
  name: string;
  agencyName: string;
  jobCode: string | null;
  project: string | null;
  status: "ACTIVE" | "ON_BREAK" | "OUT";
};

/**
 * Validate the kiosk device cookie (slug must match this device) and record
 * use. The device cookie is the only trust boundary: contract workers have no
 * PIN.
 */
async function requireKioskForContract(slug: string) {
  const session = await getActiveKioskSession(slug);
  if (!session) return null;
  await db.kioskSession.update({
    where: { id: session.id },
    data: { lastUsedAt: new Date() },
  });
  return session;
}

/** Contract workers who may clock in today, for the kiosk picker. Requires device cookie. */
export async function kioskListContractWorkers(
  slug: string,
): Promise<ActionResult<{ workers: KioskContractWorker[] }>> {
  try {
    const session = await requireKioskForContract(slug);
    if (!session) return fail(NOT_ACTIVATED_MESSAGE);
    if (rateLimited(`contract-roster:${session.id}`, 20, 60_000)) {
      return fail("Too many refreshes — wait a moment and try again.");
    }

    const today = businessDateOnly();
    const rows = await db.contractWorker.findMany({
      where: {
        status: "ACTIVE",
        startDate: { lte: today },
        OR: [{ endDate: null }, { endDate: { gte: today } }],
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        workerId: true,
        name: true,
        jobCode: true,
        project: true,
        status: true,
        startDate: true,
        endDate: true,
        agency: { select: { name: true } },
        timeEntries: {
          where: { status: { in: ["ACTIVE", "ON_BREAK"] } },
          take: 1,
          orderBy: { clockIn: "desc" },
          select: { status: true, clockIn: true },
        },
      },
    });

    const workers: KioskContractWorker[] = rows
      .filter((r) => isContractWorkerEligible(r, today))
      .map((r) => {
        const open = r.timeEntries[0];
        // A stale open entry counts as "out": clock-in will close it for review.
        const live = open && !isStaleShift(open.clockIn) ? open : undefined;
        return {
          id: r.id,
          workerId: r.workerId,
          name: r.name,
          agencyName: r.agency.name,
          jobCode: r.jobCode,
          project: r.project,
          status: (live?.status ?? "OUT") as KioskContractWorker["status"],
        };
      });
    return ok({ workers });
  } catch (err) {
    return failFromUnknown(err);
  }
}

const actionSchema = z.object({
  slug: z.string().min(1),
  /** ContractWorker.id */
  workerId: z.string().min(1),
  action: z.enum(["CLOCK_IN", "CLOCK_OUT", "START_BREAK", "END_BREAK"]),
});

export type KioskContractActionInput = z.infer<typeof actionSchema>;

/**
 * Punch for a contract worker from the kiosk. No PIN. Returns the new entry
 * status; `autoClosed` is true when an earlier forgotten shift was closed.
 */
export async function kioskContractAction(
  input: KioskContractActionInput,
): Promise<ActionResult<{ id: string | null; status: string | null; autoClosed?: boolean }>> {
  try {
    const data = actionSchema.parse(input);
    const session = await requireKioskForContract(data.slug);
    if (!session) return fail(NOT_ACTIVATED_MESSAGE);
    if (rateLimited(`contract-action:${session.id}`, 60, 60_000)) {
      return fail("Too many taps — wait a moment and try again.");
    }

    const worker = await db.contractWorker.findUnique({
      where: { id: data.workerId },
      select: { id: true, workerId: true, name: true, agency: { select: { name: true } } },
    });
    if (!worker) return fail("Unknown contract worker. Refresh the kiosk and try again.");

    const meta = { kioskSlug: session.slug ?? data.slug, kioskLabel: session.label };

    let result: ContractPunchResult;
    switch (data.action) {
      case "CLOCK_IN":
        result = await _contractClockIn(worker.id, meta);
        break;
      case "CLOCK_OUT":
        result = await _contractClockOut(worker.id, meta);
        break;
      case "START_BREAK":
        result = await _contractStartBreak(worker.id);
        break;
      case "END_BREAK":
        result = await _contractEndBreak(worker.id);
        break;
    }
    if (!result.ok) return result;

    await audit({
      action: `kiosk.contract.${data.action.toLowerCase()}`,
      resource: `ContractWorker:${worker.id}`,
      actor: { id: null, email: `kiosk:${session.slug ?? data.slug}` },
      diff: {
        workerId: worker.workerId,
        workerName: worker.name,
        agency: worker.agency.name,
        kioskSlug: session.slug,
        kioskLabel: session.label,
        timeEntryId: result.id,
        autoClosedShift: result.autoClosed ?? false,
      },
    });

    revalidatePath(`/kiosk/${data.slug}`);
    revalidatePath("/admin/contract-workers");
    return ok({
      id: result.id,
      status: result.status,
      autoClosed: result.autoClosed ?? false,
    });
  } catch (err) {
    return failFromUnknown(err);
  }
}
