"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createHash, randomBytes } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { _clockIn, _clockOut, _startBreak, _endBreak } from "./time-clock";

const COOKIE = "act_kiosk";
const KIOSK_TTL_DAYS = 90;

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
export async function createKiosk(input: z.infer<typeof createSchema>) {
  const admin = await requireAdmin();
  const data = createSchema.parse(input);

  const existing = await db.kioskSession.findUnique({ where: { slug: data.slug } });
  if (existing) throw new Error(`A kiosk with slug "${data.slug}" already exists.`);

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
  return session;
}

/**
 * Activate the kiosk identified by `slug` on the current device. Sets a
 * scoped cookie containing a hashed secret. Must be called by an admin.
 */
export async function activateKiosk(slug: string) {
  const admin = await requireAdmin();
  const session = await db.kioskSession.findUnique({ where: { slug } });
  if (!session) throw new Error("Kiosk not found.");
  if (session.revokedAt) throw new Error("Kiosk is revoked.");

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
    secure: process.env.NODE_ENV === "production",
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
  // Don't call redirect() here — the client handles navigation after the
  // cookie has been set in this response. Calling redirect() inside a server
  // action throws NEXT_REDIRECT which a client-side try/catch will swallow
  // and surface as a confusing error toast.
  return { ok: true as const, redirectTo: `/kiosk/${slug}` };
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

async function requireActiveKiosk(slug: string) {
  const session = await getActiveKioskSession(slug);
  if (!session) throw new Error("Kiosk session not active");
  // Touch lastUsedAt asynchronously.
  await db.kioskSession.update({
    where: { id: session.id },
    data: { lastUsedAt: new Date() },
  });
  return session;
}

/** Sign out of the kiosk on this device. */
export async function endKioskSession(slug: string) {
  const jar = await cookies();
  jar.delete(COOKIE);
  await audit({
    action: "kiosk.end",
    resource: `KioskSession:${slug}`,
  });
  // Called via <form action={...}> — Next handles redirect-as-throw cleanly.
  redirect(`/kiosk/${slug}`);
}

/** Lookup an employee by their business ID for the kiosk confirmation card. */
export async function kioskLookup(slug: string, employeeId: string) {
  await requireActiveKiosk(slug);
  const employee = await db.employee.findUnique({
    where: { employeeId: employeeId.trim() },
    include: {
      timeEntries: {
        where: { status: { in: ["ACTIVE", "ON_BREAK"] } },
        take: 1,
        orderBy: { clockIn: "desc" },
      },
    },
  });
  if (!employee) throw new Error("Unknown employee ID");

  const active = employee.timeEntries[0];
  return {
    id: employee.id,
    employeeId: employee.employeeId,
    name: employee.name,
    email: employee.email,
    profilePic: employee.profilePic,
    jobTitle: employee.jobTitle,
    status: (active?.status ?? "OUT") as "ACTIVE" | "ON_BREAK" | "OUT",
    activeEntryId: active?.id ?? null,
  };
}

const actionSchema = z.object({
  slug: z.string(),
  employeeId: z.string(),
  action: z.enum(["CLOCK_IN", "CLOCK_OUT", "START_BREAK", "END_BREAK"]),
});

export async function kioskAction(input: z.infer<typeof actionSchema>) {
  const session = await requireActiveKiosk(input.slug);
  const data = actionSchema.parse(input);

  const employee = await db.employee.findUnique({ where: { employeeId: data.employeeId } });
  if (!employee) throw new Error("Unknown employee ID");

  const meta = { kioskSlug: session.slug ?? input.slug, kioskLabel: session.label };

  let entry;
  switch (data.action) {
    case "CLOCK_IN":
      entry = await _clockIn(employee.id, undefined, "KIOSK", meta);
      break;
    case "CLOCK_OUT":
      entry = await _clockOut(employee.id, undefined, meta);
      break;
    case "START_BREAK":
      entry = await _startBreak(employee.id);
      break;
    case "END_BREAK":
      entry = await _endBreak(employee.id);
      break;
  }

  await audit({
    action: `kiosk.${data.action.toLowerCase()}`,
    resource: `Employee:${employee.id}`,
    actor: { id: employee.userId, email: employee.email },
    diff: {
      employeeId: employee.employeeId,
      employeeName: employee.name,
      kioskSlug: session.slug,
      kioskLabel: session.label,
      timeEntryId: entry?.id,
    },
  });

  revalidatePath(`/kiosk/${input.slug}`);
  revalidatePath("/admin/time-tracking");
  revalidatePath("/admin");
  return entry;
}

export async function revokeKiosk(id: string) {
  await requireAdmin();
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
}

export async function deleteKiosk(id: string) {
  await requireAdmin();
  const session = await db.kioskSession.findUnique({ where: { id } });
  await db.kioskSession.delete({ where: { id } });
  await audit({
    action: "kiosk.delete",
    resource: `KioskSession:${id}`,
    diff: { slug: session?.slug },
  });
  revalidatePath("/admin/kiosks");
}
