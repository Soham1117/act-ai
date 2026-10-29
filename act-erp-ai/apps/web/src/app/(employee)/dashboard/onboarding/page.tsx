import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getPortalLanguage } from "@/lib/portal-i18n/server";
import { PageHeader } from "@/components/page-header";
import { ChecklistItemPanel } from "@/components/onboarding-checklist-panel";
import { canAssignTemplate, checklistComplete } from "@/lib/onboarding-checklist";

export const metadata = { title: "Onboarding checklist" };

export default async function EmployeeOnboardingPage() {
  const user = await requireUser();
  const { locale } = await getPortalLanguage();
  const spanish = locale.startsWith("es");
  if (!user.employeeId) return <p>No employee profile is linked to this account.</p>;
  const [items, documents] = await Promise.all([
    db.onboardingChecklistItem.findMany({ where: { employeeId: user.employeeId }, include: { version: { include: { document: true } }, acknowledgment: true }, orderBy: { createdAt: "asc" } }),
    db.document.findMany({ where: { employeeId: user.employeeId }, select: { id: true, title: true }, orderBy: { uploadedAt: "desc" } }),
  ]);
  return <>
    <PageHeader title={spanish ? "Lista de incorporación" : "Onboarding checklist"} description={spanish ? "Envíe sus documentos y confirme el recibo del manual. RR. HH. revisa cada elemento." : "Submit your documents and acknowledge your handbook. HR reviews each item."} />
    <div className="mb-4 flex flex-wrap items-center gap-4 text-sm"><Link href="/dashboard/documents" className="text-primary hover:underline">{spanish ? "Cargar documentos completados" : "Upload completed documents"}</Link>
      <span className="text-muted-foreground">{checklistComplete(items) && items.length > 0 ? spanish ? "Elementos obligatorios revisados" : "Required items reviewed" : spanish ? "La lista no cambia el acceso a su cuenta" : "This checklist does not change your account access"}</span></div>
    {items.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">{spanish ? "RR. HH. no le ha asignado documentos de incorporación." : "HR has not assigned onboarding documents to you."}</p> : <div className="space-y-4">{items.map((item) => <ChecklistItemPanel key={`${item.id}:${item.updatedAt.toISOString()}`} spanish={spanish} readOnly={user.accessLevel !== "FULL"} item={{
      id: item.id, title: item.title, itemType: item.itemType, required: item.required, status: item.status,
      employeeId: item.employeeId, ownerLabel: user.name, versionId: item.versionId, versionNumber: item.version.version,
      templateAvailable: canAssignTemplate(item.version), updatedAt: item.updatedAt.toISOString(), reviewNotes: item.reviewNotes, submittedDocumentId: item.submittedDocumentId,
      acknowledgment: item.acknowledgment ? { method: item.acknowledgment.method, acceptedAt: item.acknowledgment.acceptedAt.toISOString() } : null, documents,
    }} />)}</div>}
  </>;
}
