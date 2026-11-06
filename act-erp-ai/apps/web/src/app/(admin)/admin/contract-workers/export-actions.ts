"use server";

import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { fail, failFromUnknown, ok, type ActionResult } from "@/lib/action-result";
import { parseDateOnly } from "@/lib/time-rules";
import { contractHoursWorkbook } from "@/server/queries/contract-workers";

/** Hours workbook for the invoice check. Admin only. Dates are `YYYY-MM-DD`, inclusive. */
export async function exportContractHoursWorkbook(input: {
  from: string;
  to: string;
  agencyId?: string;
  workerId?: string;
}): Promise<ActionResult<{ xlsx: string | null; filename: string }>> {
  const actor = await requireAdmin();
  try {
    const from = parseDateOnly(input.from);
    const to = parseDateOnly(input.to);
    if (!from || !to || from > to) return fail("Choose a valid date range.");
    const worker = input.workerId ? await db.contractWorker.findUnique({ where: { id: input.workerId }, select: { workerId: true } }) : null;
    if (input.workerId && !worker) return fail("That contract worker no longer exists.");
    const workbook = await contractHoursWorkbook({
      from,
      to,
      agencyId: input.agencyId || undefined,
      workerId: input.workerId || undefined,
    });
    if (workbook) await audit({ action: "hours.contract_export", resource: input.workerId ? `ContractWorker:${input.workerId}` : "ContractHours", actor, diff: { from: input.from, to: input.to, agencyId: input.agencyId ?? null, bytes: workbook.length } });
    return ok({ xlsx: workbook?.toString("base64") ?? null, filename: `contract-hours-${worker ? `${worker.workerId}-` : ""}${input.from}-to-${input.to}.xlsx` });
  } catch (err) {
    return failFromUnknown(err);
  }
}
