"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { COMPANY_CATEGORIES, COMPANY_PURPOSES, allowedCompanyPurpose, type CompanyCategory } from "@/lib/company-documents";
import { uploadCompanyDocument, approveCompanyVersion, setCompanyDocumentArchived } from "@/server/actions/company-documents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { runAction, toastAction } from "@/lib/toast-action";

type Version = {id: string; version: number; originalName: string; status: string; purpose: string; year: number | null; quarter: number | null; sourceReference: string | null; notes: string | null; effectiveDate: string | null; periodStart: string | null; periodEnd: string | null};
type Document = {id: string; title: string; category: string; issuer: string | null; isArchived: boolean; versions: Version[]};
const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

export function CompanyLibrary({documents, filters}: {documents: Document[]; filters: {q: string; category: string; year: string; quarter: string; archived: boolean}}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<Document | "new" | null>(null);
  const [review, setReview] = useState<{doc: Document; version: Version} | null>(null);
  const [purpose, setPurpose] = useState("HR_ONLY");
  const [reason, setReason] = useState("");
  function upload(form: HTMLFormElement) {
    const f = new FormData(form);
    const file = f.get("file") as File;
    if (!file?.size) return toast.error("Choose a file.");
    if (file.size > 15 * 1024 * 1024) return toast.error("Choose a file under 15 MB.");
    start(async () => {
      const result = await runAction(async () => uploadCompanyDocument({
        ...(editing && editing !== "new" ? {documentId: editing.id} : {}),
        title: String(f.get("title")), category: String(f.get("category")) as CompanyCategory,
        issuer: String(f.get("issuer") ?? ""), year: f.get("year") ? Number(f.get("year")) : "",
        quarter: f.get("quarter") ? Number(f.get("quarter")) : "",
        periodStart: String(f.get("periodStart") ?? ""), periodEnd: String(f.get("periodEnd") ?? ""),
        effectiveDate: String(f.get("effectiveDate") ?? ""), sourceReference: String(f.get("sourceReference") ?? ""), notes: String(f.get("notes") ?? ""),
      }, {name: file.name, type: file.type, bytes: await file.arrayBuffer()}));
      if (!toastAction(result)) return;
      toast.success("Saved to the private library as a draft."); setEditing(null); router.refresh();
    });
  }
  return <div className="mt-6 space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="max-w-2xl text-sm text-muted-foreground">Keep filing confirmations, tax forms and company records here. Approval makes a blank template available for HR assignment; it does not send it to employees.</p>
      <Button disabled={pending} onClick={() => {setEditing("new"); setReview(null);}}>Upload company document</Button>
    </div>
    {editing && <form className="space-y-4 rounded-lg border p-4" onSubmit={(event) => {event.preventDefault(); upload(event.currentTarget);}}>
      <h2 className="text-base font-semibold">{editing === "new" ? "Upload company document" : `New version: ${editing.title}`}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="company-title">Title</Label><Input id="company-title" name="title" defaultValue={editing === "new" ? "" : editing.title} required minLength={2} maxLength={200} readOnly={editing !== "new"} /></div>
        <div className="space-y-1.5"><Label htmlFor="company-category">Category</Label><select id="company-category" name="category" className={selectClass} defaultValue={editing === "new" ? "HR_REFERENCE" : editing.category} disabled={editing !== "new"}>{Object.entries(COMPANY_CATEGORIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>{editing !== "new" && <input type="hidden" name="category" value={editing.category} />}</div>
        <div className="space-y-1.5"><Label htmlFor="company-issuer">Issuing organization</Label><Input id="company-issuer" name="issuer" defaultValue={editing === "new" ? "" : editing.issuer ?? ""} maxLength={150} readOnly={editing !== "new"} /></div>
        <div className="space-y-1.5"><Label htmlFor="company-file">File</Label><Input id="company-file" name="file" type="file" accept=".pdf,.docx,.xlsx,.txt,.png,.jpg,.jpeg" required /><p className="text-xs text-muted-foreground">Up to 15 MB. No ZIP or email imports.</p></div>
        <div className="space-y-1.5"><Label htmlFor="company-year">Tax or plan year</Label><Input id="company-year" name="year" type="number" min={1900} max={2200} /></div>
        <div className="space-y-1.5"><Label htmlFor="company-quarter">Quarter</Label><select id="company-quarter" name="quarter" className={selectClass}><option value="">Not applicable</option>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>Q{n}</option>)}</select></div>
        <div className="space-y-1.5"><Label htmlFor="company-from">Period start</Label><Input id="company-from" name="periodStart" type="date" /></div>
        <div className="space-y-1.5"><Label htmlFor="company-to">Period end</Label><Input id="company-to" name="periodEnd" type="date" /></div>
        <div className="space-y-1.5"><Label htmlFor="company-effective">Document effective date</Label><Input id="company-effective" name="effectiveDate" type="date" /></div>
        <div className="space-y-1.5"><Label htmlFor="company-source">Source reference</Label><Input id="company-source" name="sourceReference" placeholder="For example, the source email or provider" maxLength={300} /></div>
      </div>
      <div className="space-y-1.5"><Label htmlFor="company-notes">HR notes</Label><Textarea id="company-notes" name="notes" maxLength={2000} placeholder="Version, review needs, or context. Keep sensitive identifiers out of notes." /></div>
      <div className="flex gap-2"><Button disabled={pending} type="submit">{pending ? "Saving…" : "Save draft"}</Button><Button disabled={pending} type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button></div>
    </form>}
    <form className="flex flex-wrap items-end gap-3" method="get">
      <div className="min-w-48 flex-1 space-y-1.5"><Label htmlFor="library-search">Search</Label><Input id="library-search" name="q" defaultValue={filters.q} placeholder="Title or issuing organization" /></div>
      <div className="space-y-1.5"><Label htmlFor="library-category">Category</Label><select id="library-category" name="category" className={selectClass} defaultValue={filters.category}><option value="">All categories</option>{Object.entries(COMPANY_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      <div className="w-24 space-y-1.5"><Label htmlFor="library-year">Year</Label><Input id="library-year" type="number" name="year" defaultValue={filters.year} min={1900} max={2200} /></div>
      <div className="w-28 space-y-1.5"><Label htmlFor="library-quarter">Quarter</Label><select id="library-quarter" className={selectClass} name="quarter" defaultValue={filters.quarter}><option value="">All</option>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>Q{n}</option>)}</select></div>
      <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" name="archived" value="1" defaultChecked={filters.archived} />Include archived</label>
      <Button variant="outline" type="submit">Apply</Button>
    </form>
    {review && <form className="space-y-3 rounded-lg border p-4" onSubmit={(event) => {event.preventDefault(); start(async () => {const result = await runAction(() => approveCompanyVersion({id: review.version.id, purpose, reason})); if (!toastAction(result)) return; toast.success("Version approved. No employee documents were sent."); setReview(null); router.refresh();});}}>
      <h2 className="font-semibold">Review {review.doc.title}, version {review.version.version}</h2>
      <p className="text-sm text-muted-foreground">Confirm that the document is the correct edition. Only blank, approved resources may be assigned to employees. Payroll and tax records stay private.</p>
      <div className="space-y-1.5"><Label htmlFor="company-purpose">Approved use</Label><select id="company-purpose" className={selectClass} value={purpose} onChange={(e) => setPurpose(e.target.value)}>{Object.entries(COMPANY_PURPOSES).filter(([key]) => allowedCompanyPurpose(review.doc.category, key)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
      <div className="space-y-1.5"><Label htmlFor="company-reason">Review note</Label><Textarea id="company-reason" required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      <div className="flex gap-2"><Button disabled={pending} type="submit">Approve version</Button><Button disabled={pending} variant="outline" type="button" onClick={() => setReview(null)}>Cancel</Button></div>
    </form>}
    <div className="divide-y rounded-lg border">
      {documents.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">No company documents match these filters. Upload a document or adjust the filters.</p>}
      {documents.map((doc) => <section key={doc.id} className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">{doc.title}</h2><p className="text-sm text-muted-foreground">{COMPANY_CATEGORIES[doc.category as CompanyCategory]}{doc.issuer ? ` · ${doc.issuer}` : ""}</p></div><div className="flex flex-wrap items-center gap-2">{doc.isArchived && <Badge variant="outline">Archived</Badge>}<Button size="sm" variant="outline" disabled={pending || doc.isArchived} onClick={() => {setEditing(doc); setReview(null);}}>New version</Button><ArchiveControl doc={doc} pending={pending} run={(archived, explanation) => start(async () => {const result = await runAction(() => setCompanyDocumentArchived({id: doc.id, archived, reason: explanation})); if (!toastAction(result)) return; toast.success(archived ? "Document archived." : "Document restored."); router.refresh();})} /></div></div>
        <details><summary className="cursor-pointer py-1 text-sm">{doc.versions.length} version{doc.versions.length === 1 ? "" : "s"} · latest {doc.versions[0]?.status === "APPROVED" ? "approved" : "draft"}</summary><ul className="mt-2 divide-y">{doc.versions.map((v) => <li key={v.id} className="flex flex-wrap items-start justify-between gap-3 py-3"><div className="min-w-0"><p className="break-words text-sm">Version {v.version} · {v.originalName}</p><p className="text-xs text-muted-foreground">{v.year ?? "No year"}{v.quarter ? ` · Q${v.quarter}` : ""} · {COMPANY_PURPOSES[v.purpose as keyof typeof COMPANY_PURPOSES]}{v.effectiveDate ? ` · effective ${v.effectiveDate}` : ""}</p>{v.sourceReference && <p className="break-words text-xs text-muted-foreground">Source: {v.sourceReference}</p>}{v.notes && <p className="mt-1 max-w-prose whitespace-pre-wrap break-words text-sm">{v.notes}</p>}</div><div className="flex items-center gap-2"><Badge variant={v.status === "APPROVED" ? "success" : "outline"}>{v.status === "APPROVED" ? "Approved" : "Draft"}</Badge><Button asChild size="sm" variant="outline"><Link target="_blank" href={`/api/company-documents/${v.id}/file`}>Open<span className="sr-only"> {doc.title} version {v.version}</span></Link></Button>{v.status === "DRAFT" && !doc.isArchived && <Button size="sm" disabled={pending} onClick={() => {setReview({doc, version: v}); setPurpose("HR_ONLY"); setReason("");}}>Review<span className="sr-only"> {doc.title} version {v.version}</span></Button>}</div></li>)}</ul></details>
      </section>)}
    </div>
    {documents.length === 200 && <p className="text-sm text-muted-foreground">Showing the first 200 documents. Narrow the filters to find older records.</p>}
  </div>;
}

function ArchiveControl({doc, pending, run}: {doc: Document; pending: boolean; run: (archived: boolean, reason: string) => void}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return open ? <form className="flex flex-wrap gap-2" onSubmit={(event) => {event.preventDefault(); run(!doc.isArchived, reason); setOpen(false);}}><Input aria-label="Reason for archive change" required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /><Button size="sm" disabled={pending} type="submit">Confirm {doc.isArchived ? "restore" : "archive"}</Button><Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>Cancel</Button></form> : <Button size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(true)}>{doc.isArchived ? "Restore" : "Archive"}</Button>;
}
