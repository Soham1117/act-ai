"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { rateLimited } from "@/lib/rate-limit";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";
import { businessDateOnly } from "@/lib/format";
import { isContractWorkerEligible } from "@/lib/contract-workers";
import { isStaleShift } from "@/lib/time-rules";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { DEFAULT_KIOSK_PIN, validateNewPin } from "@/lib/kiosk-pin";
import {
  clearFailures,
  isLocked,
  minutesUntilUnlock,
  recordFailure,
} from "@/lib/kiosk-rate-limit";
import { clientIpFromHeaders } from "@/lib/ip-network";
import {
  kioskProfilePhotoUrl,
  saveKioskProfilePhoto,
} from "@/server/kiosk-profile-photo-store";
import { latestKioskPhotoUrls } from "@/server/kiosk-roster-photos";
import { storePunchPhoto } from "@/server/punch-photo-store";
import { getActiveKioskSession, type KioskTimingEntry } from "@/server/actions/kiosk";
import {
  _contractClockIn,
  _contractClockOut,
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
  capturedPhotoUrl: string | null;
  jobCode: string | null;
  project: string | null;
  status: "ACTIVE" | "ON_BREAK" | "OUT";
  /** Still on the temporary PIN; must choose a new one before punching. */
  mustChangePin: boolean;
};

const PIN_FAIL_WINDOW_MS = 5 * 60_000;
const PIN_MAX_FAILS_PER_WORKER = 5;
const PIN_MAX_FAILS_PER_IP = 20;
const pinSchema = z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits");

/**
 * PIN gate for every contract-crew kiosk action. A null hash means the worker
 * is still on the temporary default PIN. Only failed attempts count toward the
 * lockout (per kiosk + worker, and per kiosk + IP).
 */
async function authenticateContractPin(
  sessionId: string,
  worker: { id: string; kioskPinHash: string | null },
  pin: string | undefined,
  slug: string | null,
): Promise<{ ok: true; mustChangePin: boolean } | { ok: false; error: string }> {
  const parsed = pinSchema.safeParse(pin);
  if (!parsed.success) return { ok: false, error: "Enter your 4-digit PIN" };
  const ip = clientIpFromHeaders(await headers()) ?? "unknown";
  const workerKey = `cpin:${sessionId}:${worker.id}`;
  const ipKey = `cpinip:${sessionId}:${ip}`;
  if (
    isLocked(workerKey, PIN_MAX_FAILS_PER_WORKER) ||
    isLocked(ipKey, PIN_MAX_FAILS_PER_IP)
  ) {
    const mins = Math.max(minutesUntilUnlock(workerKey), minutesUntilUnlock(ipKey), 1);
    return {
      ok: false,
      error: `Too many incorrect PIN attempts. Try again in about ${mins} minute${mins === 1 ? "" : "s"}.`,
    };
  }
  const good = worker.kioskPinHash
    ? await verifyPassword(parsed.data, worker.kioskPinHash)
    : parsed.data === DEFAULT_KIOSK_PIN;
  if (!good) {
    recordFailure(workerKey, PIN_FAIL_WINDOW_MS);
    recordFailure(ipKey, PIN_FAIL_WINDOW_MS);
    await audit({
      action: "kiosk.contract.pin_failed",
      resource: `ContractWorker:${worker.id}`,
      diff: { kioskSlug: slug, ip },
    });
    return {
      ok: false,
      error:
        "Incorrect PIN. Try again, or ask an admin to reset your PIN if you forgot it.",
    };
  }
  clearFailures(workerKey);
  return { ok: true, mustChangePin: worker.kioskPinHash === null };
}

