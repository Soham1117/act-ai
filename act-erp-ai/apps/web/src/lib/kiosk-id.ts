/**
 * Parse what someone typed or scanned at the kiosk into a lookup plan. The
 * year segment of employee IDs (EMP-2026-0001) must never be hardcoded, so
 * accept either a full ID or just the trailing digits.
 */
export type KioskIdInput =
  | { kind: "empty" }
  | { kind: "full"; id: string }
  | { kind: "digits"; digits: string; padded: string };

export function parseKioskIdInput(raw: string): KioskIdInput {
  const v = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!v) return { kind: "empty" };
  if (/^\d+$/.test(v)) {
    return { kind: "digits", digits: v, padded: v.padStart(4, "0") };
  }
  // Nothing but a prefix typed so far ("EMP-", "EMP-2026-").
  if (/^[A-Z]+-(\d{4}-)?$/.test(v)) return { kind: "empty" };
  return { kind: "full", id: v };
}
