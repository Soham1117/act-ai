"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin, requireWritableUser } from "@/lib/auth";
import { ok, failFromUnknown, type ActionResult } from "@/lib/action-result";
import { assertChecklistOwner, assertEvidenceOwner, canAssignTemplate, handbookReceiptText } from "@/lib/onboarding-checklist";

function refresh() {
  revalidatePath("/admin/onboarding/checklists");
  revalidatePath("/dashboard/onboarding");
}

const assignSchema = z.object({
  employeeId: z.string().min(1).optional(), inviteId: z.string().min(1).optional(),
  versionId: z.string().min(1), required: z.boolean().default(true),
}).refine((data) => Boolean(data.employeeId) !== Boolean(data.inviteId), "Choose one employee or one open invite.");

export async function assignOnboardingTemplate(input: z.input<typeof assignSchema>): Promise<ActionResult<{ id: string }>> {
  const actor = await requireAdmin();
  try {
    const data = assignSchema.parse(input);
    const id = await db.$transaction(async (tx) => {
      const owner = data.employeeId ? `employee:${data.employeeId}` : `invite:${data.inviteId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`onboarding-owner:${owner}`}))`;
      if (data.employeeId) {
        if (!await tx.employee.findUnique({ where: { id: data.employeeId }, select: { id: true } })) throw new Error("That employee no longer exists.");
      } else {
        const invite = await tx.onboardingInvite.findUnique({ where: { id: data.inviteId } });
        if (!invite || invite.status !== "PENDING" || invite.expiresAt <= new Date()) throw new Error("Choose an unexpired, unused invite.");
      }
      const version = await tx.companyDocumentVersion.findUnique({ where: { id: data.versionId }, include: { document: true } });
      if (!version || !canAssignTemplate(version)) throw new Error("Choose an approved, active onboarding template.");
      const existing = await tx.onboardingChecklistItem.findFirst({ where: {
        versionId: data.versionId, ...(data.employeeId ? { employeeId: data.employeeId } : { inviteId: data.inviteId }),
      } });
      if (existing) return existing.id;
      const item = await tx.onboardingChecklistItem.create({ data: {
        employeeId: data.employeeId ?? null, inviteId: data.inviteId ?? null, versionId: version.id,
        title: version.document.title, itemType: version.document.category === "HANDBOOK" ? "HANDBOOK" : "FORM", required: data.required,
      } });
      await tx.auditLog.create({ data: { actorId: actor.id, actorEmail: actor.email, action: "onboarding.checklist.assign", resource: `OnboardingChecklistItem:${item.id}`, diff: { owner, versionId: version.id, required: data.required } } });
      return item.id;
    });
    refresh();
    return ok({ id });
  } catch (error) { return failFromUnknown(error); }
}

const submitSchema = z.object({ id: z.string().min(1), documentId: z.string().min(1), notes: z.string().trim().max(1000).default("") });

export async function submitChecklistDocument(input: z.input<typeof submitSchema>): Promise<ActionResult> {
  try {
    const actor = await requireWritableUser();
    const data = submitSchema.parse(input);
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`onboarding-item:${data.id}`}))`;
      const item = await tx.onboardingChecklistItem.findUnique({ where: { id: data.id }, include: { version: { include: { document: true } } } });
      if (!item) throw new Error("That checklist item no longer exists.");
      assertChecklistOwner(item, actor.employeeId);
      if (item.itemType !== "FORM") throw new Error("Use the handbook acknowledgment for this item.");
      if (!canAssignTemplate(item.version)) throw new Error("This template is unavailable. Please ask HR for the current version.");
      if (item.status === "ACCEPTED" || item.status === "NOT_APPLICABLE") throw new Error("HR has already reviewed this item. Contact HR for a correction.");
      const document = await tx.document.findUnique({ where: { id: data.documentId }, select: { employeeId: true } });
      assertEvidenceOwner(document, item.employeeId);
      if (item.status === "SUBMITTED" && item.submittedDocumentId === data.documentId && item.employeeNotes === data.notes) return;
      await tx.onboardingChecklistItem.update({ where: { id: item.id }, data: { status: "SUBMITTED", submittedDocumentId: data.documentId, employeeNotes: data.notes, reviewedAt: null, reviewedById: null, reviewNotes: null } });
      await tx.auditLog.create({ data: { actorId: actor.id, actorEmail: actor.email, action: "onboarding.checklist.submit", resource: `OnboardingChecklistItem:${item.id}`, diff: { documentId: data.documentId, versionId: item.versionId } } });
    });
    refresh(); return ok();
  } catch (error) { return failFromUnknown(error); }
}

const receiptSchema = z.object({ id: z.string().min(1), confirmed: z.literal(true), language: z.enum(["en", "es"]).default("en") });

export async function acknowledgeHandbook(input: z.input<typeof receiptSchema>): Promise<ActionResult> {
  try {
    const actor = await requireWritableUser();
    const data = receiptSchema.parse(input);
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`onboarding-item:${data.id}`}))`;
      const item = await tx.onboardingChecklistItem.findUnique({ where: { id: data.id }, include: { acknowledgment: true, version: { include: { document: true } } } });
      if (!item) throw new Error("That checklist item no longer exists.");
      assertChecklistOwner(item, actor.employeeId);
      if (item.itemType !== "HANDBOOK" || !canAssignTemplate(item.version)) throw new Error("This handbook is unavailable. Please ask HR for the current version.");
      if (item.acknowledgment) return;
      if (item.status === "ACCEPTED" || item.status === "NOT_APPLICABLE") throw new Error("This item has already been reviewed by HR.");
      await tx.handbookAcknowledgment.create({ data: {
        checklistItemId: item.id, employeeId: item.employeeId!, versionId: item.versionId,
        acknowledgmentText: handbookReceiptText(item.title, item.version.version, data.language), method: "ELECTRONIC", actorId: actor.id,
      } });
      await tx.onboardingChecklistItem.update({ where: { id: item.id }, data: { status: "SUBMITTED", reviewedAt: null, reviewedById: null } });
      await tx.auditLog.create({ data: { actorId: actor.id, actorEmail: actor.email, action: "onboarding.handbook.acknowledge", resource: `OnboardingChecklistItem:${item.id}`, diff: { versionId: item.versionId, method: "ELECTRONIC" } } });
    });
    refresh(); return ok();
  } catch (error) { return failFromUnknown(error); }
}

