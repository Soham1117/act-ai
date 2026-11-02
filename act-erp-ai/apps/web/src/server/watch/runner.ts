import { db } from "@/lib/db";
import { mergePolicy, type FindingDraft, type WatchPolicy } from "@/lib/watch/types";
import { sendDailyDigestIfDue } from "./digest";
import { ALL_JOBS } from "./jobs";

const POLICY_ID = "policy";
const STALE_RUN_MS = 10 * 60_000;

export async function loadPolicy(): Promise<WatchPolicy> {
  const row = await db.watchRuleConfig.findUnique({ where: { ruleId: POLICY_ID } });
  return mergePolicy(row?.params);
}

async function isEnabled(ruleId: string, defaultEnabled: boolean): Promise<boolean> {
  const row = await db.watchRuleConfig.findUnique({ where: { ruleId } });
  return row?.enabled ?? defaultEnabled;
}

export type WatchRunResult = {
  runId: string;
  skipped?: "already-running";
  created: number;
  updated: number;
  autoResolved: number;
  errors: Array<{ ruleId: string; message: string }>;
};

/**
 * Runs every enabled rule, stores findings, auto-resolves the ones that are no
 * longer true. Read-only with respect to everything except Watch tables.
 */
export async function runWatch(opts: { trigger: "SCHEDULE" | "MANUAL"; shadow?: boolean; now?: Date }): Promise<WatchRunResult> {
  const now = opts.now ?? new Date();
  const running = await db.watchRun.findFirst({
    where: { finishedAt: null, startedAt: { gt: new Date(now.getTime() - STALE_RUN_MS) } },
  });
  if (running) {
    return { runId: running.id, skipped: "already-running", created: 0, updated: 0, autoResolved: 0, errors: [] };
  }
  const run = await db.watchRun.create({ data: { trigger: opts.trigger, shadow: opts.shadow ?? true } });
  const policy = await loadPolicy();
  const errors: WatchRunResult["errors"] = [];
  const rulesRun: string[] = [];
  let created = 0;
  let updated = 0;
  let autoResolved = 0;

  for (const job of ALL_JOBS) {
    if (!(await isEnabled(job.id, job.defaultEnabled ?? true))) {
      // Switched off: clear anything it raised earlier so the list does not keep stale flags.
      const cleared = await storeFindings(job.id, [], now);
      autoResolved += cleared.autoResolved;
      continue;
    }
    try {
      const drafts = await job.run({ now, policy });
      rulesRun.push(job.id);
      const counts = await storeFindings(job.id, drafts, now);
      created += counts.created;
      updated += counts.updated;
      autoResolved += counts.autoResolved;
    } catch (err) {
      errors.push({ ruleId: job.id, message: (err instanceof Error ? err.message : String(err)).slice(0, 500) });
    }
  }

  if (opts.trigger === "SCHEDULE") {
    try {
      const digest = await sendDailyDigestIfDue(now, policy);
      for (const e of digest.errors) errors.push({ ruleId: "digest", message: e });
    } catch (err) {
      errors.push({ ruleId: "digest", message: (err instanceof Error ? err.message : String(err)).slice(0, 500) });
    }
  }

  await db.watchRun.update({
    where: { id: run.id },
    data: { finishedAt: new Date(), created, updated, autoResolved, rulesRun, errors },
  });
  return { runId: run.id, created, updated, autoResolved, errors };
}

async function storeFindings(ruleId: string, drafts: FindingDraft[], now: Date) {
  let created = 0;
  let updated = 0;
  const seen = new Set<string>();
  for (const d of drafts) {
    seen.add(d.fingerprint);
    const existing = await db.watchFinding.findUnique({ where: { fingerprint: d.fingerprint } });
    const content = {
      severity: d.severity,
      title: d.title,
      detail: d.detail,
      likelyCause: d.likelyCause ?? null,
      suggestedFix: d.suggestedFix ?? null,
      fixLink: d.fixLink ?? null,
      evidence: d.evidence as object,
      lastSeenAt: now,
    };
    if (!existing) {
      await db.watchFinding.create({
        data: {
          ruleId,
          fingerprint: d.fingerprint,
          subjectType: d.subjectType,
          subjectId: d.subjectId,
          employeeId: d.employeeId ?? null,
          firstSeenAt: now,
          ...content,
        },
      });
      created++;
      continue;
    }
    // Dismissed stays dismissed. Resolved reopens (the problem came back).
    // Snoozed stays quiet until snoozeUntil passes.
    let status = existing.status;
    if (status === "RESOLVED") status = "OPEN";
    if (status === "SNOOZED" && existing.snoozeUntil && existing.snoozeUntil <= now) status = "OPEN";
    await db.watchFinding.update({
      where: { id: existing.id },
      data: { ...content, status, resolvedAt: status === "OPEN" ? null : existing.resolvedAt },
    });
    updated++;
  }
  const stale = await db.watchFinding.updateMany({
    where: {
      ruleId,
      status: { in: ["OPEN", "ACKNOWLEDGED", "SNOOZED"] },
      fingerprint: { notIn: [...seen] },
    },
    data: { status: "RESOLVED", resolvedAt: now },
  });
  return { created, updated, autoResolved: stale.count };
}
