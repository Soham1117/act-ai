"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createHash, randomBytes } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { ReadOnlyAccountError, requireAdmin, requireWritableUser } from "@/lib/auth";
import { READ_ONLY_MESSAGE } from "@/lib/access";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { audit } from "@/lib/audit";
import { rateLimited } from "@/lib/rate-limit";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";
import { requestUsesHttps } from "@/lib/cookie-secure";
import {
  getKioskNetworkAccess,
  kioskNetworkDeniedMessage,
} from "@/lib/kiosk-network";
import { DEFAULT_KIOSK_PIN, isDefaultPin, validateNewPin } from "@/lib/kiosk-pin";
import { parseKioskIdInput } from "@/lib/kiosk-id";
import {
  clearFailures,
  isLocked,
  minutesUntilUnlock,
  recordFailure,
} from "@/lib/kiosk-rate-limit";
import { clientIpFromHeaders } from "@/lib/ip-network";
import { isStaleShift } from "@/lib/time-rules";
import { _clockIn, _clockOut, _startBreak, _endBreak } from "@/server/time-core";

const COOKIE = "act_kiosk";
const KIOSK_TTL_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const PIN_FAIL_WINDOW_MS = 5 * 60_000;
const PIN_MAX_FAILS_PER_EMPLOYEE = 5;
const PIN_MAX_FAILS_PER_IP = 20;
const NOT_ACTIVE_MESSAGE = "This account isn't active for kiosk use. Please see an admin.";
const NOT_ACTIVATED_MESSAGE =
  "This kiosk session is not active on this device. An admin must activate the kiosk here first.";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

const slugRe = /^[a-z0-9](?:[a-z0-9-]{0,40}[a-z0-9])?$/;

const createSchema = z.object({
  slug: z.string().regex(slugRe, "Use lowercase letters, numbers, hyphens (max 42)."),
  label: z.string().min(1).max(80),
});

/**
 * Admin creates a new kiosk record. The kiosk is "registered" but inactive
 * until an admin physically activates it from the terminal via
 * `activateKiosk`.
 */
export async function createKiosk(
  input: z.infer<typeof createSchema>,
): Promise<ActionResult<{ id: string; slug: string }>> {
  const admin = await requireAdmin();
  try {
    const data = createSchema.parse(input);

    const existing = await db.kioskSession.findUnique({ where: { slug: data.slug } });
    if (existing) {
      return fail(
        `A kiosk with slug "${data.slug}" already exists. Choose a different slug and try again.`,
      );
    }

    const session = await db.kioskSession.create({
      data: {
        slug: data.slug,
        label: data.label,
        provisionedBy: admin.id,
        expiresAt: new Date(Date.now() + KIOSK_TTL_DAYS * 24 * 60 * 60 * 1000),
      },
    });
    await audit({
      action: "kiosk.create",
      resource: `KioskSession:${session.id}`,
      diff: { slug: data.slug, label: data.label },
    });
    revalidatePath("/admin/kiosks");
    revalidatePath("/kiosk");
    return ok({ id: session.id, slug: session.slug ?? data.slug });
  } catch (err) {
    return failFromUnknown(err);
  }
}

/**
 * Activate the kiosk identified by `slug` on the current device. Sets a
 * scoped cookie containing a hashed secret. Must be called by an admin.
 */
export async function activateKiosk(
  slug: string,
): Promise<ActionResult<{ redirectTo: string }>> {
  const admin = await requireAdmin();
  try {
    const network = await getKioskNetworkAccess();
    if (!network.allowed) {
      return fail(kioskNetworkDeniedMessage(network.ip));
    }
    const session = await db.kioskSession.findUnique({ where: { slug } });
    if (!session) {
      return fail("That kiosk was not found. Check the slug or create the kiosk first.");
    }
    if (session.revokedAt) {
      return fail(
        "That kiosk has been revoked. Create a new kiosk or ask an admin to restore access.",
      );
    }

    const raw = randomBytes(32).toString("base64url");
    await db.kioskSession.update({
      where: { id: session.id },
      data: {
        cookieHash: hash(raw),
        provisionedBy: admin.id,
        expiresAt: new Date(Date.now() + KIOSK_TTL_DAYS * 24 * 60 * 60 * 1000),
        revokedAt: null,
      },
    });

    const jar = await cookies();
    jar.set(COOKIE, raw, {
      httpOnly: true,
      secure: await requestUsesHttps(),
      sameSite: "lax",
      path: "/",
      maxAge: KIOSK_TTL_DAYS * 24 * 60 * 60,
    });

    await audit({
      action: "kiosk.activate",
      resource: `KioskSession:${session.id}`,
      diff: { slug },
    });
    revalidatePath("/admin/kiosks");
    return ok({ redirectTo: `/kiosk/${slug}` });
  } catch (err) {
    return failFromUnknown(err);
  }
}

