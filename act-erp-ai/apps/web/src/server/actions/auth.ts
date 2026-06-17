"use server";

import { AuthError } from "next-auth";
import { signIn, signOut as naSignOut } from "@/lib/auth/auth";

export type LoginResult = { ok: true } | { ok: false; error: string };

/**
 * Verify credentials and set the session cookie. `redirect: false` keeps the
 * nice inline error UI in the login form (we route on the client on success).
 */
export async function loginAction(email: string, password: string): Promise<LoginResult> {
  try {
    await signIn("credentials", { email, password, redirect: false });
    return { ok: true };
  } catch (err) {
    if (err instanceof AuthError) {
      return { ok: false, error: "Invalid email or password." };
    }
    throw err;
  }
}

export async function signOut() {
  await naSignOut({ redirectTo: "/login" });
}
