"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SimpleSelect } from "@/components/simple-select";
import { DateField } from "@/components/date-field";
import { WizardSteps } from "@/components/interior/wizard-steps";
import { LoadingButton } from "@/components/interior/loading-button";
import {
  commitMassContractHours,
  previewMassContractHours,
  type MassContractPreviewRow,
} from "@/server/actions/contract-mass-hours";
import type { ContractAssignmentOffers } from "@/lib/contract-workers";
import { runAction, toastAction } from "@/lib/toast-action";
import { toast } from "sonner";
import { formatHours } from "@/lib/format";

type Worker = {
  id: string;
  name: string;
  workerId: string;
  agencyName: string;
  status: "ACTIVE" | "INACTIVE" | "ENDED";
  jobCode: string | null;
};

type OfferState = {
  shiftStart: boolean;
  extendEnd: boolean;
  reactivate: boolean;
};

function offersFromRow(row: MassContractPreviewRow, state: OfferState): ContractAssignmentOffers {
  const out: ContractAssignmentOffers = {};
  if (state.shiftStart && row.offers.shiftStartTo) out.shiftStartTo = row.offers.shiftStartTo;
  if (state.extendEnd && row.offers.extendEndTo) out.extendEndTo = row.offers.extendEndTo;
  if (state.reactivate && row.offers.reactivate) out.reactivate = true;
  return out;
}

