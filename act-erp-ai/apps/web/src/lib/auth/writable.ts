import { requireWritableUser, ReadOnlyAccountError, type SessionUser } from "./index";
import { fail, type ActionFail } from "@/lib/action-result";
import { READ_ONLY_MESSAGE } from "@/lib/access";

/**
 * Action-friendly wrapper around requireWritableUser(): returns the user, or
 * an ActionFail (never throws the read-only error, since prod digests thrown
 * errors into a useless message).
 *
 *   const w = await writable();
 *   if ("error" in w) return w;
 *   const user = w.user;
 */
export async function writable(): Promise<{ ok: true; user: SessionUser } | ActionFail> {
  try {
    return { ok: true, user: await requireWritableUser() };
  } catch (err) {
    if (err instanceof ReadOnlyAccountError) return fail(READ_ONLY_MESSAGE);
    throw err;
  }
}
