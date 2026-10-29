import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { storedFileResponse } from "@/lib/file-response";
import { usableOnboardingVersion } from "@/lib/company-documents";

export const runtime = "nodejs";

export async function GET(req: Request, {params}: {params: Promise<{versionId: string}>}) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", {status: 401});
  const {versionId} = await params;
  const version = await db.companyDocumentVersion.findUnique({where: {id: versionId}, include: {document: true}});
  if (!version) return new Response("Not found", {status: 404});
  if (user.role !== "ADMIN") {
    if (!user.employeeId || !usableOnboardingVersion(version)) return new Response("Not found", {status: 404});
    const assigned = await db.onboardingChecklistItem.findFirst({where: {employeeId: user.employeeId, versionId}, select: {id: true}});
    if (!assigned) return new Response("Not found", {status: 404});
  }
  await db.auditLog.create({data: {actorId: user.id, actorEmail: user.email, action: "company.document.download", resource: `CompanyDocumentVersion:${versionId}`}});
  return storedFileResponse({req, key: `documents/${version.fileName}`, title: version.document.title, storedName: version.originalName, fileType: version.fileType});
}
