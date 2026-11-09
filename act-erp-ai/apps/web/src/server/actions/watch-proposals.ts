"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { failFromUnknown } from "@/lib/action-result";
import { revalidateTimePages } from "@/server/time-core";
import { createProposal, decideProposal } from "@/server/watch/proposals";

export async function createClockOutProposal(input: { findingId: string; reason: string }) {
  const actor = await requireAdmin();
  try {
    const data = z.object({ findingId: z.string().min(1), reason: z.string().trim().min(3, "Enter a reason of at least 3 characters.").max(500) }).parse(input);
    const result = await createProposal(actor, data);
    revalidatePath("/admin/watch");
    revalidatePath("/admin/watch/proposals");
    return result;
  } catch (error) { return failFromUnknown(error); }
}

export async function decideClockOutProposal(input: { id: string; action: "APPROVE" | "REJECT" | "UNDO"; confirmedActualEnd?: boolean }) {
  const actor = await requireAdmin();
  try {
    const data = z.object({ id: z.string().min(1), action: z.enum(["APPROVE", "REJECT", "UNDO"]), confirmedActualEnd: z.boolean().optional() }).parse(input);
    const result = await decideProposal(actor, data);
    revalidatePath("/admin/watch");
    revalidatePath("/admin/watch/proposals");
    if (result.ok && data.action !== "REJECT") revalidateTimePages();
    return result;
  } catch (error) { return failFromUnknown(error); }
}