/**
 * Server-only helper: returns the active kiosk session for the given slug
 * if (and only if) the device cookie matches this kiosk. Returns null
 * otherwise.
 */
export async function getActiveKioskSession(slug: string) {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (!raw) return null;
  const session = await db.kioskSession.findUnique({ where: { slug } });
  if (!session) return null;
  if (session.revokedAt || session.expiresAt < new Date()) return null;
  if (!session.cookieHash || session.cookieHash !== hash(raw)) return null;
  return session;
}

/**
 * Validates the device cookie and slides the 90-day expiry forward on use, so
 * a kiosk that is used regularly never silently expires.
 */
async function requireActiveKiosk(slug: string) {
  const session = await getActiveKioskSession(slug);
  if (!session) return null;
  const now = new Date();
  const extend = session.expiresAt.getTime() - now.getTime() < (KIOSK_TTL_DAYS - 1) * DAY_MS;
  const expiresAt = extend ? new Date(now.getTime() + KIOSK_TTL_DAYS * DAY_MS) : session.expiresAt;
  await db.kioskSession.update({
    where: { id: session.id },
    data: { lastUsedAt: now, ...(extend ? { expiresAt } : {}) },
  });
  if (extend) {
    try {
      const jar = await cookies();
      const raw = jar.get(COOKIE)?.value;
      if (raw) {
        jar.set(COOKIE, raw, {
          httpOnly: true,
          secure: await requestUsesHttps(),
          sameSite: "lax",
          path: "/",
          maxAge: KIOSK_TTL_DAYS * 24 * 60 * 60,
        });
      }
    } catch {
      // Cookie writes aren't possible outside a server action; DB expiry still slid.
    }
  }
  return { ...session, expiresAt };
}

/** Sign out of the kiosk on this device. */
export async function endKioskSession(slug: string) {
  const jar = await cookies();
  jar.delete(COOKIE);
  await audit({
    action: "kiosk.end",
    resource: `KioskSession:${slug}`,
  });
  redirect(`/kiosk/${slug}`);
}

type KioskLookupOk = {
  id: string;
  employeeId: string;
  name: string;
  email: string | null;
  profilePic: string | null;
  jobTitle: string | null;
  hasPin: boolean;
  /** PIN is still the temporary default; must be changed before punching. */
  mustChangePin: boolean;
  status: "ACTIVE" | "ON_BREAK" | "OUT";
  activeEntryId: string | null;
  /** An earlier shift was left open >16h; clocking in closes it and flags it for review. */
  staleShift: boolean;
};

export type KioskRosterEmployee = {
  id: string;
  employeeId: string;
  name: string;
  profilePic: string | null;
  jobTitle: string | null;
  status: "ACTIVE" | "ON_BREAK" | "OUT";
};

/** An open entry older than the max shift length is treated as "out" (clock-in will close it). */
function openEntry<T extends { clockIn: Date }>(e: T | undefined): T | undefined {
  return e && !isStaleShift(e.clockIn) ? e : undefined;
}

