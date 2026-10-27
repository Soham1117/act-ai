import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { PORTAL_LANGUAGE_COOKIE } from "@/lib/portal-i18n/core";

/** Consume an explicit pre-login choice only after credentials/2FA have succeeded. */
export async function applyPendingPortalLanguage(userId: string) {
  try {
    const jar = await cookies();
    const pending = jar.get(`${PORTAL_LANGUAGE_COOKIE}_pending`)?.value;
    if (pending !== "en" && pending !== "es") return;
    await db.user.update({ where: { id: userId }, data: { preferredLanguage: pending } });
    jar.delete(`${PORTAL_LANGUAGE_COOKIE}_pending`);
  } catch {
    // A presentation-preference failure must never turn a successful login into an error.
    console.error("[portal-language] could not persist pre-login choice");
  }
}
