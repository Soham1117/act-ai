"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { uploadFile } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";
import { claimAndProcessHirePacketJob } from "@/lib/hire-packet/process-job";
import { MAX_HIRE_ZIP_BYTES } from "@/lib/hire-packet/types";
import type { HirePacketProposals } from "@/lib/hire-packet/types";
import { updateEmployee } from "@/server/actions/employees";

export async function uploadHirePacketZip(
  employeeId: string,
  file: { name: string; bytes: ArrayBuffer },
): Promise<ActionResult<{ jobId: string }>> {
  const admin = await requireAdmin();
  try {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      return fail("Upload a .zip file containing onboarding PDFs or images.");
    }
    if (file.bytes.byteLength > MAX_HIRE_ZIP_BYTES) {
      return fail(`Zip must be under ${MAX_HIRE_ZIP_BYTES / (1024 * 1024)} MB.`);
    }

    const employee = await db.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
    if (!employee) {
      return fail("That employee was not found. Refresh the page and try again.");
    }

    const job = await db.hirePacketImport.create({
      data: {
        employeeId,
        uploadedById: admin.id,
        status: "PENDING",
        zipFileName: file.name,
        zipStorageKey: "pending",
      },
    });

    const storagePath = `hire-packets/${job.id}/${file.name}`;
    await uploadFile("documents", storagePath, file.bytes, { contentType: "application/zip" });
    await db.hirePacketImport.update({
      where: { id: job.id },
      data: { zipStorageKey: storagePath },
    });

    await audit({
      action: "hire_packet.upload",
      resource: `HirePacketImport:${job.id}`,
      diff: { employeeId, zipFileName: file.name },
    });

    after(async () => {
      try {
        await claimAndProcessHirePacketJob(job.id);
      } catch (err) {
        console.error("hire-packet process failed:", job.id, err);
      }
    });

    revalidatePath(`/admin/employees/${employeeId}`);
    return ok({ jobId: job.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

export async function getHirePacketImportStatus(
  jobId: string,
): Promise<
  ActionResult<{
    status: string;
    errorMessage: string | null;
    proposedFields: HirePacketProposals | null;
    fileResults: unknown;
    employeeId: string;
  }>
> {
  await requireAdmin();
  try {
    let job = await db.hirePacketImport.findUnique({ where: { id: jobId } });
    if (!job) return fail("That import job was not found. Refresh the page.");

    if (job.status === "PENDING") {
      await claimAndProcessHirePacketJob(jobId);
      job = await db.hirePacketImport.findUnique({ where: { id: jobId } });
    }

    if (!job) return fail("That import job was not found. Refresh the page.");

    return ok({
      status: job.status,
      errorMessage: job.errorMessage,
      proposedFields: (job.proposedFields as HirePacketProposals | null) ?? null,
      fileResults: job.fileResults,
      employeeId: job.employeeId,
    });
  } catch (err) {
    return failFromUnknown(err);
  }
}

const applySchema = z.object({
  jobId: z.string(),
  /** Employee field keys the admin checked in the review UI. */
  selectedFields: z.array(z.string()).min(1),
});

export async function applyHirePacketImport(
  input: z.infer<typeof applySchema>,
): Promise<ActionResult> {
  await requireAdmin();
  try {
    const { jobId, selectedFields } = applySchema.parse(input);
    const job = await db.hirePacketImport.findUnique({ where: { id: jobId } });
    if (!job) return fail("That import job was not found.");
    if (job.status !== "READY") {
      return fail("This import is not ready to apply. Wait for processing to finish or start a new import.");
    }

    const proposals = (job.proposedFields as HirePacketProposals | null) ?? {};
    const payload: Record<string, unknown> = {};

    for (const key of selectedFields) {
      const proposal = proposals[key as keyof HirePacketProposals];
      if (!proposal?.value) continue;
      payload[key] = proposal.value;
    }

    if (Object.keys(payload).length === 0) {
      return fail("Select at least one field with a proposed value to apply.");
    }

    const res = await updateEmployee(job.employeeId, payload);
    if (!res.ok) return res;

    await db.hirePacketImport.update({
      where: { id: jobId },
      data: { status: "APPLIED", appliedAt: new Date() },
    });
    await audit({
      action: "hire_packet.apply",
      resource: `HirePacketImport:${jobId}`,
      diff: { fields: Object.keys(payload) },
    });

    revalidatePath(`/admin/employees/${job.employeeId}`);
    revalidatePath(`/admin/employees/${job.employeeId}/hire-import/${jobId}`);
    revalidatePath("/dashboard/documents");
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}

export async function cancelHirePacketImport(jobId: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    const job = await db.hirePacketImport.findUnique({ where: { id: jobId } });
    if (!job) return fail("That import job was not found.");
    if (job.status === "APPLIED") {
      return fail("This import was already applied and cannot be cancelled.");
    }
    await db.hirePacketImport.update({
      where: { id: jobId },
      data: { status: "CANCELLED" },
    });
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}
