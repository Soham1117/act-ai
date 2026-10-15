import { headers } from "next/headers";
import { db } from "./db";
import { env } from "./env";
import { clientIpFromHeaders, ipMatchesNetwork, isIpAllowed } from "./ip-network";

/**
 * Read allowlist at request time. Avoid static `process.env.FOO` access in
 * env.ts alone — Next can inline that away at build time when the var was
 * missing from the build secret, leaving production permanently empty.
 */
function configuredNetworks() {
  const dynamic = process.env["KIOSK_ALLOWED_NETWORKS"];
  if (dynamic?.trim()) return dynamic;
  return env.KIOSK_ALLOWED_NETWORKS;
}

/** Env networks as a clean list (read-only "server config"). */
export function configuredNetworkList(): string[] {
  return (configuredNetworks() ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
}

/** Admin-trusted networks from the DB. Never throws (table may not exist yet). */
async function trustedNetworks() {
  try {
    return await db.kioskTrustedNetwork.findMany({ select: { id: true, cidr: true } });
  } catch (e) {
    console.error("[kiosk-network] could not read trusted networks", e);
    return [];
  }
}

export async function getKioskNetworkAccess() {
  const requestHeaders = await headers();
  const ip = clientIpFromHeaders(requestHeaders);
  const configured = configuredNetworks();
  const trusted = await trustedNetworks();

  // Local/dev without any allowlist stays usable. Production fails closed.
  if (!configured?.trim() && trusted.length === 0 && env.NODE_ENV !== "production") {
    return {
      allowed: true,
      ip,
      configured: null as string | null,
      trustedId: null as string | null,
    };
  }
  const envAllowed = isIpAllowed(ip, configured);
  const trustedMatch = ip ? trusted.find((t) => ipMatchesNetwork(ip, t.cidr)) : undefined;
  return {
    allowed: envAllowed || !!trustedMatch,
    ip,
    configured: configured?.trim() || null,
    // Set only when access depends on the DB entry (env match wins).
    trustedId: envAllowed ? null : (trustedMatch?.id ?? null),
  };
}

export function kioskNetworkDeniedMessage(ip: string | null) {
  const seen = ip?.trim() || "unknown";
  return `This kiosk can only be used from the approved facility network (your connection appears as ${seen}).`;
}
