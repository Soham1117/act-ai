import { cache } from "react";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { getSessionUserForPasswordChange } from "@/lib/auth";
import { createPortalTranslator, normalizePortalLanguage, PORTAL_LANGUAGE_COOKIE } from "./core";

/** Request-scoped: personal language never comes from shared browser or server caches. */
export const getPortalLanguage = cache(async () => {
  const user = await getSessionUserForPasswordChange();
  const preference = user ? await db.user.findUnique({ where: { id: user.id }, select: { preferredLanguage: true } }) : null;
  const jar = await cookies();
  const language = normalizePortalLanguage(preference?.preferredLanguage ?? jar.get(PORTAL_LANGUAGE_COOKIE)?.value);
  return createPortalTranslator(language);
});
