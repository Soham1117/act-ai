"use server";

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { getSessionUserForPasswordChange } from "@/lib/auth";
import { fail, failFromUnknown, ok, type ActionResult } from "@/lib/action-result";
import { PORTAL_LANGUAGE_COOKIE, type PortalLanguage } from "@/lib/portal-i18n/core";

/** Presentation preference only: available even when business records are read-only. */
export async function setPortalLanguage(language: PortalLanguage): Promise<ActionResult> {
  if (language !== "en" && language !== "es") return fail("Choose English or Spanish.");
  try {
    const user = await getSessionUserForPasswordChange();
    if (user) await db.user.update({ where: { id: user.id }, data: { preferredLanguage: language } });
    const jar = await cookies();
    const options = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 365 * 24 * 60 * 60 };
    jar.set(PORTAL_LANGUAGE_COOKIE, language, options);
    if (!user) jar.set(`${PORTAL_LANGUAGE_COOKIE}_pending`, language, options);
    else jar.delete(`${PORTAL_LANGUAGE_COOKIE}_pending`);
    return ok();
  } catch (err) {
    return failFromUnknown(err, "Could not save your language preference. Try again.");
  }
}