/** Active employees for the kiosk picker (grid/list). Requires device cookie. */
export async function kioskListEmployees(
  slug: string,
): Promise<ActionResult<{ employees: KioskRosterEmployee[] }>> {
  try {
    const session = await requireActiveKiosk(slug);
    if (!session) {
      return fail(NOT_ACTIVATED_MESSAGE);
    }
    if (rateLimited(`roster:${session.id}`, 20, 60_000)) {
      return fail("Too many refreshes — wait a moment and try again.");
    }

    const rows = await db.employee.findMany({
      where: { employmentStatus: "ACTIVE" },
      orderBy: { name: "asc" },
      select: {
        id: true,
        employeeId: true,
        name: true,
        profilePic: true,
        jobTitle: true,
        timeEntries: {
          where: { status: { in: ["ACTIVE", "ON_BREAK"] } },
          take: 1,
          orderBy: { clockIn: "desc" },
          select: { status: true, clockIn: true },
        },
      },
    });

    return ok({
      employees: rows.map((row) => ({
        id: row.id,
        employeeId: row.employeeId,
        name: row.name,
        profilePic: row.profilePic,
        jobTitle: row.jobTitle,
        status: (openEntry(row.timeEntries[0])?.status ?? "OUT") as
          | "ACTIVE"
          | "ON_BREAK"
          | "OUT",
      })),
    });
  } catch (err) {
    return failFromUnknown(err);
  }
}

/** Lookup an employee by their business ID for the kiosk confirmation card. */
export async function kioskLookup(
  slug: string,
  employeeId: string,
): Promise<ActionResult<KioskLookupOk>> {
  try {
    // Network allowlist is enforced only at activation. Starlink (and similar)
    // rotates egress IPs; the device cookie is the ongoing trust boundary.
    const session = await requireActiveKiosk(slug);
    if (!session) {
      return fail(NOT_ACTIVATED_MESSAGE);
    }
    if (rateLimited(`lookup:${session.id}`, 30, 60_000)) {
      return fail("Too many lookups — wait a moment and try again.");
    }
    const parsed = parseKioskIdInput(employeeId);
    if (parsed.kind === "empty") {
      return fail("Enter your employee ID or the digits at the end of it.");
    }
    const include = {
      timeEntries: {
        where: { status: { in: ["ACTIVE", "ON_BREAK"] as ("ACTIVE" | "ON_BREAK")[] } },
        take: 1,
        orderBy: { clockIn: "desc" as const },
      },
    };
    let employee;
    if (parsed.kind === "full") {
      employee = await db.employee.findFirst({
        where: { employeeId: { equals: parsed.id, mode: "insensitive" } },
        include,
      });
    } else {
      const candidates = await db.employee.findMany({
        where: {
          OR: [
            { employeeId: { endsWith: `-${parsed.padded}` } },
            { employeeId: { endsWith: `-${parsed.digits}` } },
          ],
        },
        include,
        take: 10,
      });
      const active = candidates.filter((c) => c.employmentStatus === "ACTIVE");
      const pool = active.length > 0 ? active : candidates;
      if (pool.length > 1) {
        return fail(
          "More than one employee matches those digits. Enter the full ID or pick yourself from the list.",
        );
      }
      employee = pool[0] ?? null;
    }
    if (!employee) {
      return fail("Unknown employee ID. Check the ID and try again.");
    }
    if (employee.employmentStatus !== "ACTIVE") {
      return fail(NOT_ACTIVE_MESSAGE);
    }

    const rawOpen = employee.timeEntries[0];
    const active = openEntry(rawOpen);
    return ok({
      id: employee.id,
      employeeId: employee.employeeId,
      name: employee.name,
      email: employee.email,
      profilePic: employee.profilePic,
      jobTitle: employee.jobTitle,
      hasPin: !!employee.kioskPinHash,
      mustChangePin: await isDefaultPin(employee.kioskPinHash),
      status: (active?.status ?? "OUT") as "ACTIVE" | "ON_BREAK" | "OUT",
      activeEntryId: active?.id ?? null,
      staleShift: !!rawOpen && !active,
    });
  } catch (err) {
    return failFromUnknown(err);
  }
}

const pinSchema = z.string().regex(/^\d{4,6}$/, "PIN must be 4-6 digits");

const actionSchema = z.object({
  slug: z.string(),
  employeeId: z.string(),
  pin: pinSchema,
  action: z.enum(["CLOCK_IN", "CLOCK_OUT", "START_BREAK", "END_BREAK"]),
});

