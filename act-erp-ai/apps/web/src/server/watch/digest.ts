import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sendPlainEmail } from "@/lib/email";
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

export type DigestSendResult = { sent: boolean; reason?: "not-yet" | "already-sent" | "already-sending"; emailed: number; notified: number; errors: string[] };

type DeliveryProgress = {
  deliveryState: "sending" | "retry" | "sent";
  claimedAt: string;
  emailedTo: string[];
  notified: number;
  notificationSent: boolean;
};

function deliveryProgress(summary: unknown): DeliveryProgress | null {
  if (!summary || typeof summary !== "object") return null;
  const data = summary as Record<string, unknown>;
  if (!["sending", "retry", "sent"].includes(String(data.deliveryState))) return null;
  return {
    deliveryState: data.deliveryState as DeliveryProgress["deliveryState"],
    claimedAt: typeof data.claimedAt === "string" ? data.claimedAt : "",
    emailedTo: Array.isArray(data.emailedTo) ? data.emailedTo.filter((email): email is string => typeof email === "string") : [],
    notified: typeof data.notified === "number" ? data.notified : 0,
    notificationSent: data.notificationSent === true,
  };
}

/**
 * Sends the daily digest once per business day, at or after the configured hour (Central).
 * Claim delivery atomically and remember each successful recipient. Failed
 * channels retry on the next scheduled run without resending successful ones.
 */
export async function sendDailyDigestIfDue(now: Date, policy: WatchPolicy): Promise<DigestSendResult> {
  const hour = Number(dateToBusinessLocal(now).slice(11, 13));
  if (hour < policy.digestHourLocal) return { sent: false, reason: "not-yet", emailed: 0, notified: 0, errors: [] };
  const forDate = businessToday(now);
  const claim = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`watch-digest:${forDate.toISOString()}`}))`;
    const existing = await tx.watchDigest.findUnique({ where: { forDate } });
    const progress = deliveryProgress(existing?.summary);
    // Completed rows written before delivery tracking was introduced must not
    // resend when this release is deployed in the middle of a business day.
    if (existing && (!progress || progress.deliveryState === "sent")) return { reason: "already-sent" as const };
    if (progress?.deliveryState === "sending" && now.getTime() - Date.parse(progress.claimedAt) < 10 * 60_000) {
      return { reason: "already-sending" as const };
    }
    const state: DeliveryProgress = {
      deliveryState: "sending", claimedAt: now.toISOString(),
      emailedTo: progress?.emailedTo ?? [], notified: progress?.notified ?? 0,
      notificationSent: progress?.notificationSent ?? false,
    };
    await tx.watchDigest.upsert({
      where: { forDate },
      create: { forDate, summary: { ...state } },
      update: { summary: { ...state } },
    });
    return { state };
  });
  if (claim.reason) return { sent: false, reason: claim.reason, emailed: 0, notified: 0, errors: [] };
  const state = claim.state;
  const errors: string[] = [];
  let emailed = 0;
  let notified = 0;
  let subject = "";
  try {
    const digest = await composeDigest(now);
    subject = digest.subject;
    if (!state.notificationSent) {
      try {
        const ids = await employeeIdsForEmails(policy.digestRecipientEmails);
        // Save the notification and its delivery marker together. The generic
        // notify helper swallows failures, which would make them unretryable.
        await db.$transaction(async (tx) => {
          if (ids.length) await tx.notification.create({
            data: {
              type: "SYSTEM", title: digest.subject.slice(0, 200), message: digest.text,
              link: "/admin/watch", priority: digest.subject.startsWith("All clear") ? "LOW" : "MEDIUM",
              recipients: { createMany: { data: ids.map((employeeId) => ({ employeeId })), skipDuplicates: true } },
            },
          });
          await tx.watchDigest.update({
            where: { forDate },
            data: { summary: { ...state, notificationSent: true, notified: ids.length } },
          });
        });
        state.notificationSent = true;
        state.notified = ids.length;
        notified = ids.length;
      } catch (e) {
        errors.push(`In-app notification: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
      }
    }
    for (const to of new Set(policy.digestRecipientEmails.map((email) => email.toLowerCase()))) {
      if (state.emailedTo.includes(to)) continue;
      try {
        await sendPlainEmail(to, `Persona Watch: ${digest.subject}`, digest.text);
        state.emailedTo.push(to);
        emailed++;
      } catch (e) {
        errors.push(`${to}: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
        continue;
      }
      // Persist after each successful email, rather than only after the loop.
      await db.watchDigest.update({ where: { forDate }, data: { recipientCount: state.emailedTo.length, summary: { ...state, subject } } });
    }
  } catch (e) {
    errors.push(`Digest: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
  }
  state.deliveryState = errors.length ? "retry" : "sent";
  await db.watchDigest.update({
    where: { forDate },
    data: { ...(errors.length ? {} : { sentAt: now }), recipientCount: state.emailedTo.length, summary: { ...state, subject, errors } },
  });
  return { sent: true, emailed, notified, errors };
}
