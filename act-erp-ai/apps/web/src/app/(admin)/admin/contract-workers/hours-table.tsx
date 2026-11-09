"use client";

import { useState, useTransition, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { InlinePanel, InlinePanelContent } from "@/components/inline-panel";
import { PunchPhotos } from "@/components/punch-photos";
import { HoursEntryList } from "@/components/hours-entry-list";
import { HoursReviewButtons, HoursRejectEditor, HoursSelectionToolbar } from "@/components/hours-review-controls";
import { runAction, toastAction } from "@/lib/toast-action";
import { bulkReviewContractTimeEntries, reviewContractTimeEntry } from "@/server/actions/contract-workers";
import { exportContractHoursWorkbook } from "./export-actions";
import { ContractEntryRowActions } from "./entry-row-actions";
import { type HoursRow } from "./shared";

const canReview = (r: HoursRow) =>
  !r.isOpen && r.clockOut !== null && r.approvalStatus === "PENDING";

export function DownloadHoursCsvButton({
  from,
  to,
  agencyId,
  workerId,
  formId,
}: {
  from: string;
  to: string;
  agencyId: string;
  workerId?: string;
  formId?: string;
}) {
  const [pending, startTransition] = useTransition();
  function download(event: MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form;
    const data = form ? new FormData(form) : null;
    const input = {
      from: String(data?.get("from") ?? from),
      to: String(data?.get("to") ?? to),
      agencyId: String(data?.get("hagency") ?? agencyId) || undefined,
      workerId: String(data?.get("worker") ?? workerId ?? "") || undefined,
    };
    startTransition(async () => {
      const res = await runAction(() =>
        exportContractHoursWorkbook(input),
      );
      if (!toastAction(res)) return;
      // Empty range: nothing to export.
      if (!res.xlsx) {
        toast.info("No entries in this range, so there is nothing to export.");
        return;
      }
      const blob = new Blob([Uint8Array.from(atob(res.xlsx), (c) => c.charCodeAt(0))], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Excel downloaded");
    });
  }
  return (
    <Button
      type="button"
      form={formId}
      className="min-h-11 md:min-h-9"
      variant="outline"
      size="sm"
      onClick={download}
      disabled={pending}
    >
      {pending ? (
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      ) : (
        <Download className="mr-1.5 h-3.5 w-3.5" />
      )}
      Download Excel
    </Button>
  );
}

export function HoursTable({ rows }: { rows: HoursRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejectIds, setRejectIds] = useState<string[] | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");

  const reviewable = rows.filter(canReview);
  // Drop selections that are no longer reviewable after a refresh.
  const activeSelected = reviewable.filter((r) => selected.has(r.id)).map((r) => r.id);
  const allSelected =
    reviewable.length > 0 && activeSelected.length === reviewable.length;

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function approve(ids: string[]) {
    startTransition(async () => {
      if (ids.length === 1) {
        const res = await runAction(() =>
          reviewContractTimeEntry({ id: ids[0]!, decision: "APPROVED" }),
        );
        if (!toastAction(res)) return;
        toast.success("Entry approved");
      } else {
        const res = await runAction(() =>
          bulkReviewContractTimeEntries({ ids, decision: "APPROVED" }),
        );
        if (!toastAction(res)) return;
        toast.success(
          res.skipped > 0
            ? `Approved ${res.updated}, skipped ${res.skipped} that were not pending`
            : `Approved ${res.updated} entries`,
        );
      }
      setSelected(new Set());
      router.refresh();
    });
  }

  function reject() {
    const ids = rejectIds;
    const notes = rejectNotes.trim();
    if (!ids) return;
    if (!notes) return toast.error("Enter a reason for rejecting.");
    startTransition(async () => {
      if (ids.length === 1) {
        const res = await runAction(() =>
          reviewContractTimeEntry({ id: ids[0]!, decision: "REJECTED", notes }),
        );
        if (!toastAction(res)) return;
        toast.success("Entry rejected");
      } else {
        const res = await runAction(() =>
          bulkReviewContractTimeEntries({ ids, decision: "REJECTED", notes }),
        );
        if (!toastAction(res)) return;
        toast.success(
          res.skipped > 0
            ? `Rejected ${res.updated}, skipped ${res.skipped} that were not pending`
            : `Rejected ${res.updated} entries`,
        );
      }
      setRejectIds(null);
      setRejectNotes("");
      setSelected(new Set());
      router.refresh();
    });
  }

  const selectAll=(checked: boolean)=>setSelected(checked?new Set(reviewable.map(r=>r.id)):new Set());
  return <>
    <HoursSelectionToolbar checked={allSelected} onSelectAll={selectAll} count={activeSelected.length} available={reviewable.length} pending={pending} onApprove={()=>approve(activeSelected)} onReject={()=>{setRejectNotes("");setRejectIds(activeSelected);}} onClear={()=>setSelected(new Set())} />
    <HoursEntryList selection={<Checkbox aria-label="Select all pending entries" disabled={!reviewable.length} checked={allSelected} onCheckedChange={v=>selectAll(v===true)} />}
      extraColumns={[{key:"job",label:"Job"},{key:"agency",label:"Agency"}]}
      rows={rows.map(r=>({
        id:r.id,name:r.workerName,code:r.workerCode,href:`/admin/contract-workers/${r.workerDbId}`,date:r.date,clockIn:r.clockIn,clockOut:r.clockOut,
        workMin:r.totalWorkMin,breakMin:r.totalBreakMin,approvalStatus:r.approvalStatus,open:r.isOpen,autoClosed:r.autoClosed,editReason:r.editReason,approvalNotes:r.approvalNotes,
        metadata:{job:<span className="whitespace-nowrap font-mono">{r.jobCode}</span>,agency:<span className="block max-w-44 truncate" title={`${r.agencyName}${r.project?` · ${r.project}`:""}`}>{r.agencyName}{r.project && <span className="block truncate text-[11px] text-muted-foreground">{r.project}</span>}</span>},
        photos:<PunchPhotos type="contract" entryId={r.id} hasIn={r.hasClockInPhoto} hasOut={r.hasClockOutPhoto} source={r.fromKiosk?"KIOSK":null} clockIn={r.clockIn} clockOut={r.clockOut} />,
        selection:canReview(r)?<Checkbox checked={selected.has(r.id)} onCheckedChange={v=>toggle(r.id,v===true)} aria-label={`Select entry for ${r.workerName}`} />:undefined,
        actions:<><ContractEntryRowActions entry={{id:r.id,workerName:r.workerName,clockIn:r.clockIn,clockOut:r.clockOut,isOpen:r.isOpen}} panelSlotId={`hours-${r.id}`} />{canReview(r)&&<HoursReviewButtons name={r.workerName} pending={pending} onApprove={()=>approve([r.id])} onReject={()=>{setRejectNotes("");setRejectIds([r.id]);}} />}</>,panelId:`hours-${r.id}`,
      }))} />
    <InlinePanel open={rejectIds!==null} onOpenChange={v=>!pending&&!v&&setRejectIds(null)}>
      <InlinePanelContent panelSlot={rejectIds?.length===1?`hours-${rejectIds[0]}`:undefined}>
        <HoursRejectEditor title={rejectIds?.length===1?"Reject time entry":`Reject ${rejectIds?.length??0} entries`} description="Rejected hours are excluded from totals and exports. A reason is required." reason={rejectNotes} onChange={setRejectNotes} pending={pending} onCancel={()=>setRejectIds(null)} onConfirm={reject} />
      </InlinePanelContent>
    </InlinePanel>
  </>;
}
