import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/** Prefix of an audit action: "benefits.plan_create" -> "benefits.". */
export function actionPrefix(action: string): string {
  const i = action.indexOf(".");
  return i > 0 ? action.slice(0, i + 1) : action;
}

/** "hire_packet." -> "Hire packet" */
export function prefixLabel(prefix: string): string {
  const base = prefix.replace(/\.$/, "").replace(/_/g, " ");
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/**
 * Distinct action prefixes that actually exist in the audit log (so the filter
 * never lists dead options and never misses a newly-audited area).
 */
export async function activityPrefixes(): Promise<Array<{ value: string; label: string }>> {
  try {
    const rows = await db.auditLog.findMany({
      distinct: ["action"],
      select: { action: true },
      take: 2000,
    });
    const set = new Set(rows.map((r) => actionPrefix(r.action)));
    return [...set]
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: prefixLabel(value) }));
  } catch (e) {
    console.error("[activity] prefix lookup failed", e);
    return [];
  }
}

export function activityWhere(q: string, action: string): Prisma.AuditLogWhereInput {
  return {
    AND: [
      q
        ? {
            OR: [
              { actorEmail: { contains: q, mode: "insensitive" } },
              { resource: { contains: q, mode: "insensitive" } },
              { action: { contains: q, mode: "insensitive" } },
            ],
          }
        : {},
      action ? { action: { startsWith: action } } : {},
    ],
  };
}
