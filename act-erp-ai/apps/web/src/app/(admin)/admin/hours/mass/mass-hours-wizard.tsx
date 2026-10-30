"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { SimpleSelect } from "@/components/simple-select";
import { DateField } from "@/components/date-field";
import { WizardSteps } from "@/components/interior/wizard-steps";
import { LoadingButton } from "@/components/interior/loading-button";
import { commitMassHours, previewMassHours } from "@/server/actions/mass-hours";
import { runAction, toastAction } from "@/lib/toast-action";
import { toast } from "sonner";
import { formatHours } from "@/lib/format";

type Emp = {
  id: string;
  name: string;
  employeeId: string;
  exportCode: string | null;
  department: string | null;
  defaultHourlyRate: number;
};

type PreviewRow = {
  employeeId: string;
  name: string;
  overlap: boolean;
  inactive: boolean;
  workMin: number;
};

export function MassHoursWizard({
  employees,
  jobCodes,
}: {
  employees: Emp[];
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
  const [periodEnded, setPeriodEnded] = useState(false);
  const [approve, setApprove] = useState(false);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [done, setDone] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return employees;
    return employees.filter(
      (e) =>
        e.name.toLowerCase().includes(needle) ||
        e.employeeId.toLowerCase().includes(needle) ||
        (e.exportCode ?? "").toLowerCase().includes(needle) ||
        (e.department ?? "").toLowerCase().includes(needle),
    );
  }, [employees, q]);

  const payload = () => ({
    employeeIds: [...selected],
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
      height={520}
      index={index}
      complete={done}
      completeLabel="Hours created"
      completeHint="Open Individual hours to review"
      nextLabel="Next"
      finishLabel="Review"
      backLabel="Back"
      onIndexChange={async (next, direction) => {
        if (direction === 1 && index === 0 && selected.size === 0) {
          toast.error("Select at least one employee.");
          return;
        }
        if (direction === 1 && index === 1) {
          if (reason.trim().length < 3 || !jobCode) {
            toast.error("Enter a job code and audit reason (3+ characters).");
            return;
          }
          const res = await runAction(() => previewMassHours(payload()));
          if (!toastAction(res) || !res.ok) return;
          setPreview(res.rows);
          setPeriodEnded(res.periodEnded);
        }
        setIndex(next);
      }}
      onComplete={() => {
        /* Last-step Finish only advances chrome; commit is the LoadingButton below. */
      }}
      steps={[
        {
          id: "people",
          label: "Select employees",
          content: (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {selected.size} selected
              </p>
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter by name, ID, export code, department"
                className="h-10"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setSelected(new Set(filtered.map((e) => e.id)))}
                >
                  Select filtered
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              </div>
              <ul className="max-h-[20rem] divide-y overflow-y-auto rounded-md border">
                {filtered.map((e) => {
                  const on = selected.has(e.id);
                  return (
                    <li key={e.id}>
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => {
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(e.id)) next.delete(e.id);
                              else next.add(e.id);
                              return next;
                            });
                          }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{e.name}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {e.exportCode ?? e.employeeId}
                            {e.department ? ` · ${e.department}` : ""}
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
            <div className="grid max-w-lg gap-3">
              <div className="space-y-1">
                <Label htmlFor="mh-date">Date</Label>
                <DateField
                  id="mh-date"
                  value={date}
                  onValueChange={setDate}
                  className="sm:w-full"
                  aria-label="Shift date"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="mh-in">Clock in</Label>
                  <Input
                    id="mh-in"
                    type="time"
                    value={clockInTime}
                    onChange={(e) => setClockInTime(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="mh-out">Clock out</Label>
                  <Input
                    id="mh-out"
                    type="time"
                    value={clockOutTime}
                    onChange={(e) => setClockOutTime(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="mh-break">Unpaid break (minutes)</Label>
                <Input
                  id="mh-break"
                  type="number"
                  min={0}
                  max={240}
                  step={5}
                  value={breakMin}
                  onChange={(e) =>
                    setBreakMin(Math.max(0, Math.min(240, Math.round(Number(e.target.value) || 0))))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mh-job">Job code</Label>
                <SimpleSelect
                  id="mh-job"
                  value={jobCode}
                  onValueChange={setJobCode}
                  options={jobCodes.map((j) => ({
                    value: j.code,
                    label: `${j.code} — ${j.title}`,
                  }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mh-reason">Reason (audited)</Label>
                <Input
                  id="mh-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Holiday coverage backfill"
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
                  <ul className="max-h-[16rem] divide-y overflow-y-auto rounded-md border text-sm">
                    {preview.map((r) => (
                      <li
                        key={r.employeeId}
                        className="flex items-center justify-between gap-3 px-3 py-2"
                      >
                        <span>
                          {r.name}
                          {r.inactive ? (
                            <span className="ml-2 text-[11px] text-destructive">
                              Not active
                            </span>
                          ) : null}
                          {r.overlap ? (
                            <span className="ml-2 text-[11px] text-destructive">
                              Skip — overlap
                            </span>
                          ) : null}
                        </span>
                        <span className="font-mono text-xs tabular-nums">
                          {formatHours(r.workMin)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {periodEnded ? (
                    <p className="rounded-md border p-2 text-xs">
                      This date is in a pay period that has already ended. If hours were already
                      exported for it, these entries will not be in that export.
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    Overlaps are skipped so kiosk punches are not overwritten.
                  </p>
                  <LoadingButton
                    className="w-full sm:w-auto"
                    disabled={
                      preview.every((r) => r.overlap) || preview.some((r) => r.inactive)
                    }
                    pendingLabel="Creating…"
                    successLabel="Created"
                    errorLabel="Failed"
                    onAction={async () => {
                      const res = await runAction(() => commitMassHours(payload()));
                      if (!toastAction(res) || !res.ok) {
                        throw new Error(res.ok ? "Commit failed" : res.error);
                      }
                      toast.success(
                        `Created ${res.created}, skipped ${res.skipped}`,
                      );
                      setDone(true);
                      router.push("/admin/hours");
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
