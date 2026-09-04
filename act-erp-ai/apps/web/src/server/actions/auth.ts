"use server";

import { randomInt } from "crypto";
import { AuthError } from "next-auth";
import { signIn, signOut as naSignOut } from "@/lib/auth/auth";
import { getSessionUser } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { sendLoginCode } from "@/lib/email";
import { rateLimited } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { ok, fail, type ActionResult } from "@/lib/action-result";
import { env } from "@/lib/env";

export type LoginResult = { ok: true } | { ok: false; error: string };

const CHALLENGE_TTL_MS = 10 * 60_000;
const GENERIC_ERROR = "Invalid email/username or password. Check both and try again.";

/**
 * Step 1 of login. Verifies the identifier (email OR username) + password,
 * then emails a 6-digit 2FA code to the employee's personal email — never to
 * the login email/username itself, since some employees have no company
 * email at all. Returns an opaque challengeId for step 2
 * (verifyLoginChallenge); never returns anything that reveals whether the
 * identifier or the password was the wrong part, to avoid user enumeration.
 */
export async function requestLoginChallenge(
  identifier: string,
  password: string,
): Promise<{ ok: true; challengeId: string | null } | { ok: false; error: string }> {
  const id = identifier.trim().toLowerCase();
  if (!id || !password) return { ok: false, error: GENERIC_ERROR };

  // Rate-limit by identifier, not IP (no IP available from a server action,
  // and this is a low-traffic internal app) — blunts both password-guessing
  // and code-spamming a real employee's inbox.
  if (rateLimited(`login:${id}`, 8, 15 * 60_000)) {
    return { ok: false, error: "Too many attempts. Try again in a few minutes." };
  }

  const user = await db.user.findFirst({
    where: { OR: [{ email: id }, { username: id }] },
    select: {
      id: true,
      passwordHash: true,
      personalEmail: true,
      employee: { select: { personalEmail: true } },
    },
  });
  if (!user?.passwordHash) return { ok: false, error: GENERIC_ERROR };

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return { ok: false, error: GENERIC_ERROR };

  if (env.LOGIN_2FA_ENABLED === "false") {
    try {
      await signIn("credentials", { identifier: id, password, redirect: false });
      return { ok: true, challengeId: null };
    } catch (err) {
      if (err instanceof AuthError) return { ok: false, error: GENERIC_ERROR };
      throw err;
    }
  }

  // Employee.personalEmail takes priority; User.personalEmail is the
  // fallback for admin/system accounts with no Employee record at all.
  const to = user.employee?.personalEmail ?? user.personalEmail;
  if (!to) {
    // Password was right, but 2FA has nowhere to send a code. Deliberately
    // NOT the generic error — this is a real account-setup gap, not a wrong
    // password, and the employee can't self-serve their way out of it.
    return {
      ok: false,
      error:
        "No personal email on file for 2FA. Ask an admin to add one before you can sign in.",
    };
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const challenge = await db.loginChallenge.create({
    data: {
      userId: user.id,
      codeHash: await hashPassword(code),
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });

  try {
    await sendLoginCode(to, code);
  } catch (err) {
    // Don't leave a dangling challenge nobody can complete, and don't leak
    // SES internals to the client — but do log it, since "2FA silently
    // stopped working" is exactly the kind of thing that needs a stack trace.
    await db.loginChallenge.delete({ where: { id: challenge.id } }).catch(() => {});
    console.error("sendLoginCode failed:", err);
    return { ok: false, error: "Could not send the sign-in code. Try again shortly." };
  }

  return { ok: true, challengeId: challenge.id };
}

/**
 * Step 2 of login. Verifies the 2FA code and, if correct, sets the session
 * cookie. `redirect: false` keeps the inline error UI in the login form.
 */
export async function verifyLoginChallenge(
  challengeId: string,
  code: string,
): Promise<LoginResult> {
  if (rateLimited(`login-code:${challengeId}`, 5, 10 * 60_000)) {
    return { ok: false, error: "Too many attempts. Request a new code." };
  }
  try {
    await signIn("credentials", { challengeId, code, redirect: false });
    return { ok: true };
  } catch (err) {
    if (err instanceof AuthError) {
      return { ok: false, error: "Incorrect or expired code." };
    }
    throw err;
  }
}

export async function signOut() {
  await naSignOut({ redirectTo: "/login" });
}

/**
 * Authenticated self-service password change. Verifies the current password,
 * sets the new hash, and revokes all sessions (so the user re-logs in).
 */
export async function changeMyPassword(
  current: string,
  next: string,
): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user)
    return fail("You are not signed in. Sign in again, then change your password.");
  if (next.length < 8) {
    return fail("New password must be at least 8 characters. Choose a longer password.");
  }

  const row = await db.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  });
  if (!row?.passwordHash || !(await verifyPassword(current, row.passwordHash))) {
    return fail("Current password is incorrect. Re-enter it and try again.");
  }
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(next), tokenVersion: { increment: 1 } },
  });
  return ok();
}
