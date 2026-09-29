import { db } from "../db";

const PRUNE_INTERVAL_MS = 60_000;
const PRUNE_BATCH_SIZE = 200;
// Keep spent identity challenges briefly for forensics before deleting.
const CHALLENGE_GRACE_MS = 60 * 60_000;

let lastPruneAt = 0;

/**
 * Opportunistically delete expired identity service nonces, spent assertion
 * JTIs and expired identity login challenges. Runs at most once per minute per
 * process and deletes at most PRUNE_BATCH_SIZE rows per table per run, so it is
 * bounded and safe to call from the request path. Failures are swallowed.
 * Returns the number of rows deleted (0 when throttled or on error).
 */
export async function pruneExpiredIdentityRows(now: number = Date.now()): Promise<number> {
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return 0;
  lastPruneAt = now;
  const cutoff = new Date(now);
  try {
    let deleted = 0;

    const nonces = await db.identityServiceRequestNonce.findMany({
      where: { expiresAt: { lt: cutoff } },
      select: { id: true },
      take: PRUNE_BATCH_SIZE,
    });
    if (nonces.length > 0) {
      deleted += (
        await db.identityServiceRequestNonce.deleteMany({ where: { id: { in: nonces.map((r) => r.id) } } })
      ).count;
    }

    const jtis = await db.usedIdentityAssertion.findMany({
      where: { expiresAt: { lt: cutoff } },
      select: { id: true },
      take: PRUNE_BATCH_SIZE,
    });
    if (jtis.length > 0) {
      deleted += (
        await db.usedIdentityAssertion.deleteMany({ where: { id: { in: jtis.map((r) => r.id) } } })
      ).count;
    }

    // Only adapter-created challenges (identityNonce set); employee challenges untouched.
    const challenges = await db.loginChallenge.findMany({
      where: {
        identityNonce: { not: null },
        expiresAt: { lt: new Date(now - CHALLENGE_GRACE_MS) },
      },
      select: { id: true },
      take: PRUNE_BATCH_SIZE,
    });
    if (challenges.length > 0) {
      deleted += (
        await db.loginChallenge.deleteMany({ where: { id: { in: challenges.map((r) => r.id) } } })
      ).count;
    }
    return deleted;
  } catch {
    return 0;
  }
}

/** Test helper: reset the throttle. */
export function resetIdentityPruneThrottle(): void {
  lastPruneAt = 0;
}
