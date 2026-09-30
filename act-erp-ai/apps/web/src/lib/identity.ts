/**
 * Login identifiers are case-insensitive. Login lowercases what the user
 * types, so every stored email/username MUST be stored trimmed + lowercase or
 * the account can never sign in.
 */
import { z } from "zod";

export function normalizeEmail(v: string): string;
export function normalizeEmail(v: string | null | undefined): string | null;
export function normalizeEmail(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim().toLowerCase();
  return t === "" ? null : t;
}

export const normalizeUsername = normalizeEmail;

/** Zod: optional email; "" / whitespace -> undefined; trimmed + lowercased. */
export const optionalNormalizedEmail = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim().toLowerCase() || undefined) : v),
  z.string().email("Enter a valid email address").optional(),
);

/** Same, but null allowed (for partial-update schemas). */
export const nullableNormalizedEmail = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim().toLowerCase() || null) : v),
  z.string().email("Enter a valid email address").optional().nullable(),
);

export const USERNAME_MESSAGE =
  "Letters, numbers, . _ - only, 3-32 chars";

/** Zod: optional username; "" -> undefined; trimmed + lowercased. */
export const optionalNormalizedUsername = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim().toLowerCase() || undefined) : v),
  z
    .string()
    .regex(/^[a-z0-9._-]{3,32}$/, USERNAME_MESSAGE)
    .optional(),
);
