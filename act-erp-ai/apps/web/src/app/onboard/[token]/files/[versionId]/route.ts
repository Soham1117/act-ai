import { db } from "@/lib/db";
import { storedFileResponse } from "@/lib/file-response";
import { usableOnboardingVersion } from "@/lib/company-documents";

export const runtime = "nodejs";

export async function GET(req: Request, {params}: {params: Promise<{token: string; versionId: string}>}) {
  const {token, versionId} = await params;
  const invite = await db.onboardingInvite.findUnique({where: {token}, select: {id: true, status: true, expiresAt: true}});
  if (!invite || invite.status !== "PENDING" || invite.expiresAt <= new Date()) return new Response("Not found", {status: 404});
  const assigned = await db.onboardingChecklistItem.findFirst({where: {inviteId: invite.id, versionId}, include: {version: {include: {document: true}}}});
  if (!assigned || !usableOnboardingVersion(assigned.version)) return new Response("Not found", {status: 404});
  await db.auditLog.create({data: {action: "company.document.invite_download", resource: `OnboardingChecklistItem:${assigned.id}`}});
  const v = assigned.version;
  return storedFileResponse({req, key: `documents/${v.fileName}`, title: v.document.title, storedName: v.originalName, fileType: v.fileType});
}
