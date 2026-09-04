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

/**
 * Live-format a money text field as the user types (thousands commas,
 * optional cents). Strips currency symbols and letters. Keeps a trailing
 * "." so typing "60,000." → cents still works.
 */
export function formatMoneyInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  if (!cleaned) return "";

  const dot = cleaned.indexOf(".");
  const intRaw = dot === -1 ? cleaned : cleaned.slice(0, dot);
  const decRaw =
    dot === -1
      ? null
      : cleaned
          .slice(dot + 1)
          .replace(/\./g, "")
          .slice(0, 2);
  const intPart = intRaw.replace(/^0+(?=\d)/, "") || (decRaw !== null ? "0" : "");
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  if (dot === -1) return withCommas;
  return `${withCommas}.${decRaw ?? ""}`;
}

/** Parse a comma-formatted money string to a number, or null if empty/invalid. */
export function parseMoneyInput(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  if (!cleaned || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function formatHours(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

/** Business timezone used for schedules, punches, and kiosk displays. */
export const BUSINESS_TIME_ZONE = "America/Chicago";

export function formatBusinessTime(date: Date | string | null | undefined) {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Convert an instant to the UTC-midnight value for its Central calendar day. */
export function businessDateOnly(date: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return new Date(Date.UTC(value("year"), value("month") - 1, value("day")));
}

export function formatPhone(phone: string | null | undefined) {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10)
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return phone;
}

/**
 * Render the stored last-4 of an SSN. We never hold the full number, so this
 * is presentation only — there is nothing here to mask.
 */
export function formatSSNLast4(last4: string | null | undefined) {
  if (!last4) return "—";
  const cleaned = last4.replace(/\D/g, "");
  if (cleaned.length !== 4) return "—";
  return `•••-••-${cleaned}`;
}

/**
 * Format a Postgres `@db.Date` column. These come back from Prisma as a JS
 * `Date` at UTC midnight — `toLocaleDateString()` without a timezone renders
 * in the *local* zone, so anywhere west of UTC (all of the US) shows the
 * previous day. A coverage effective date of Jan 1 rendering as Dec 31 reads
 * as a legal error. Always use this (never the bare `Date`) for a
 * `@db.Date` value; datetime columns like `createdAt` are unaffected and
 * should keep using `toLocaleDateString()` directly.
 */
export function formatDateOnly(date: Date | string | null | undefined) {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
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