export function MassContractHoursWizard({
  workers,
  jobCodes,
}: {
  workers: Worker[];
  jobCodes: { code: string; title: string }[];
}) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [clockInTime, setClockInTime] = useState("07:00");
  const [clockOutTime, setClockOutTime] = useState("15:30");
  const [jobCode, setJobCode] = useState(jobCodes[0]?.code ?? "");
  const [breakMin, setBreakMin] = useState(0);
  const [reason, setReason] = useState("");
  const [approve, setApprove] = useState(false);
  const [preview, setPreview] = useState<MassContractPreviewRow[] | null>(null);
  const [offerState, setOfferState] = useState<Record<string, OfferState>>({});
  const [done, setDone] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return workers;
    return workers.filter(
      (w) =>
        w.name.toLowerCase().includes(needle) ||
        w.workerId.toLowerCase().includes(needle) ||
        w.agencyName.toLowerCase().includes(needle),
    );
  }, [workers, q]);

  const payload = () => ({
    contractWorkerIds: [...selected],
    date,
    clockInTime,
    clockOutTime,
    jobCode,
    breakMin,
    reason: reason.trim(),
    approve,
  });

  return (
    <WizardSteps
      className="max-w-3xl"
      height={560}
      index={index}
      complete={done}
      completeLabel="Hours created"
      completeHint="Open Contract workers → Hours to review"
      nextLabel="Next"
      finishLabel="Review"
      backLabel="Back"
      onIndexChange={async (next, direction) => {
        if (direction === 1 && index === 0 && selected.size === 0) {
          toast.error("Select at least one contract worker.");
          return;
        }
        if (direction === 1 && index === 1) {
          if (reason.trim().length < 3 || !jobCode) {
            toast.error("Enter a job code and audit reason (3+ characters).");
            return;
          }
          const res = await runAction(() => previewMassContractHours(payload()));
          if (!toastAction(res) || !res.ok) return;
          setPreview(res.rows);
          const nextOffers: Record<string, OfferState> = {};
          for (const row of res.rows) {
            nextOffers[row.contractWorkerId] = {
              shiftStart: row.defaults.shiftStart,
              extendEnd: row.defaults.extendEnd,
              reactivate: row.defaults.reactivate,
            };
          }
          setOfferState(nextOffers);
        }
        setIndex(next);
      }}
      onComplete={() => {}}
      steps={[
        {
          id: "people",
          label: "Select workers",
          content: (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{selected.size}</span> selected
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={() => setSelected(new Set(filtered.map((w) => w.id)))}
                  >
                    Select filtered
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8"
                    onClick={() => setSelected(new Set())}
                  >
                    Clear
                  </Button>
                </div>
              </div>
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter by name, CW id, agency"
                className="h-9"
              />
              <ul className="max-h-[20rem] divide-y overflow-y-auto rounded-md border border-border">
                {filtered.map((w) => {
                  const on = selected.has(w.id);
                  return (
                    <li key={w.id} className={on ? "bg-muted/40" : undefined}>
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2.5 text-sm hover:bg-muted/50">
                        <input
                          type="checkbox"
                          className="size-4 shrink-0"
                          checked={on}
                          onChange={() => {
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(w.id)) next.delete(w.id);
                              else next.add(w.id);
                              return next;
                            });
                          }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium leading-snug">{w.name}</span>
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">
                            {w.workerId} · {w.agencyName} · {w.status.toLowerCase()}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ),
        },
        {
          id: "shift",
          label: "Shift details",
          content: (
            <div className="grid max-w-lg gap-4">
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="cmh-date"
                  className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                >
                  Date
                </Label>
                <DateField
                  id="cmh-date"
                  value={date}
                  onValueChange={setDate}
                  className="sm:w-full"
                  aria-label="Shift date"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cmh-in" className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Clock in
                  </Label>
                  <Input
                    id="cmh-in"
                    type="time"
                    className="h-9"
                    value={clockInTime}
                    onChange={(e) => setClockInTime(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cmh-out" className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Clock out
                  </Label>
                  <Input
                    id="cmh-out"
                    type="time"
                    className="h-9"
                    value={clockOutTime}
                    onChange={(e) => setClockOutTime(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cmh-break" className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Unpaid break (minutes)
                </Label>
                <Input
                  id="cmh-break"
                  type="number"
                  min={0}
                  max={240}
                  step={5}
                  className="h-9"
                  value={breakMin}
                  onChange={(e) =>
                    setBreakMin(Math.max(0, Math.min(240, Math.round(Number(e.target.value) || 0))))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cmh-job">Job code</Label>
                <SimpleSelect
                  id="cmh-job"
                  value={jobCode}
                  onValueChange={setJobCode}
                  options={jobCodes.map((j) => ({
                    value: j.code,
                    label: `${j.code} — ${j.title}`,
                  }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cmh-reason">Reason (audited)</Label>
                <Input
                  id="cmh-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Agency timesheet backfill"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={approve}
                  onChange={(e) => setApprove(e.target.checked)}
                />
                Approve immediately
              </label>
            </div>
          ),
        },
        {
          id: "preview",
          label: "Preview & commit",
          content: (
            <div className="space-y-3">
              {!preview ? (
                <p className="text-sm text-muted-foreground">Loading preview…</p>
              ) : (
                <>
                  <ul className="max-h-[22rem] divide-y overflow-y-auto rounded-md border text-sm">
                    {preview.map((r) => {
                      const state = offerState[r.contractWorkerId] ?? {
                        shiftStart: r.defaults.shiftStart,
                        extendEnd: r.defaults.extendEnd,
                        reactivate: r.defaults.reactivate,
                      };
                      const hasHelper =
                        !!r.offers.shiftStartTo ||
                        !!r.offers.extendEndTo ||
                        !!r.offers.reactivate;
                      return (
                        <li key={r.contractWorkerId} className="space-y-2 px-3 py-2">
                          <div className="flex items-center justify-between gap-3">
                            <span>
                              {r.name}
                              <span className="ml-2 text-[11px] text-muted-foreground">
                                {r.workerId} · {r.status.toLowerCase()}
                              </span>
                              {r.overlap ? (
                                <span className="ml-2 text-[11px] text-destructive">
                                  Skip — overlap
                                </span>
                              ) : null}
                            </span>
                            <span className="font-mono text-xs tabular-nums">
                              {formatHours(r.workMin)}
                            </span>
                          </div>
                          {!r.overlap && hasHelper && (
                            <div className="space-y-1.5 rounded-md bg-muted/40 p-2 text-xs">
                              {r.offers.shiftStartTo && (
                                <label className="flex items-start gap-2">
                                  <Checkbox
                                    checked={state.shiftStart}
                                    onCheckedChange={(v) =>
                                      setOfferState((prev) => ({
                                        ...prev,
                                        [r.contractWorkerId]: {
                                          ...state,
                                          shiftStart: v === true,
                                        },
                                      }))
                                    }
                                    className="mt-0.5"
                                  />
                                  <span>Shift start to {r.offers.shiftStartTo}</span>
                                </label>
                              )}
                              {r.offers.extendEndTo && (
                                <label className="flex items-start gap-2">
                                  <Checkbox
                                    checked={state.extendEnd}
                                    onCheckedChange={(v) =>
                                      setOfferState((prev) => ({
                                        ...prev,
                                        [r.contractWorkerId]: {
                                          ...state,
                                          extendEnd: v === true,
                                        },
                                      }))
                                    }
                                    className="mt-0.5"
                                  />
                                  <span>Extend end to {r.offers.extendEndTo}</span>
                                </label>
                              )}
                              {r.offers.reactivate && (
                                <label className="flex items-start gap-2">
                                  <Checkbox
                                    checked={state.reactivate}
                                    onCheckedChange={(v) =>
                                      setOfferState((prev) => ({
                                        ...prev,
                                        [r.contractWorkerId]: {
                                          ...state,
                                          reactivate: v === true,
                                        },
                                      }))
                                    }
                                    className="mt-0.5"
                                  />
                                  <span>Reactivate worker</span>
                                </label>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="text-xs text-muted-foreground">
                    Overlaps are skipped. Date/status changes apply only when checked.
                  </p>
                  <LoadingButton
                    className="w-full sm:w-auto"
                    disabled={preview.every((r) => r.overlap)}
                    pendingLabel="Creating…"
                    successLabel="Created"
                    errorLabel="Failed"
                    onAction={async () => {
                      const perWorkerOffers: Record<string, ContractAssignmentOffers> = {};
                      for (const row of preview) {
                        if (row.overlap) continue;
                        const state = offerState[row.contractWorkerId] ?? {
                          shiftStart: row.defaults.shiftStart,
                          extendEnd: row.defaults.extendEnd,
                          reactivate: row.defaults.reactivate,
                        };
                        perWorkerOffers[row.contractWorkerId] = offersFromRow(row, state);
                      }
                      const res = await runAction(() =>
                        commitMassContractHours({ ...payload(), perWorkerOffers }),
                      );
                      if (!toastAction(res) || !res.ok) {
                        throw new Error(res.ok ? "Commit failed" : res.error);
                      }
                      const failNote =
                        res.failed.length > 0
                          ? ` · ${res.failed.length} failed (${res.failed.slice(0, 2).join("; ")})`
                          : "";
                      toast.success(
                        `Created ${res.created}, skipped ${res.skipped}${failNote}`,
                      );
                      setDone(true);
                      router.push("/admin/contract-workers?tab=hours");
                      router.refresh();
                    }}
                  >
                    Commit
                  </LoadingButton>
                </>
              )}
            </div>
          ),
        },
      ]}
    />
  );
}
