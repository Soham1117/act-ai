"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { EMPLOYEE_NOTE_KINDS, EMPLOYEE_NOTE_LABELS } from "@/lib/employee-notes";
import { archiveEmployeeNote, createEmployeeNote, updateEmployeeNote, type EmployeeNoteView } from "@/server/actions/employee-notes";
import { runAction, toastAction } from "@/lib/toast-action";
import { formatDateOnly } from "@/lib/format";

type Draft = { title: string; body: string; kind: "GENERAL" | "TERMINATION" | "RESIGNATION"; noteDate: string };
const blank = (today: string): Draft => ({ title: "", body: "", kind: "GENERAL", noteDate: today });

export function EmployeeNotesPanel({ employeeId, notes, today }: { employeeId: string; notes: EmployeeNoteView[]; today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft>(() => blank(today));
  const [editing, setEditing] = useState<EmployeeNoteView | null>(null);
  const [reason, setReason] = useState("");
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [archiveReason, setArchiveReason] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const visible = notes.filter((note) => showArchived || !note.isArchived);
  function reset() { setDraft(blank(today)); setEditing(null); setReason(""); }
  function save() {
    startTransition(async () => {
      const result = editing
        ? await runAction(() => updateEmployeeNote({ ...draft, id: editing.id, expectedUpdatedAt: editing.updatedAt, reason }))
        : await runAction(() => createEmployeeNote({ ...draft, employeeId }));
      if (!result.ok) { toastAction(result); return; }
      toast.success(editing ? "Employee note updated" : "Employee note saved"); reset(); router.refresh();
    });
  }
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">Private HR notes. Only administrators can read or change these records. A termination or resignation note does not change employment status or the termination date.</p>
    <Card><CardHeader><CardTitle className="text-base"><h2>{editing ? "Edit employee note" : "Add employee note"}</h2></CardTitle></CardHeader><CardContent className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-sm">Note title<Input maxLength={160} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} disabled={pending} /></label>
        <label className="space-y-1 text-sm">Note date<Input type="date" value={draft.noteDate} onChange={(event) => setDraft({ ...draft, noteDate: event.target.value })} disabled={pending} /></label></div>
      <label className="block space-y-1 text-sm">Note type<select aria-label="Note type" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as Draft["kind"] })} disabled={pending}>{EMPLOYEE_NOTE_KINDS.map((kind) => <option key={kind} value={kind}>{EMPLOYEE_NOTE_LABELS[kind]}</option>)}</select></label>
      <label className="block space-y-1 text-sm">Note details<Textarea rows={4} maxLength={12000} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} disabled={pending} /></label>
      {editing && <label className="block space-y-1 text-sm">Reason for change<Input maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} disabled={pending} /></label>}
      <div className="flex gap-2"><Button disabled={pending || draft.title.trim().length < 2 || !draft.body.trim() || !draft.noteDate || (!!editing && reason.trim().length < 3)} onClick={save}>{pending ? "Saving…" : editing ? "Save note changes" : "Save employee note"}</Button>{editing && <Button variant="outline" onClick={reset} disabled={pending}>Cancel edit</Button>}</div>
    </CardContent></Card>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Show archived notes</label>
    {visible.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No employee notes recorded.</p>}
    {visible.map((note) => <Card key={note.id} role="region" aria-label={`Employee note: ${note.title}`}><CardContent className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-medium">{note.title}</h3><p className="text-xs text-muted-foreground">Note date: {formatDateOnly(note.noteDate)} · Entered by {note.createdByName} on {new Date(note.createdAt).toLocaleString("en-US", { timeZone: "America/Chicago" })} Central</p></div><div className="flex gap-2"><Badge variant="outline">{EMPLOYEE_NOTE_LABELS[note.kind] ?? note.kind}</Badge>{note.isArchived && <Badge variant="secondary">Archived</Badge>}</div></div>
      <p className="whitespace-pre-wrap text-sm">{note.body}</p>
      {!note.isArchived && <div className="flex gap-2"><Button variant="outline" size="sm" disabled={pending} onClick={() => { setEditing(note); setDraft({ title: note.title, body: note.body, kind: note.kind as Draft["kind"], noteDate: note.noteDate }); setReason(""); }}>Edit note</Button><Button variant="outline" size="sm" disabled={pending} onClick={() => { setArchiveId(note.id); setArchiveReason(""); }}>Archive note</Button></div>}
      {archiveId === note.id && <div className="space-y-2 border-t pt-3"><label className="block space-y-1 text-sm">Reason for archiving<Input value={archiveReason} onChange={(event) => setArchiveReason(event.target.value)} maxLength={500} disabled={pending} /></label><div className="flex gap-2"><Button size="sm" disabled={pending || archiveReason.trim().length < 3} onClick={() => startTransition(async () => { const result = await runAction(() => archiveEmployeeNote({ id: note.id, expectedUpdatedAt: note.updatedAt, reason: archiveReason })); if (!toastAction(result)) return; toast.success("Employee note archived"); setArchiveId(null); if (editing?.id === note.id) reset(); router.refresh(); })}>Confirm archive</Button><Button size="sm" variant="outline" disabled={pending} onClick={() => setArchiveId(null)}>Cancel archive</Button></div></div>}
      <details className="border-t pt-3"><summary className="cursor-pointer text-sm">Revision history ({note.revisions.length})</summary><ol className="mt-3 space-y-3">{note.revisions.map((revision) => <li key={revision.id} className="border-l-2 pl-3"><p className="text-xs text-muted-foreground">{new Date(revision.createdAt).toLocaleString("en-US", { timeZone: "America/Chicago" })} Central · {revision.actorName} · {revision.reason ?? "Recorded"}</p><p className="text-sm font-medium">{revision.title} · {EMPLOYEE_NOTE_LABELS[revision.kind] ?? revision.kind} · {formatDateOnly(revision.noteDate)}</p><p className="whitespace-pre-wrap text-sm">{revision.body}</p></li>)}</ol></details>
    </CardContent></Card>)}
  </div>;
}
