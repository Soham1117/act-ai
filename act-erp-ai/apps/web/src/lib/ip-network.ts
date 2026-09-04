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

export function isIpAllowed(ip: string | null, configuredNetworks: string | undefined) {
  if (!ip || !configuredNetworks?.trim()) return false;
  return configuredNetworks
    .split(",")
    .map((network) => network.trim())
    .filter(Boolean)
    .some((network) => ipMatchesNetwork(ip, network));
}
