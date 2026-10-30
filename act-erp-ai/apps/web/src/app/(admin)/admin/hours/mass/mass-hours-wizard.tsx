"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [clockInTime, setClockInTime] = useState("07:00");
  const [clockOutTime, setClockOutTime] = useState("15:30");
  const [jobCode, setJobCode] = useState(jobCodes[0]?.code ?? "");
  const [reason, setReason] = useState("");
  const [approve, setApprove] = useState(false);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [pending, start] = useTransition();

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
    reason: reason.trim(),
    approve,
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Step {step} of 3 — select people, set the shift, preview, then commit.
      </p>

      {step === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Select employees ({selected.size} selected)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
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
            <ul className="max-h-[50vh] divide-y overflow-y-auto rounded-md border">
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
            <Button
              type="button"
              disabled={selected.size === 0}
              onClick={() => setStep(2)}
              className="w-full sm:w-auto"
            >
              Next
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Shift details</CardTitle>
          </CardHeader>
          <CardContent className="grid max-w-lg gap-3">
            <div className="space-y-1">
              <Label htmlFor="mh-date">Date</Label>
              <Input id="mh-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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
              <Label htmlFor="mh-job">Job code</Label>
              <select
                id="mh-job"
                value={jobCode}
                onChange={(e) => setJobCode(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {jobCodes.map((j) => (
                  <option key={j.code} value={j.code}>
                    {j.code} — {j.title}
                  </option>
                ))}
              </select>
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
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button
                type="button"
                disabled={pending || reason.trim().length < 3 || !jobCode}
                onClick={() => {
                  start(async () => {
                    const res = await runAction(() => previewMassHours(payload()));
                    toastAction(res);
                    if (res.ok) {
                      setPreview(res.rows);
                      setStep(3);
                    }
                  });
                }}
              >
                Preview
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 3 && preview ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Preview ({preview.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="max-h-[40vh] divide-y overflow-y-auto rounded-md border text-sm">
              {preview.map((r) => (
                <li key={r.employeeId} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span>
                    {r.name}
                    {r.overlap ? (
                      <span className="ml-2 text-[11px] text-destructive">
                        Skip — overlaps existing entry
                      </span>
                    ) : null}
                  </span>
                  <span className="font-mono text-xs tabular-nums">{formatHours(r.workMin)}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Overlaps are skipped so kiosk punches are not overwritten.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button
                type="button"
                disabled={pending || preview.every((r) => r.overlap)}
                onClick={() => {
                  start(async () => {
                    const res = await runAction(() => commitMassHours(payload()));
                    if (!toastAction(res)) return;
                    toast.success(
                      `Created ${res.ok ? res.created : 0}, skipped ${res.ok ? res.skipped : 0}`,
                    );
                    router.push("/admin/hours");
                    router.refresh();
                  });
                }}
              >
                Commit
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
