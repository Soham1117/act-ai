/**
 * Shared formatters — kept dumb so they're safe in both server + client.
 */

export function formatCurrency(
  amount: number | string | null | undefined,
  currency = "USD",
) {
  if (amount === null || amount === undefined) return "—";
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(n);
}

export function formatHours(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

export function formatPhone(phone: string | null | undefined) {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10)
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return phone;
}

export function maskSSN(ssn: string | null | undefined) {
  if (!ssn) return "—";
  const cleaned = ssn.replace(/\D/g, "");
  if (cleaned.length !== 9) return "***-**-****";
  return `***-**-${cleaned.slice(-4)}`;
}

export function getInitials(name: string | null | undefined) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

/** DiceBear `personas` avatar URL seeded by email — locked design choice. */
export function getAvatarUrl(seed: string | null | undefined) {
  const safe = encodeURIComponent(seed ?? "anonymous");
  return `https://api.dicebear.com/9.x/personas/svg?seed=${safe}&backgroundType=solid&backgroundColor=10b981,059669,047857,065f46`;
}
