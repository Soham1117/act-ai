"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { CHECKLIST_LABELS, handbookReceiptText } from "@/lib/onboarding-checklist";
import { acknowledgeHandbook, assignOnboardingTemplate, reviewOnboardingItem, submitChecklistDocument } from "@/server/actions/onboarding-checklist";
import { runAction, toastAction } from "@/lib/toast-action";

type FileOption = { id: string; title: string };
export type ChecklistItemView = {
  id: string; title: string; itemType: string; required: boolean; status: string;
  versionId: string; versionNumber: number; templateAvailable: boolean;
  employeeId: string | null; ownerLabel: string; updatedAt: string;
  reviewNotes: string | null; submittedDocumentId: string | null;
  acknowledgment: { method: string; acceptedAt: string } | null;
  documents: FileOption[];
};

const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

export function ChecklistAssignment({ owners, templates, initialOwner = "" }: {
  owners: Array<{ value: string; label: string }>;
  templates: Array<{ id: string; label: string }>;
  initialOwner?: string;
}) {
  const router = useRouter();
  const [owner, setOwner] = useState(initialOwner);
  const [versionId, setVersionId] = useState("");
  const [required, setRequired] = useState(true);
  const [pending, startTransition] = useTransition();
  return <Card><CardContent className="space-y-4 p-4">
    <div><h2 className="font-medium">Assign an approved template</h2>
      <p className="text-sm text-muted-foreground">Choose a reviewed blank form or handbook from the Company library. This does not change account access.</p></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-sm">Employee or open invite
        <select className={selectClass} value={owner} onChange={(event) => setOwner(event.target.value)} disabled={pending}>
          <option value="">Choose a recipient</option>{owners.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
        </select></label>
      <label className="space-y-1 text-sm">Approved template
        <select className={selectClass} value={versionId} onChange={(event) => setVersionId(event.target.value)} disabled={pending}>
          <option value="">Choose a template</option>{templates.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
        </select></label>
    </div>
    <label className="flex items-center gap-2 text-sm"><Checkbox checked={required} onCheckedChange={(value) => setRequired(value === true)} disabled={pending} /> Required item</label>
    <div className="flex flex-wrap items-center gap-3"><Button disabled={pending || !owner || !versionId} onClick={() => startTransition(async () => {
      const [kind, id] = owner.split(":");
      const result = await runAction(() => assignOnboardingTemplate({ ...(kind === "employee" ? { employeeId: id } : { inviteId: id }), versionId, required }));
      if (!toastAction(result)) return;
      toast.success("Template assigned"); router.refresh();
    })}>{pending ? "Assigning…" : "Assign template"}</Button>
      <Link className="text-sm text-primary underline-offset-4 hover:underline" href="/admin/documents/company">Open Company library</Link></div>
    {templates.length === 0 && <p className="text-sm text-muted-foreground">No approved onboarding templates are available. Add and approve a blank form or handbook first.</p>}
  </CardContent></Card>;
}

export function ChecklistItemPanel({ item, admin = false, readOnly = false, spanish = false }: {
  item: ChecklistItemView; admin?: boolean; readOnly?: boolean; spanish?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [documentId, setDocumentId] = useState(item.submittedDocumentId ?? "");
  const [reason, setReason] = useState("");
  const [decision, setDecision] = useState<"ACCEPTED" | "NEEDS_CORRECTION" | "NOT_APPLICABLE">("ACCEPTED");
  const [paperEvidence, setPaperEvidence] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const done = item.status === "ACCEPTED" || item.status === "NOT_APPLICABLE";
  const copy = (en: string, es: string) => spanish ? es : en;
  const spanishStatuses: Record<string, string> = { NOT_STARTED: "Sin empezar", SUBMITTED: "Enviado", NEEDS_CORRECTION: "Necesita corrección", ACCEPTED: "Aceptado", NOT_APPLICABLE: "No corresponde" };
  function save(action: () => ReturnType<typeof submitChecklistDocument>, message: string) {
    startTransition(async () => { const result = await runAction(action); if (!toastAction(result)) return; toast.success(message); setConfirmed(false); setReason(""); router.refresh(); });
  }
  return <Card role="region" aria-label={item.title}><CardContent className="space-y-4 p-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><div>
      <h2 className="font-medium">{item.title}</h2>
      <p className="text-xs text-muted-foreground">{admin ? `${item.ownerLabel} · ` : ""}{copy("Version", "Versión")} {item.versionNumber} · {item.required ? copy("Required", "Obligatorio") : copy("Optional", "Opcional")}</p>
    </div><Badge variant={done ? "success" : item.status === "NEEDS_CORRECTION" ? "destructive" : "outline"}>{spanish ? spanishStatuses[item.status] ?? item.status : CHECKLIST_LABELS[item.status] ?? item.status}</Badge></div>
    <div className="flex flex-wrap gap-4 text-sm">
      {item.templateAvailable ? <a href={`/api/company-documents/${item.versionId}/file`} target="_blank" rel="noreferrer" className="text-primary underline-offset-4 hover:underline">{copy("Open assigned template", "Abrir plantilla asignada")}</a>
        : <p className="text-muted-foreground">{copy("Template unavailable. Ask HR for the current version.", "Plantilla no disponible. Solicite a RR. HH. la versión actual.")}</p>}
      {item.submittedDocumentId && <a href={`/api/documents/${item.submittedDocumentId}/file`} target="_blank" rel="noreferrer" className="text-primary underline-offset-4 hover:underline">{copy("Open submitted document", "Abrir documento enviado")}</a>}
    </div>
    {item.reviewNotes && <p className="whitespace-pre-wrap border-l-2 pl-3 text-sm">{copy("HR review", "Revisión de RR. HH.")}: {item.reviewNotes}</p>}
    {item.acknowledgment && <p className="text-sm text-muted-foreground">{copy("Handbook receipt recorded", "Acuse de recibo registrado")}: {new Date(item.acknowledgment.acceptedAt).toLocaleDateString(spanish ? "es-US" : "en-US")} · {item.acknowledgment.method === "PAPER" ? copy("signed paper receipt", "recibo firmado en papel") : copy("employee acknowledgment", "acuse de recibo del empleado")}</p>}
    {!admin && !done && item.itemType === "FORM" && <div className="space-y-3">
      <label className="block space-y-1 text-sm">{copy("Your completed document", "Su documento completado")}
        <select className={selectClass} value={documentId} onChange={(event) => setDocumentId(event.target.value)} disabled={pending || readOnly || !item.templateAvailable}>
          <option value="">{copy("Choose from your uploaded documents", "Seleccione un documento cargado")}</option>
          {item.documents.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
        </select></label>
      <p className="text-xs text-muted-foreground">{copy("Upload the completed form in Documents first, then select it here. HR will review it.", "Primero cargue el formulario completado en Documentos y luego selecciónelo aquí. RR. HH. lo revisará.")}</p>
      <Button disabled={pending || readOnly || !documentId || !item.templateAvailable} onClick={() => save(() => submitChecklistDocument({ id: item.id, documentId }), copy("Document submitted for HR review", "Documento enviado a RR. HH."))}>{copy("Submit for review", "Enviar para revisión")}</Button>
    </div>}
    {!admin && !done && item.itemType === "HANDBOOK" && !item.acknowledgment && <div className="space-y-3">
      <p className="text-sm">{handbookReceiptText(item.title, item.versionNumber, spanish ? "es" : "en")}</p>
      <label className="flex items-start gap-2 text-sm"><Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} disabled={pending || readOnly || !item.templateAvailable} /><span>{copy("I confirm this acknowledgment.", "Confirmo este acuse de recibo.")}</span></label>
      <Button disabled={pending || readOnly || !confirmed || !item.templateAvailable} onClick={() => save(() => acknowledgeHandbook({ id: item.id, confirmed: true, language: spanish ? "es" : "en" }), copy("Handbook receipt recorded for HR review", "Acuse registrado para revisión de RR. HH."))}>{copy("Acknowledge receipt", "Confirmar recibo")}</Button>
    </div>}
    {admin && <div className="space-y-3 border-t pt-4">
      <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-sm">HR decision
        <select className={selectClass} value={decision} onChange={(event) => setDecision(event.target.value as typeof decision)} disabled={pending || !item.employeeId}>
          <option value="ACCEPTED">Accept</option><option value="NEEDS_CORRECTION" disabled={!!item.acknowledgment}>Needs correction</option><option value="NOT_APPLICABLE">Not applicable</option>
        </select></label>
        {item.itemType === "HANDBOOK" && !item.acknowledgment && <label className="space-y-1 text-sm">Signed paper receipt, if applicable
          <select className={selectClass} value={paperEvidence} onChange={(event) => setPaperEvidence(event.target.value)} disabled={pending || !item.employeeId}>
            <option value="">Choose the employee&apos;s signed receipt</option>{item.documents.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
          </select></label>}
      </div>
      <label className="block space-y-1 text-sm">Review reason<Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={1000} disabled={pending || !item.employeeId} /></label>
      <Button disabled={pending || !item.employeeId || reason.trim().length < 3} onClick={() => save(() => reviewOnboardingItem({ id: item.id, expectedUpdatedAt: item.updatedAt, decision, reason, ...(paperEvidence ? { paperEvidenceDocumentId: paperEvidence } : {}) }), "HR review recorded")}>{pending ? "Saving…" : "Save review"}</Button>
      {!item.employeeId && <p className="text-xs text-muted-foreground">Review becomes available after the hire creates their account. The invite can access only its assigned templates.</p>}
      {item.acknowledgment && <p className="text-xs text-muted-foreground">This receipt is permanent. Assign a new handbook version if a replacement acknowledgment is needed.</p>}
    </div>}
    {!admin && readOnly && <p className="text-sm text-muted-foreground">{copy("Your account is currently read-only. Contact HR to submit or acknowledge an item.", "Su cuenta es de solo lectura. Comuníquese con RR. HH. para enviar o confirmar un documento.")}</p>}
  </CardContent></Card>;
}
