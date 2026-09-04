import { headers } from "next/headers";
import { env } from "./env";
import { isIpAllowed } from "./ip-network";

export async function getKioskNetworkAccess() {
  const requestHeaders = await headers();
  // Caddy is the only public ingress and replaces untrusted incoming XFF,
  // so its first value is the direct client address rather than spoofed input.
  const ip =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    requestHeaders.get("x-real-ip")?.trim() ??
    null;
  const configured = env.KIOSK_ALLOWED_NETWORKS;

  // Make local development usable, but never silently disable the production
  // control because of a missing environment variable.
  if (!configured?.trim() && env.NODE_ENV !== "production") {
    return { allowed: true, ip };
  }
  return { allowed: isIpAllowed(ip, configured), ip };
}
