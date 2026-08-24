/**
 * Naive in-memory rate limiter (per Node process — fine for a single-instance
 * deploy; a multi-instance prod would need a shared store like Redis).
 * Returns true if the action should be BLOCKED.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();

export function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || rec.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  rec.count += 1;
  return rec.count > max;
}
