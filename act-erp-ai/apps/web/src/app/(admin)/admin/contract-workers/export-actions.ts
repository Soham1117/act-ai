"use server";

import { requireAdmin } from "@/lib/auth";
import { fail, failFromUnknown, ok, type ActionResult } from "@/lib/action-result";
import { parseDateOnly } from "@/lib/time-rules";
import { contractHoursCsv } from "@/server/queries/contract-workers";

/** Hours CSV for the invoice check. Admin only. Dates are `YYYY-MM-DD`, inclusive. */
export async function exportContractHoursCsv(input: {
  from: string;
  to: string;
  agencyId?: string;
}): Promise<ActionResult<{ csv: string }>> {
  await requireAdmin();
  try {
    const from = parseDateOnly(input.from);
    const to = parseDateOnly(input.to);
    if (!from || !to) return fail("Choose a valid date range.");
    const csv = await contractHoursCsv({
      from,
      to,
      agencyId: input.agencyId || undefined,
    });
    return ok({ csv });
  } catch (err) {
    return failFromUnknown(err);
  }
}
