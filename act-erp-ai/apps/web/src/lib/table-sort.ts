/**
 * Sorting for table cells shown as text: money, percentages, durations,
 * dates, times and plain words. Pure, so it can be tested without a browser.
 */

export type SortKey = { kind: "empty" } | { kind: "num"; value: number } | { kind: "text"; value: string };

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";

/** "6:40" -> 400, "-1446:00" -> -86760, "1:02:30" -> 62.5 (minutes). */
function duration(s: string): number | null {
  const m = /^(-?)(\d+):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return null;
  const v = Number(m[2]) * 60 + Number(m[3]) + (m[4] ? Number(m[4]) / 60 : 0);
  return m[1] ? -v : v;
}

/** "07:00 AM" -> minutes since midnight */
function clock(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(s);
  if (!m) return null;
  return (Number(m[1]) % 12) * 60 + Number(m[2]) + (m[3]!.toLowerCase() === "pm" ? 720 : 0);
}

function dateValue(s: string): number | null {
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?:[ ,]+(\d{1,2}):(\d{2})\s*(am|pm)?)?/i.exec(s);
  if (us) {
    let y = Number(us[3]);
    if (y < 100) y += 2000;
    let h = us[4] ? Number(us[4]) % 12 : 0;
    if (us[6]?.toLowerCase() === "pm") h += 12;
    if (us[4] && !us[6]) h = Number(us[4]);
    return Date.UTC(y, Number(us[1]) - 1, Number(us[2]), h, us[5] ? Number(us[5]) : 0);
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const t = Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s);
    return Number.isNaN(t) ? null : t;
  }
  if (new RegExp(`^(${MONTHS})[a-z]*\\.? \\d{1,2},? \\d{4}`, "i").test(s)) {
    const t = Date.parse(`${s} UTC`);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/** "$1,234.50", "(12.5)", "45%", "8.5 h" -> number */
function plainNumber(s: string): number | null {
  const m = /^(\(?)([-+]?)\$?\s?([\d,]*\.?\d+)\)?\s?(%|h|hrs?|hours?)?$/i.exec(s);
  if (!m) return null;
  const n = Number(m[3]!.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return m[1] || m[2] === "-" ? -n : n;
}

export function sortKey(raw: string | null | undefined): SortKey {
  const s = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!s || s === "—" || s === "-" || s === "–") return { kind: "empty" };
  const n = clock(s) ?? duration(s) ?? dateValue(s) ?? plainNumber(s);
  if (n !== null) return { kind: "num", value: n };
  return { kind: "text", value: s.toLowerCase() };
}

/** Empty cells always sort last, whichever direction is chosen. */
export function compareKeys(a: SortKey, b: SortKey, dir: "asc" | "desc"): number {
  if (a.kind === "empty" || b.kind === "empty") {
    if (a.kind === b.kind) return 0;
    return a.kind === "empty" ? 1 : -1;
  }
  let c: number;
  if (a.kind === "num" && b.kind === "num") c = a.value - b.value;
  else {
    const as = a.kind === "num" ? String(a.value) : a.value;
    const bs = b.kind === "num" ? String(b.value) : b.value;
    c = as.localeCompare(bs, undefined, { numeric: true, sensitivity: "base" });
  }
  return dir === "asc" ? c : -c;
}