const reviewSchema = z.object({
  id: z.string().min(1), expectedUpdatedAt: z.string().datetime(),
  decision: z.enum(["ACCEPTED", "NEEDS_CORRECTION", "NOT_APPLICABLE"]),
  reason: z.string().trim().min(3).max(1000), paperEvidenceDocumentId: z.string().min(1).optional(),
});

export async function reviewOnboardingItem(input: z.input<typeof reviewSchema>): Promise<ActionResult> {
  const actor = await requireAdmin();
  try {
    const data = reviewSchema.parse(input);
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`onboarding-item:${data.id}`}))`;
      const item = await tx.onboardingChecklistItem.findUnique({ where: { id: data.id }, include: { acknowledgment: true } });
      if (!item || !item.employeeId) throw new Error("Review is available after the employee has completed their invite.");
      if (item.updatedAt.toISOString() !== data.expectedUpdatedAt) throw new Error("This item changed. Refresh before reviewing it.");
      if (item.acknowledgment && data.decision === "NEEDS_CORRECTION") {
        throw new Error("This handbook receipt is permanent. Assign a new handbook version if a replacement acknowledgment is needed.");
      }
      if (data.decision === "ACCEPTED") {
        if (item.itemType === "HANDBOOK") {
          if (!item.acknowledgment) {
            if (!data.paperEvidenceDocumentId) throw new Error("The employee must acknowledge this handbook, or select their signed paper receipt.");
            assertEvidenceOwner(await tx.document.findUnique({ where: { id: data.paperEvidenceDocumentId }, select: { employeeId: true } }), item.employeeId);
            const version = await tx.companyDocumentVersion.findUniqueOrThrow({ where: { id: item.versionId } });
            await tx.handbookAcknowledgment.create({ data: { checklistItemId: item.id, employeeId: item.employeeId, versionId: item.versionId, acknowledgmentText: handbookReceiptText(item.title, version.version), method: "PAPER", evidenceDocumentId: data.paperEvidenceDocumentId, actorId: actor.id } });
          }
        } else {
          if (item.status !== "SUBMITTED" || !item.submittedDocumentId) throw new Error("An employee-owned completed document must be submitted before acceptance.");
          assertEvidenceOwner(await tx.document.findUnique({ where: { id: item.submittedDocumentId }, select: { employeeId: true } }), item.employeeId);
        }
      }
      await tx.onboardingChecklistItem.update({ where: { id: item.id }, data: { status: data.decision, reviewNotes: data.reason, reviewedById: actor.id, reviewedAt: new Date() } });
      await tx.auditLog.create({ data: { actorId: actor.id, actorEmail: actor.email, action: "onboarding.checklist.review", resource: `OnboardingChecklistItem:${item.id}`, diff: { before: item.status, after: data.decision, reason: data.reason, versionId: item.versionId } } });
    });
    refresh(); return ok();
  } catch (error) { return failFromUnknown(error); }
}
