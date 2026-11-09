"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { decideClockOutProposal } from "@/server/actions/watch-proposals";
import type { WatchProposalRow } from "@/server/queries/watch-proposals";
import { formatHours } from "@/lib/format";

const labels = { PENDING: "Awaiting review", APPLIED: "Applied", REJECTED: "Rejected", UNDONE: "Undone" } as const;
function dateTime(iso: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

function Proposal({ row }: { row: WatchProposalRow }) {
  const confirmationId = useId();
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [pending, start] = useTransition();
  function decide(action: "APPROVE" | "REJECT" | "UNDO") {
    start(async () => {
      const result = await decideClockOutProposal({ id: row.id, action, confirmedActualEnd: confirmed });
      if (!result.ok) { toast.error(result.error); router.refresh(); return; }
      toast.success(action === "APPROVE" ? "Correction applied. Hours await payroll approval." : action === "UNDO" ? "Correction undone. The original open shift is restored." : "Draft rejected. No hours changed.");
      setConfirmed(false);
      router.refresh();
    });
  }
  return (
    <article aria-label={`Correction for ${row.name}`} className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 [overflow-wrap:anywhere]">
          <h2 className="font-semibold">{row.name}</h2>
          <p className="text-xs text-muted-foreground">{row.employeeCode} · Job {row.jobCode} · {row.automatic ? "Automatically drafted" : "Drafted"} {dateTime(row.createdAt)} Central</p>
        </div>
        <Badge variant={row.status === "PENDING" ? "warning" : "outline"}>{labels[row.status]}</Badge>
      </div>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div><dt className="text-muted-foreground">Original entry</dt><dd className="mt-1">In: {dateTime(row.clockIn)}<br />Out: {row.originalClockOut ? dateTime(row.originalClockOut) : "Still open"}</dd></div>
        <div><dt className="text-muted-foreground">Proposed correction</dt><dd className="mt-1">Out: {dateTime(row.proposedClockOut)}<br />Work: {formatHours(row.proposedWorkMin)} · Recorded breaks: {formatHours(row.breakMin)}</dd></div>
      </dl>
      <div className="space-y-1 text-sm [overflow-wrap:anywhere]">
        <p><span className="font-medium">Reason:</span> {row.reason}</p>
        <p className="text-muted-foreground">Source: employee schedule{row.scheduleUpdatedAt ? `, last updated ${dateTime(row.scheduleUpdatedAt)} Central` : ""}. A scheduled end does not confirm when work stopped. No breaks are added.</p>
      </div>
      {row.lastError && <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">Last attempt: {row.lastError} Review the entry before retrying{row.status === "PENDING" ? ", or reject this draft" : " in Hours"}.</p>}
      <Link href={`/admin/hours?employee=${row.employeeId}&from=${row.date}&to=${row.date}`} className="inline-block text-sm underline underline-offset-4">Review original entry in Hours</Link>
      {row.status === "PENDING" && (
        <>
          <label htmlFor={confirmationId} className="flex cursor-pointer items-start gap-2 text-sm">
            <Checkbox id={confirmationId} checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} className="mt-0.5" disabled={pending} />
            I verified that the proposed clock-out matches the actual end of work.
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={pending || !confirmed} onClick={() => decide("APPROVE")}>{pending ? "Working…" : "Approve correction"}</Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => decide("REJECT")}>Reject draft</Button>
          </div>
        </>
      )}
      {row.status === "APPLIED" && <div className="space-y-2">
        <p className="text-xs text-muted-foreground">Undo restores the original open entry only if nobody has changed it and its pay period is still open.</p>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => decide("UNDO")}>{pending ? "Working…" : "Undo correction"}</Button>
      </div>}
    </article>
  );
}

export function ProposalQueue({ rows }: { rows: WatchProposalRow[] }) {
  const [history, setHistory] = useState(false);
  const pending = rows.filter((r) => r.status === "PENDING");
  const completed = rows.filter((r) => r.status !== "PENDING");
  const visible = history ? completed : pending;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Correction status">
        <Button size="sm" variant={history ? "outline" : "default"} aria-pressed={!history} onClick={() => setHistory(false)}>Awaiting review ({pending.length})</Button>
        <Button size="sm" variant={history ? "default" : "outline"} aria-pressed={history} onClick={() => setHistory(true)}>History ({completed.length})</Button>
      </div>
      {visible.length ? <div className="divide-y rounded-lg border">{visible.map((r) => <Proposal key={`${r.id}-${r.status}`} row={r} />)}</div> :
        <p className="rounded-lg border p-6 text-sm text-muted-foreground">{history ? "No correction history yet." : <>No drafts awaiting review. Scheduled Watch checks automatically draft eligible employee missing-clock-out corrections. You can also open a missing-clock-out flag in <Link href="/admin/watch" className="underline underline-offset-4">Watch</Link> to create one manually.</>}</p>}
      <p className="text-xs text-muted-foreground">Showing up to 200 recent drafts. No corrections run automatically, and no employee messages are sent from this queue.</p>
    </div>
  );
}