/**
 * Shared PIN gate for kiosk actions. Only FAILED attempts count toward the
 * limit (keyed by kiosk session + employee, and by kiosk session + IP);
 * successful punches never do.
 */
async function authenticateKioskPin(
  sessionId: string,
  employee: { id: string; kioskPinHash: string | null; employmentStatus: string },
  pin: string,
  slug: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (employee.employmentStatus !== "ACTIVE") {
    return { ok: false, error: NOT_ACTIVE_MESSAGE };
  }
  const ip = clientIpFromHeaders(await headers()) ?? "unknown";
  const empKey = `pin:${sessionId}:${employee.id}`;
  const ipKey = `pinip:${sessionId}:${ip}`;
  if (isLocked(empKey, PIN_MAX_FAILS_PER_EMPLOYEE) || isLocked(ipKey, PIN_MAX_FAILS_PER_IP)) {
    const mins = Math.max(minutesUntilUnlock(empKey), minutesUntilUnlock(ipKey), 1);
    return {
      ok: false,
      error: `Too many incorrect PIN attempts. Try again in about ${mins} minute${mins === 1 ? "" : "s"}.`,
    };
  }
  if (!employee.kioskPinHash) {
    return {
      ok: false,
      error: "No kiosk PIN is set for this employee. Ask an admin to reset your PIN.",
    };
  }
  const pinOk = await verifyPassword(pin, employee.kioskPinHash);
  if (!pinOk) {
    recordFailure(empKey, PIN_FAIL_WINDOW_MS);
    recordFailure(ipKey, PIN_FAIL_WINDOW_MS);
    await audit({
      action: "kiosk.pin_failed",
      resource: `Employee:${employee.id}`,
      diff: { kioskSlug: slug, ip },
    });
    return {
      ok: false,
      error: "Incorrect PIN. Try again, or ask an admin to reset your PIN if you forgot it.",
    };
  }
  clearFailures(empKey);
  return { ok: true };
}

export async function kioskAction(
  input: z.infer<typeof actionSchema>,
): Promise<ActionResult<{ id: string | null; status: string | null; autoClosed?: boolean }>> {
  try {
    const session = await requireActiveKiosk(input.slug);
    if (!session) return fail(NOT_ACTIVATED_MESSAGE);
    const data = actionSchema.parse(input);

    const employee = await db.employee.findFirst({
      where: { employeeId: { equals: data.employeeId.trim(), mode: "insensitive" } },
    });
    if (!employee) {
      return fail("Unknown employee ID. Check the ID and try again.");
    }
    const auth = await authenticateKioskPin(session.id, employee, data.pin, session.slug);
    if (!auth.ok) return fail(auth.error);

    // Still on the temporary PIN: the punch must not proceed until it is changed.
    if (data.pin === DEFAULT_KIOSK_PIN || (await isDefaultPin(employee.kioskPinHash))) {
      return fail("You must set a new PIN before you can clock in or out.");
    }

    const meta = { kioskSlug: session.slug ?? input.slug, kioskLabel: session.label };

    let entryResult: Awaited<ReturnType<typeof _clockIn>>;
    switch (data.action) {
      case "CLOCK_IN":
        entryResult = await _clockIn(employee.id, undefined, "KIOSK", meta);
        break;
      case "CLOCK_OUT":
        entryResult = await _clockOut(employee.id, undefined, meta);
        break;
      case "START_BREAK":
        entryResult = await _startBreak(employee.id);
        break;
      case "END_BREAK":
        entryResult = await _endBreak(employee.id);
        break;
    }

    if (!entryResult.ok) return entryResult;

    await audit({
      action: `kiosk.${data.action.toLowerCase()}`,
      resource: `Employee:${employee.id}`,
      actor: { id: employee.userId, email: employee.email },
      diff: {
        employeeId: employee.employeeId,
        employeeName: employee.name,
        kioskSlug: session.slug,
        kioskLabel: session.label,
        timeEntryId: entryResult.id,
        autoClosedShift: entryResult.autoClosed ?? false,
      },
    });

    revalidatePath(`/kiosk/${input.slug}`);
    revalidatePath("/admin/time-tracking");
    revalidatePath("/admin");
    return ok({
      id: entryResult.id,
      status: entryResult.status,
      autoClosed: entryResult.autoClosed ?? false,
    });
  } catch (err) {
    return failFromUnknown(err);
  }
}

