/**
 * Failure-only limiter for kiosk PIN attempts (in-memory, per process).
 * Unlike the generic limiter, successful punches never count toward the limit:
 * callers check `isLocked`, then `recordFailure` on a wrong PIN and `clear` on
 * success.
 */
type Rec = { count: number; resetAt: number };
const failures = new Map<string, Rec>();

function live(key: string, now: number): Rec | null {
  const rec = failures.get(key);
  if (!rec) return null;
  if (rec.resetAt <= now) {
    failures.delete(key);
    return null;
  }
  return rec;
}

export function isLocked(key: string, max: number, now: number = Date.now()): boolean {
  const rec = live(key, now);
  return !!rec && rec.count >= max;
}

export function recordFailure(key: string, windowMs: number, now: number = Date.now()): number {
  const rec = live(key, now);
  if (!rec) {
    failures.set(key, { count: 1, resetAt: now + windowMs });
    return 1;
  }
  rec.count += 1;
  return rec.count;
}

export function clearFailures(key: string): void {
  failures.delete(key);
}

export function minutesUntilUnlock(key: string, now: number = Date.now()): number {
  const rec = live(key, now);
  return rec ? Math.max(1, Math.ceil((rec.resetAt - now) / 60_000)) : 0;
}
