import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { ChecklistAssignment, ChecklistItemPanel } from "@/components/onboarding-checklist-panel";
import { canAssignTemplate, checklistComplete } from "@/lib/onboarding-checklist";

export const metadata = { title: "Onboarding checklists" };

export default async function OnboardingChecklistsPage({ searchParams }: { searchParams: Promise<{ employee?: string; invite?: string }> }) {
  await requireAdmin();
  const params = await searchParams;
  const filter = params.employee ? { employeeId: params.employee } : params.invite ? { inviteId: params.invite } : {};
  const [employees, invites, versions, items, documents] = await Promise.all([
    db.employee.findMany({ orderBy: { name: "asc" }, select: { id: true, employeeId: true, name: true } }),
    db.onboardingInvite.findMany({ where: { status: "PENDING", expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, select: { id: true, email: true } }),
    db.companyDocumentVersion.findMany({ where: { status: "APPROVED", purpose: "ONBOARDING_TEMPLATE", document: { isArchived: false, category: { in: ["ONBOARDING", "HANDBOOK"] } } }, include: { document: true }, orderBy: { createdAt: "desc" } }),
    db.onboardingChecklistItem.findMany({ where: filter, include: { version: { include: { document: true } }, acknowledgment: true }, orderBy: { createdAt: "desc" }, take: 300 }),
    db.document.findMany({ where: params.employee ? { employeeId: params.employee } : {}, select: { id: true, employeeId: true, title: true }, orderBy: { uploadedAt: "desc" } }),
  ]);
  const employeeMap = new Map(employees.map((entry) => [entry.id, entry]));
  const inviteMap = new Map(invites.map((entry) => [entry.id, entry]));
  const owner = params.employee ? `employee:${params.employee}` : params.invite ? `invite:${params.invite}` : "";
  return <>
    <PageHeader title="Onboarding checklists" description="Assign reviewed templates and track HR acceptance separately from account approval." />
    <div className="mb-4 flex flex-wrap items-center gap-4 text-sm"><Link href="/admin/onboarding" className="text-primary hover:underline">Back to onboarding</Link>
      {owner && <Link href="/admin/onboarding/checklists" className="text-primary hover:underline">Show all checklists</Link>}
      <span className="text-muted-foreground">{items.length} items shown · {checklistComplete(items) ? "Required items reviewed" : "Required items outstanding"}</span></div>
    <div className="space-y-4">
      <ChecklistAssignment initialOwner={owner} owners={[
        ...employees.map((entry) => ({ value: `employee:${entry.id}`, label: `${entry.name} (${entry.employeeId})` })),
        ...invites.map((entry) => ({ value: `invite:${entry.id}`, label: `Open invite: ${entry.email ?? entry.id}` })),
      ]} templates={versions.map((entry) => ({ id: entry.id, label: `${entry.document.title} · version ${entry.version}` }))} />
      {items.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No checklist items assigned yet.</p>}
      {items.map((item) => <ChecklistItemPanel key={`${item.id}:${item.updatedAt.toISOString()}`} admin item={{
        id: item.id, title: item.title, itemType: item.itemType, required: item.required, status: item.status,
        employeeId: item.employeeId, ownerLabel: item.employeeId ? employeeMap.get(item.employeeId)?.name ?? "Employee" : `Invite: ${inviteMap.get(item.inviteId ?? "")?.email ?? "unavailable"}`,
        versionId: item.versionId, versionNumber: item.version.version, templateAvailable: canAssignTemplate(item.version),
        updatedAt: item.updatedAt.toISOString(), reviewNotes: item.reviewNotes, submittedDocumentId: item.submittedDocumentId,
        acknowledgment: item.acknowledgment ? { method: item.acknowledgment.method, acceptedAt: item.acknowledgment.acceptedAt.toISOString() } : null,
        documents: documents.filter((document) => document.employeeId === item.employeeId).map((document) => ({ id: document.id, title: document.title })),
      }} />)}
    </div>
  </>;
}