/**
 * Validate the kiosk device cookie (slug must match this device) and record
 * use. Each worker's PIN is checked separately on every action.
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
        kioskPinHash: true,
        kioskProfilePhotoKey: true,
        agency: { select: { name: true } },
        timeEntries: {
          where: { status: { in: ["ACTIVE", "ON_BREAK"] } },
          take: 1,
          orderBy: { clockIn: "desc" },
          select: { status: true, clockIn: true },
        },
      },
    });

    const eligible = rows.filter((r) => isContractWorkerEligible(r, today));
    const photos = await latestKioskPhotoUrls(
      slug,
      "contract",
      eligible.map((row) => row.id),
    );
    const workers: KioskContractWorker[] = eligible.map((r) => {
      const open = r.timeEntries[0];
      // A stale open entry counts as "out": clock-in will close it for review.
      const live = open && !isStaleShift(open.clockIn) ? open : undefined;
      return {
        id: r.id,
        workerId: r.workerId,
        name: r.name,
        agencyName: r.agency.name,
        capturedPhotoUrl: r.kioskProfilePhotoKey
          ? kioskProfilePhotoUrl(
              slug,
              "contract",
              r.id,
              r.kioskProfilePhotoKey.split("/").pop()!,
            )
          : (photos.get(r.id) ?? null),
        jobCode: r.jobCode,
        project: r.project,
        status: (live?.status ?? "OUT") as KioskContractWorker["status"],
        mustChangePin: r.kioskPinHash === null,
      };
    });
    return ok({ workers });
  } catch (err) {
    return failFromUnknown(err);
  }
}

const HISTORY_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A contract worker's own shifts for the past 30 days. Needs their PIN. */
export async function kioskContractTimings(input: {
  slug: string;
  workerId: string;
  pin?: string;
}): Promise<ActionResult<{ entries: KioskTimingEntry[]; totalWorkMin: number }>> {
  try {
    const session = await requireKioskForContract(input.slug);
    if (!session) return fail(NOT_ACTIVATED_MESSAGE);
    if (rateLimited(`contract-timings:${session.id}`, 30, 60_000)) {
      return fail("Too many requests — wait a moment and try again.");
    }
    const worker = await db.contractWorker.findUnique({
      where: { id: input.workerId },
      select: { id: true, kioskPinHash: true },
    });
    if (!worker) return fail("Unknown contract worker. Refresh the kiosk and try again.");
    const auth = await authenticateContractPin(
      session.id,
      worker,
      input.pin,
      session.slug,
    );
    if (!auth.ok) return fail(auth.error);
    if (auth.mustChangePin) {
      return fail("You must set a new PIN first. Clock in or out to choose one.");
    }

    const since = new Date(businessDateOnly().getTime() - (HISTORY_DAYS - 1) * DAY_MS);
    const rows = await db.contractTimeEntry.findMany({
      where: { contractWorkerId: worker.id, date: { gte: since } },
      orderBy: { clockIn: "desc" },
      select: {
        id: true,
        date: true,
        clockIn: true,
        clockOut: true,
        totalWorkMin: true,
        totalBreakMin: true,
        status: true,
      },
    });
    const entries = rows.map((r) => ({
      id: r.id,
      date: r.date.toISOString().slice(0, 10),
      clockInIso: r.clockIn.toISOString(),
      clockOutIso: r.clockOut?.toISOString() ?? null,
      totalWorkMin: r.totalWorkMin,
      totalBreakMin: r.totalBreakMin,
      status: r.status,
    }));
    return ok({ entries, totalWorkMin: entries.reduce((s, e) => s + e.totalWorkMin, 0) });
  } catch (err) {
    return failFromUnknown(err);
  }
}

const actionSchema = z.object({
  slug: z.string().min(1),
  /** ContractWorker.id */
  workerId: z.string().min(1),
  /** Contract workers have no breaks. */
  action: z.enum(["CLOCK_IN", "CLOCK_OUT"]),
  /** 4-digit kiosk PIN. */
  pin: z.string().optional(),
  /** Optional JPEG data URL. Invalid photos are ignored. */
  photo: z.string().optional().catch(undefined),
});

export type KioskContractActionInput = z.infer<typeof actionSchema>;

/**
 * Punch for a contract worker from the kiosk. No PIN. Returns the new entry
 * status; `autoClosed` is true when an earlier forgotten shift was closed.
 */
export async function kioskContractAction(
  input: KioskContractActionInput,
): Promise<
  ActionResult<{ id: string | null; status: string | null; autoClosed?: boolean }>
