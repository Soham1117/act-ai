"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { failFromUnknown, fail, ok, type ActionResult } from "@/lib/action-result";
import { applyAction, FINDING_ACTIONS } from "@/lib/watch/status";
import { runWatch } from "@/server/watch/runner";

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