const changePinSchema = z.object({
  slug: z.string(),
  employeeId: z.string(),
  currentPin: pinSchema,
  newPin: z.string(),
});

/**
 * Forced PIN change at the kiosk. Only allowed while the employee's PIN is
 * still the temporary default (set on account creation or admin reset).
 */
export async function kioskChangePin(
  input: z.infer<typeof changePinSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireActiveKiosk(input.slug);
    if (!session) return fail(NOT_ACTIVATED_MESSAGE);
    const data = changePinSchema.parse(input);

    const employee = await db.employee.findFirst({
      where: { employeeId: { equals: data.employeeId.trim(), mode: "insensitive" } },
    });
    if (!employee) return fail("Unknown employee ID. Check the ID and try again.");

    const auth = await authenticateKioskPin(session.id, employee, data.currentPin, session.slug);
    if (!auth.ok) return fail(auth.error);

    if (!(await isDefaultPin(employee.kioskPinHash))) {
      return fail(
        "Your PIN has already been changed. Change it from Settings after signing in to the portal.",
      );
    }
    const weak = validateNewPin(data.newPin);
    if (weak) return fail(weak);

    await db.employee.update({
      where: { id: employee.id },
      data: { kioskPinHash: await hashPassword(data.newPin) },
    });
    await audit({
      action: "kiosk.pin_changed",
      resource: `Employee:${employee.id}`,
      actor: { id: employee.userId, email: employee.email },
      diff: { forced: true, kioskSlug: session.slug },
    });
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}

export async function revokeKiosk(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    const session = await db.kioskSession.update({
      where: { id },
      data: { revokedAt: new Date(), cookieHash: null },
    });
    await audit({
      action: "kiosk.revoke",
      resource: `KioskSession:${id}`,
      diff: { slug: session.slug },
    });
    revalidatePath("/admin/kiosks");
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}

export async function deleteKiosk(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    const session = await db.kioskSession.findUnique({ where: { id } });
    await db.kioskSession.delete({ where: { id } });
    await audit({
      action: "kiosk.delete",
      resource: `KioskSession:${id}`,
      diff: { slug: session?.slug },
    });
    revalidatePath("/admin/kiosks");
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}

/** Self-service: set or change your own kiosk PIN. Requires the current
 *  password as a check, same as changeMyPassword — it's what gates clock
 *  in/out at a shared terminal. */
export async function setMyKioskPin(
  currentPassword: string,
  pin: string,
): Promise<ActionResult> {
  let user;
  try {
    user = await requireWritableUser();
  } catch (err) {
    if (err instanceof ReadOnlyAccountError) return fail(READ_ONLY_MESSAGE);
    throw err;
  }
  if (!user.employeeId) {
    return fail(
      "Your account has no employee profile yet. Ask an admin to create one before you can set a kiosk PIN.",
    );
  }
  const weak = validateNewPin(pin);
  if (weak) return fail(weak);

  try {
    const row = await db.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    if (
      !row?.passwordHash ||
      !(await verifyPassword(currentPassword, row.passwordHash))
    ) {
      return fail("Current password is incorrect. Re-enter your password and try again.");
    }
    await db.employee.update({
      where: { id: user.employeeId },
      data: { kioskPinHash: await hashPassword(pin) },
    });
    await audit({ action: "kiosk.pin_set", resource: `Employee:${user.employeeId}` });
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}

/** Admin: restore the temporary kiosk PIN for lost-PIN recovery. */
export async function resetEmployeeKioskPin(employeeId: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    await db.employee.update({
      where: { id: employeeId },
      data: { kioskPinHash: await hashPassword(DEFAULT_KIOSK_PIN) },
    });
    await audit({
      action: "kiosk.pin_reset",
      resource: `Employee:${employeeId}`,
      diff: { resetToDefault: true },
    });
    revalidatePath(`/admin/employees/${employeeId}`);
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}