> {
  try {
    const data = actionSchema.parse(input);
    const session = await requireKioskForContract(data.slug);
    if (!session) return fail(NOT_ACTIVATED_MESSAGE);
    if (rateLimited(`contract-action:${session.id}`, 60, 60_000)) {
      return fail("Too many taps — wait a moment and try again.");
    }

    const worker = await db.contractWorker.findUnique({
      where: { id: data.workerId },
      select: {
        id: true,
        workerId: true,
        name: true,
        kioskPinHash: true,
        agency: { select: { name: true } },
      },
    });
    if (!worker) return fail("Unknown contract worker. Refresh the kiosk and try again.");
    const auth = await authenticateContractPin(
      session.id,
      worker,
      data.pin,
      session.slug,
    );
    if (!auth.ok) return fail(auth.error);
    if (auth.mustChangePin)
      return fail("You must set a new PIN before you can clock in or out.");

    const meta = { kioskSlug: session.slug ?? data.slug, kioskLabel: session.label };

    let result: ContractPunchResult;
    switch (data.action) {
      case "CLOCK_IN":
        result = await _contractClockIn(worker.id, meta);
        break;
      case "CLOCK_OUT":
        result = await _contractClockOut(worker.id, meta);
        break;
    }
    if (!result.ok) return result;

    // Best-effort photo: the punch is already saved, so a failure here is ignored.
    const photoKey = await storePunchPhoto({
      type: "contract",
      entryId: result.id,
      side: data.action === "CLOCK_IN" ? "in" : "out",
      photo: data.photo,
    });

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
        photo: !!photoKey,
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

/** Forced PIN change at the kiosk, allowed only while on the temporary PIN. */
export async function kioskContractChangePin(input: {
  slug: string;
  workerId: string;
  currentPin: string;
  newPin: string;
}): Promise<ActionResult> {
  try {
    const session = await requireKioskForContract(input.slug);
    if (!session) return fail(NOT_ACTIVATED_MESSAGE);
    const worker = await db.contractWorker.findUnique({
      where: { id: input.workerId },
      select: { id: true, kioskPinHash: true },
    });
    if (!worker) return fail("Unknown contract worker. Refresh the kiosk and try again.");
    const auth = await authenticateContractPin(
      session.id,
      worker,
      input.currentPin,
      session.slug,
    );
    if (!auth.ok) return fail(auth.error);
    if (!auth.mustChangePin) return fail("Your PIN has already been changed.");
    const weak = validateNewPin(input.newPin);
    if (weak) return fail(weak);
    await db.contractWorker.update({
      where: { id: worker.id },
      data: { kioskPinHash: await hashPassword(input.newPin) },
    });
    await audit({
      action: "kiosk.contract.pin_changed",
      resource: `ContractWorker:${worker.id}`,
      actor: { id: null, email: `kiosk:${session.slug ?? input.slug}` },
      diff: { forced: true, kioskSlug: session.slug },
    });
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}

/** Portrait updates require a current contract and the worker's non-temporary PIN. */
export async function kioskContractUpdateProfilePhoto(input: {
  slug: string;
  workerId: string;
  pin: string;
  photo: string;
}): Promise<ActionResult<{ url: string }>> {
  try {
    const session = await requireKioskForContract(input.slug);
    if (!session) return fail(NOT_ACTIVATED_MESSAGE);
    if (rateLimited(`contract-profile-photo:${session.id}`, 20, 60_000))
      return fail("Too many requests � wait a moment and try again.");
    const worker = await db.contractWorker.findUnique({ where: { id: input.workerId } });
    if (!worker || !isContractWorkerEligible(worker, businessDateOnly()))
      return fail("Unknown contract worker. Refresh the kiosk and try again.");
    const auth = await authenticateContractPin(
      session.id,
      worker,
      input.pin,
      session.slug,
    );
    if (!auth.ok) return fail(auth.error);
    if (auth.mustChangePin)
      return fail("You must set a new PIN first. Clock in or out to choose one.");
    const key = await saveKioskProfilePhoto("contract", worker.id, input.photo);
    if (!key) return fail("Take a new photo and try again.");
    await audit({
      action: "kiosk.contract.profile_photo_update",
      resource: `ContractWorker:${worker.id}`,
      actor: { id: null, email: `kiosk:${session.slug}` },
      diff: { kioskSlug: session.slug },
    });
    revalidatePath(`/kiosk/${input.slug}`);
    return ok({
      url: kioskProfilePhotoUrl(input.slug, "contract", worker.id, key.split("/").pop()!),
    });
  } catch (err) {
    return failFromUnknown(err, "Could not save your photo. Try again.");
  }
}
