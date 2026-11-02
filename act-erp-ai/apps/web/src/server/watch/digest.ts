import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sendPlainEmail } from "@/lib/email";
import { notifyEmployees } from "@/lib/notify";
import { dateToBusinessLocal, parseDateOnly } from "@/lib/time-rules";
import { buildDigest } from "@/lib/watch/digest";
import type { WatchPolicy } from "@/lib/watch/types";
import { currentPeriod, DAY_MS } from "./context";

const businessToday = (now: Date) => parseDateOnly(dateToBusinessLocal(now).slice(0, 10)) ?? new Date(0);

/** Everything the digest says, read from the database. */
export async function composeDigest(now: Date) {
  const today = businessToday(now);
  const yesterday = new Date(today.getTime() - DAY_MS);
  const [open, cleared, entries, period] = await Promise.all([
    db.watchFinding.findMany({
      where: { status: { in: ["OPEN", "ACKNOWLEDGED"] }, severity: { not: "INFO" }, ruleId: { not: { startsWith: "report." } } },
      select: { severity: true, title: true, fixLink: true, firstSeenAt: true },
    }),
    db.watchFinding.count({ where: { resolvedAt: { gte: new Date(now.getTime() - DAY_MS) }, ruleId: { not: { startsWith: "report." } } } }),
    db.timeEntry.aggregate({ where: { date: yesterday }, _count: { _all: true }, _sum: { totalWorkMin: true } }),
    currentPeriod(),
  ]);
  return buildDigest({
    open,
    autoResolvedSinceYesterday: cleared,
    yesterdayHours: (entries._sum.totalWorkMin ?? 0) / 60,
    yesterdayPunches: entries._count._all,
    periodTitle: period?.title ?? null,
    daysToPeriodEnd: period ? (period.payPeriodEnd.getTime() + DAY_MS - now.getTime()) / DAY_MS : null,
    baseUrl: env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, ""),
  });
}

async function employeeIdsForEmails(emails: string[]): Promise<string[]> {
  const rows = await db.employee.findMany({
    where: {
      employmentStatus: "ACTIVE",
      OR: [
        { email: { in: emails, mode: "insensitive" } },
        { user: { email: { in: emails, mode: "insensitive" } } },
      ],
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export type DigestSendResult = { sent: boolean; reason?: "not-yet" | "already-sent"; emailed: number; notified: number; errors: string[] };

/**
 * Sends the daily digest once per business day, at or after the configured hour (Central).
 * The unique row in WatchDigest is claimed first, so two runs can never send twice.
 */
export async function sendDailyDigestIfDue(now: Date, policy: WatchPolicy): Promise<DigestSendResult> {
  const hour = Number(dateToBusinessLocal(now).slice(11, 13));
  if (hour < policy.digestHourLocal) return { sent: false, reason: "not-yet", emailed: 0, notified: 0, errors: [] };
  const forDate = businessToday(now);
  try {
    await db.watchDigest.create({ data: { forDate } });
  } catch {
    return { sent: false, reason: "already-sent", emailed: 0, notified: 0, errors: [] };
  }
  const digest = await composeDigest(now);
  const errors: string[] = [];
  const ids = await employeeIdsForEmails(policy.digestRecipientEmails);
  await notifyEmployees(ids, {
    type: "SYSTEM",
    title: digest.subject,
    message: digest.text,
    link: "/admin/watch",
    priority: digest.subject.startsWith("All clear") ? "LOW" : "MEDIUM",
  });
  let emailed = 0;
  for (const to of policy.digestRecipientEmails) {
    try {
      await sendPlainEmail(to, `Persona Watch: ${digest.subject}`, digest.text);
      emailed++;
    } catch (e) {
      errors.push(`${to}: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
    }
  }
  await db.watchDigest.update({
    where: { forDate },
    data: { recipientCount: emailed, summary: { subject: digest.subject, notified: ids.length, errors } },
  });
  return { sent: true, emailed, notified: ids.length, errors };
}
