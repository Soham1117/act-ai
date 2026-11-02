"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { failFromUnknown, fail, ok, type ActionResult } from "@/lib/action-result";
import { applyAction, FINDING_ACTIONS } from "@/lib/watch/status";
import { parsePolicyForm } from "@/lib/watch/catalog";
import { ALL_JOBS } from "@/server/watch/jobs";
import { loadPolicy, runWatch } from "@/server/watch/runner";

const schema = z.object({
  id: z.string().min(1),
  action: z.enum(FINDING_ACTIONS as [string, ...string[]]),
  note: z.string().trim().max(500).optional(),
});

/** Acknowledge, snooze, dismiss or reopen one finding. Audited. */
export async function actOnFinding(input: z.input<typeof schema>): Promise<ActionResult> {
  const actor = await requireAdmin();
  try {
    const data = schema.parse(input);
    const finding = await db.watchFinding.findUnique({ where: { id: data.id } });
    if (!finding) return fail("That flag no longer exists.");
    const next = applyAction(finding.status, data.action as never, new Date());
    if (!next) return fail("That action doesn't apply to this flag any more. Refresh the page.");
    await db.$transaction([
      db.watchFinding.update({
        where: { id: finding.id },
        data: {
          status: next.status,
          snoozeUntil: next.snoozeUntil,
          handledById: actor.id,
          handledNote: data.note || null,
          resolvedAt: null,
        },
      }),
      db.auditLog.create({
        data: {
          actorId: actor.id,
          actorEmail: actor.email,
          action: `watch.finding.${data.action.toLowerCase()}`,
          resource: `WatchFinding:${finding.id}`,
          diff: { ruleId: finding.ruleId, from: finding.status, to: next.status, note: data.note ?? null },
        },
      }),
    ]);
    revalidatePath("/admin/watch");
    return ok();
  } catch (error) {
    return failFromUnknown(error);
  }
}

/** Switch one rule on or off. A rule that is off clears its own flags on the next check. */
export async function setRuleEnabled(input: { ruleId: string; enabled: boolean }): Promise<ActionResult> {
  const actor = await requireAdmin();
  try {
    const data = z.object({ ruleId: z.string().min(1).max(80), enabled: z.boolean() }).parse(input);
    if (data.ruleId === "policy" || !ALL_JOBS.some((j) => j.id === data.ruleId)) return fail("Unknown rule.");
    const before = await db.watchRuleConfig.findUnique({ where: { ruleId: data.ruleId } });
    await db.$transaction([
      db.watchRuleConfig.upsert({
        where: { ruleId: data.ruleId },
        create: { ruleId: data.ruleId, enabled: data.enabled, updatedById: actor.id },
        update: { enabled: data.enabled, updatedById: actor.id },
      }),
      db.auditLog.create({
        data: {
          actorId: actor.id,
          actorEmail: actor.email,
          action: "watch.rule.toggle",
          resource: `WatchRuleConfig:${data.ruleId}`,
          diff: { from: before?.enabled ?? null, to: data.enabled },
        },
      }),
    ]);
    revalidatePath("/admin/watch/rules");
    return ok();
  } catch (error) {
    return failFromUnknown(error);
  }
}

/** Save the editable company policy (thresholds, digest recipients). Audited with old and new values. */
export async function saveWatchPolicy(input: { numbers: Record<string, unknown>; recipients: string }): Promise<ActionResult> {
  const actor = await requireAdmin();
  try {
    const parsed = parsePolicyForm(z.object({ numbers: z.record(z.string(), z.unknown()), recipients: z.string().max(2000) }).parse(input));
    if (!parsed.ok) return fail(parsed.error);
    const before = await loadPolicy();
    await db.$transaction([
      db.watchRuleConfig.upsert({
        where: { ruleId: "policy" },
        create: { ruleId: "policy", enabled: true, params: parsed.policy, updatedById: actor.id },
        update: { params: parsed.policy, updatedById: actor.id },
      }),
      db.auditLog.create({
        data: {
          actorId: actor.id,
          actorEmail: actor.email,
          action: "watch.policy.save",
          resource: "WatchRuleConfig:policy",
          diff: { before, after: parsed.policy },
        },
      }),
    ]);
    revalidatePath("/admin/watch/rules");
    return ok();
  } catch (error) {
    return failFromUnknown(error);
  }
}

/** Run every rule now. Shadow mode: stores findings, sends nothing. */
export async function runWatchNow(): Promise<ActionResult<{ created: number; updated: number; autoResolved: number }>> {
  const actor = await requireAdmin();
  try {
    const result = await runWatch({ trigger: "MANUAL", shadow: true });
    if (result.skipped) return fail("A run is already in progress. Try again in a minute.");
    await db.auditLog.create({
      data: {
        actorId: actor.id,
        actorEmail: actor.email,
        action: "watch.run",
        resource: `WatchRun:${result.runId}`,
        diff: { created: result.created, updated: result.updated, autoResolved: result.autoResolved, errors: result.errors.length },
      },
    });
    revalidatePath("/admin/watch");
    return ok({ created: result.created, updated: result.updated, autoResolved: result.autoResolved });
  } catch (error) {
    return failFromUnknown(error);
  }
}
