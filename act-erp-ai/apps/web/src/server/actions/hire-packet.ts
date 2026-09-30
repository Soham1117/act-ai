"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { uploadFile, deleteFile } from "@/lib/storage";
import { validateUpload } from "@/lib/upload-validation";
import { audit } from "@/lib/audit";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";
import { claimAndProcessHirePacketJob } from "@/lib/hire-packet/process-job";
import { HIRE_JOB_STALE_MS, type HirePacketProposals } from "@/lib/hire-packet/types";
import { updateEmployee } from "@/server/actions/employees";

export async function uploadHirePacketZip(
  employeeId: string,
  file: { name: string; bytes: ArrayBuffer },
): Promise<ActionResult<{ jobId: string }>> {
  const admin = await requireAdmin();
  let jobId: string | null = null;
  let storagePath: string | null = null;
  try {
    // Extension allowlist + ZIP magic bytes + size cap, server-side.
    const v = validateUpload("zip", { name: file.name, bytes: file.bytes });
    if (!v.ok) return fail(v.error);

    const employee = await db.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
    if (!employee) {
      return fail("That employee was not found. Refresh the page and try again.");
    }

    const job = await db.hirePacketImport.create({
      data: {
        employeeId,
        uploadedById: admin.id,
        status: "PENDING",
        zipFileName: v.safeFileName,
        zipStorageKey: "pending",
      },
    });
    jobId = job.id;

    storagePath = `hire-packets/${job.id}/${v.safeFileName}`;
    await uploadFile("documents", storagePath, file.bytes, { contentType: v.contentType });
    await db.hirePacketImport.update({
      where: { id: job.id },
      data: { zipStorageKey: storagePath },
    });

    await audit({
      action: "hire_packet.upload",
      resource: `HirePacketImport:${job.id}`,
      diff: { employeeId, zipFileName: v.safeFileName },
    });

    const id = job.id;
    after(async () => {
      try {
        await claimAndProcessHirePacketJob(id);
      } catch (err) {
        console.error("hire-packet process failed:", id, err);
      }
    });

    revalidatePath(`/admin/employees/${employeeId}`);
    return ok({ jobId: job.id });
  } catch (err) {
    // Don't leave a PENDING job pointing at a zip that never uploaded.
    if (jobId) {
      await db.hirePacketImport.delete({ where: { id: jobId } }).catch(() => undefined);
    }
    if (storagePath) await deleteFile("documents", storagePath).catch(() => undefined);
    return failFromUnknown(err);
  }
}

/**
 * Retry a FAILED import (or one stuck in PROCESSING with no progress). Resets
 * it to PENDING and reprocesses in the background. Documents created by the
 * earlier attempt are cleaned up before the rerun.
 */
export async function retryHirePacketImport(jobId: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    const job = await db.hirePacketImport.findUnique({ where: { id: jobId } });
    if (!job) return fail("That import job was not found. Refresh the page.");
    if (job.zipStorageKey === "pending") {
      return fail("The zip never finished uploading. Upload it again from the employee page.");
    }
    const reset = await db.hirePacketImport.updateMany({
      where: {
        id: jobId,
        OR: [
          { status: "FAILED" },
          // Stuck: no heartbeat for the stale window.
          { status: "PROCESSING", updatedAt: { lt: new Date(Date.now() - HIRE_JOB_STALE_MS) } },
        ],
      },
      data: { status: "PENDING", errorMessage: null },
    });
    if (reset.count === 0) {
      return fail("This import can't be retried right now (it is running, finished, or cancelled).");
    }
    await audit({ action: "hire_packet.retry", resource: `HirePacketImport:${jobId}` });
    after(async () => {
      try {
        await claimAndProcessHirePacketJob(jobId);
      } catch (err) {
        console.error("hire-packet retry failed:", jobId, err);
      }
    });
    revalidatePath(`/admin/employees/${job.employeeId}/hire-import/${jobId}`);
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}

export async function getHirePacketImportStatus(
  jobId: string,
): Promise<
  ActionResult<{
    status: string;
    stuck: boolean;
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

    // PENDING, or PROCESSING with no heartbeat (worker died): (re)claim and
    // run. A fresh PROCESSING job is left alone (claim fails fast).
    if (job.status === "PENDING" || job.status === "PROCESSING") {
      try {
        await claimAndProcessHirePacketJob(jobId);
      } catch {
        // processHirePacketJob already recorded FAILED + the message.
      }
      job = await db.hirePacketImport.findUnique({ where: { id: jobId } });
    }

    if (!job) return fail("That import job was not found. Refresh the page.");

    const stuck =
      job.status === "PROCESSING" &&
      Date.now() - job.updatedAt.getTime() > HIRE_JOB_STALE_MS;
    return ok({
      status: job.status,
      stuck,
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
