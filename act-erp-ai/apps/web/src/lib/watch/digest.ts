import type { Severity } from "./types";

export type DigestFinding = {
  severity: Severity;
  title: string;
  fixLink: string | null;
  firstSeenAt: Date;
};

export type DigestInput = {
  open: DigestFinding[];
  autoResolvedSinceYesterday: number;
  yesterdayHours: number;
  yesterdayPunches: number;
  periodTitle: string | null;
  daysToPeriodEnd: number | null;
  baseUrl: string;
};

const RANK: Record<Severity, number> = { CRITICAL: 0, WARN: 1, INFO: 2 };

/** Template-only daily digest. No generated prose. */
export function buildDigest(i: DigestInput): { subject: string; text: string } {
  const needs = i.open
    .filter((f) => f.severity !== "INFO")
    .sort(
      (a, b) =>
        RANK[a.severity] - RANK[b.severity] ||
        a.firstSeenAt.getTime() - b.firstSeenAt.getTime(),
    );
  const headline =
    needs.length === 0
      ? `All clear. ${i.autoResolvedSinceYesterday} resolved on their own.`
      : `${needs.length} need${needs.length === 1 ? "s" : ""} you, ${i.autoResolvedSinceYesterday} resolved on their own.`;
  const lines = [headline, ""];
  if (needs.length) {
    lines.push("Needs you:");
    for (const f of needs.slice(0, 10)) {
      lines.push(
        `- [${f.severity}] ${f.title}${f.fixLink ? ` ${i.baseUrl}${f.fixLink}` : ""}`,
      );
    }
    if (needs.length > 10) lines.push(`- ...and ${needs.length - 10} more`);
    lines.push("");
  }
  lines.push(
    `Yesterday: ${i.yesterdayPunches} punches, ${i.yesterdayHours.toFixed(1)} hours.`,
  );
  if (i.periodTitle) {
    const left =
      i.daysToPeriodEnd !== null
        ? `, ${Math.max(0, Math.ceil(i.daysToPeriodEnd))} day(s) left`
        : "";
    lines.push(`Pay period: ${i.periodTitle}${left}.`);
  }
  lines.push("", `${i.baseUrl}/admin/watch`);
  return { subject: headline, text: lines.join("\n") };
}
