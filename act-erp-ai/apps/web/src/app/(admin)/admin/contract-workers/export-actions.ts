"use server";

import { requireAdmin } from "@/lib/auth";
import { fail, failFromUnknown, ok, type ActionResult } from "@/lib/action-result";
import { parseDateOnly } from "@/lib/time-rules";
import { contractHoursWorkbook } from "@/server/queries/contract-workers";

/** Hours workbook for the invoice check. Admin only. Dates are `YYYY-MM-DD`, inclusive. */
export async function exportContractHoursWorkbook(input: {
  from: string;
  to: string;
  agencyId?: string;
}): Promise<ActionResult<{ xlsx: string | null }>> {
  await requireAdmin();
  try {
    const from = parseDateOnly(input.from);
    const to = parseDateOnly(input.to);
    if (!from || !to) return fail("Choose a valid date range.");
    const workbook = await contractHoursWorkbook({
      from,
      to,
      agencyId: input.agencyId || undefined,
    });
    return ok({ xlsx: workbook?.toString("base64") ?? null });
  } catch (err) {
    return failFromUnknown(err);
  }
}
