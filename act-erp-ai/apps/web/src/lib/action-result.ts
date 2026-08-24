/**
 * Server-action results that survive production.
 *
 * Next.js digests thrown errors in prod into a useless
 * "Server Components render" toast. User-facing failures MUST be returned
 * as `{ ok: false, error }` so the message reaches the client.
 */

export type ActionFail = { ok: false; error: string };
export type ActionOk<T extends Record<string, unknown> = Record<string, never>> =
  { ok: true } & T;
export type ActionResult<T extends Record<string, unknown> = Record<string, never>> =
  | ActionOk<T>
  | ActionFail;

export function ok(): ActionOk;
export function ok<T extends Record<string, unknown>>(data: T): ActionOk<T>;
export function ok<T extends Record<string, unknown>>(data?: T) {
  return data ? ({ ok: true, ...data } as ActionOk<T>) : ({ ok: true } as ActionOk);
}

export function fail(error: string): ActionFail {
  return { ok: false, error };
}

/** True when Next.js has already redacted the real message. */
export function isDigestErrorMessage(message: string): boolean {
  return (
    /Server Components render/i.test(message) ||
    /omitted in production/i.test(message) ||
    /digest property/i.test(message)
  );
}

type PrismaLike = {
  code?: string;
  meta?: { target?: string | string[]; field_name?: string; modelName?: string };
  message?: string;
};

function targetFields(err: PrismaLike): string[] {
  const t = err.meta?.target;
  if (!t) return [];
  return Array.isArray(t) ? t : [t];
}

/**
 * Map unexpected thrown values (Prisma, Zod, plain Error) to a toast-safe
 * string. Returns null when we have nothing useful — caller supplies fallback.
 */
export function humanizeUnexpectedError(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;

  // Zod
  if ("name" in err && (err as { name: string }).name === "ZodError") {
    const issues = (err as { issues?: { path: (string | number)[]; message: string }[] }).issues;
    if (issues?.length) {
      const first = issues[0]!;
      const field = first.path.length ? first.path.join(".") : "input";
      return `Check ${field}: ${first.message}`;
    }
    return "Some fields are invalid. Check the form and try again.";
  }

  const prisma = err as PrismaLike;
  if (prisma.code === "P2002") {
    const fields = targetFields(prisma);
    if (fields.includes("email")) {
      return "That email is already in use. Use a different one.";
    }
    if (fields.includes("username")) {
      return "That username is already taken. Pick another.";
    }
    if (fields.includes("slug")) {
      return "That slug is already taken. Choose a different one.";
    }
    if (fields.includes("code")) {
      return "That code is already in use. Choose a different code.";
    }
    if (fields.includes("name")) {
      return "That name is already taken. Choose a different name.";
    }
    if (fields.length) {
      return `A record with that ${fields.join(", ")} already exists. Change it and try again.`;
    }
    return "A record with those details already exists. Change the unique fields and try again.";
  }
  if (prisma.code === "P2025") {
    return "That record no longer exists. Refresh the page and try again.";
  }
  if (prisma.code === "P2003") {
    return "That change conflicts with related records. Remove or reassign them first.";
  }
  if (prisma.code === "P2014") {
    return "That change would break a required relationship. Check related records first.";
  }

  if (err instanceof Error) {
    if (isDigestErrorMessage(err.message)) return null;
    // Don't leak raw Prisma / DB internals if they slipped through.
    if (/prisma|invocation|postgres|econnrefused/i.test(err.message)) {
      return null;
    }
    return err.message;
  }

  return null;
}

/** Catch-all for action try/catch — always returns a Fail suitable for toasts. */
export function failFromUnknown(
  err: unknown,
  fallback = "Something went wrong. Try again, or contact an admin if it keeps happening.",
): ActionFail {
  return fail(humanizeUnexpectedError(err) ?? fallback);
}
