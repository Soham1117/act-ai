function ipv4Value(value: string) {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map(Number);
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return octets.reduce((result, part) => result * 256 + part, 0) >>> 0;
}

function normalizeIp(value: string) {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("::ffff:") ? trimmed.slice(7) : trimmed;
}

export function ipMatchesNetwork(ip: string, network: string) {
  const candidate = normalizeIp(ip);
  const rule = normalizeIp(network);
  if (!rule.includes("/")) return candidate === rule;

  const [base, prefixText] = rule.split("/");
  const candidateValue = ipv4Value(candidate);
  const baseValue = ipv4Value(base ?? "");
  const prefix = Number(prefixText);
  if (candidateValue === null || baseValue === null || !Number.isInteger(prefix)) {
    return false;
  }
  if (prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (candidateValue & mask) === (baseValue & mask);
}

/** Broadest network an admin may trust from the app (a /16 = 65,536 addresses). */
const MIN_TRUSTED_PREFIX = 16;

/**
 * Normalise admin input to canonical IPv4 CIDR text, or null when invalid.
 * Bare IPv4 becomes "/32". CIDRs must be /16 to /32; the host bits are
 * cleared so "10.1.2.3/24" is stored as "10.1.2.0/24". IPv6 is rejected.
 */
export function normalizeNetwork(input: string): string | null {
  if (typeof input !== "string") return null;
  const text = normalizeIp(input);
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})(?:\/(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const value = ipv4Value(match[1]!);
  if (value === null) return null;
  const prefix = match[2] === undefined ? 32 : Number(match[2]);
  if (prefix < MIN_TRUSTED_PREFIX || prefix > 32) return null;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  const network = (value & mask) >>> 0;
  const base = [network >>> 24, (network >>> 16) & 255, (network >>> 8) & 255, network & 255].join(".");
  return `${base}/${prefix}`;
}

export function isIpAllowed(ip: string | null, configuredNetworks: string | undefined) {
  if (!ip || !configuredNetworks?.trim()) return false;
  return configuredNetworks
    .split(",")
    .map((network) => network.trim())
    .filter(Boolean)
    .some((network) => ipMatchesNetwork(ip, network));
}

/**
 * Client IP behind a single trusted reverse proxy (Caddy).
 * Caddy *appends* the TCP peer to X-Forwarded-For. Taking [0] trusts
 * client-supplied / proxy junk; the last hop is what actually connected.
 */
export function clientIpFromHeaders(requestHeaders: Headers): string | null {
  const real = requestHeaders.get("x-real-ip")?.trim();
  if (real) return real;

  const forwarded = requestHeaders.get("x-forwarded-for");
  if (!forwarded) return null;
  const parts = forwarded
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.at(-1) ?? null;
}

