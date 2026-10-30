"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/simple-select";
import { DateField } from "@/components/date-field";
import { LoadingButton } from "@/components/interior/loading-button";
import { EXPORT_COLUMN_KEYS } from "@/lib/hours-export";
import {
  createHoursExportSchedule,
  generateHoursPeriodExport,
  saveHoursExportTemplate,
} from "@/server/actions/hours-export";
import { runAction, toastAction } from "@/lib/toast-action";

type Template = {
  id: string;
  name: string;
  columns: string[];
  splitBy: "NONE" | "JOB_CODE" | "RATE";
  includeHeader: boolean;
  includeSalaried: boolean;
  approvedOnly: boolean;
  sortOrder: "EMPLOYEE_ID" | "NAME" | "EXPORT_CODE";
  isDefault: boolean;
};

type Schedule = {
  id: string;
  description: string;
  templateName: string;
  weekday: number;
  minuteOfDay: number;
  rangeDays: number;
  enabled: boolean;
  lastRunAt: string | null;
  lastError: string | null;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function PeriodExportClient({
  initialFrom,
  initialTo,
  presets,
  departments,
  defaultColumns,
  templates,
  schedules,
}: {
  initialFrom: string;
  initialTo: string;
  presets: Array<{ id: string; label: string; from: string; to: string }>;
  departments: Array<{ id: string; name: string }>;
  defaultColumns: string[];
  templates: Template[];
  schedules: Schedule[];
}) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [dept, setDept] = useState("");
  const [templateId, setTemplateId] = useState(
    templates.find((t) => t.isDefault)?.id ?? templates[0]?.id ?? "",
  );
  const selected = useMemo(
    () => templates.find((t) => t.id === templateId) ?? null,
    [templates, templateId],
  );
  const [columns, setColumns] = useState<string[]>(
    selected?.columns ?? defaultColumns,
  );
  const [splitBy, setSplitBy] = useState<"NONE" | "JOB_CODE" | "RATE">(
    selected?.splitBy ?? "NONE",
  );
  const [includeHeader, setIncludeHeader] = useState(selected?.includeHeader ?? true);
  const [includeSalaried, setIncludeSalaried] = useState(selected?.includeSalaried ?? true);
  const [approvedOnly, setApprovedOnly] = useState(selected?.approvedOnly ?? true);
  const [sortOrder, setSortOrder] = useState<"EMPLOYEE_ID" | "NAME" | "EXPORT_CODE">(
    selected?.sortOrder ?? "NAME",
  );
  const [templateName, setTemplateName] = useState("");
  const [schedDesc, setSchedDesc] = useState("Weekly hours export");
  const [weekday, setWeekday] = useState(1);
  const [pending, start] = useTransition();

  function applyTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setColumns(t.columns);
    setSplitBy(t.splitBy);
    setIncludeHeader(t.includeHeader);
    setIncludeSalaried(t.includeSalaried);
    setApprovedOnly(t.approvedOnly);
    setSortOrder(t.sortOrder);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Generate</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-3">
              <div className="space-y-1">
                <Label htmlFor="pe-from">Start date</Label>
                <DateField id="pe-from" value={from} onValueChange={setFrom} aria-label="Start date" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pe-to">Stop date</Label>
                <DateField id="pe-to" value={to} onValueChange={setTo} aria-label="Stop date" />
              </div>
              <div className="min-w-[12rem] space-y-1">
                <Label htmlFor="pe-dept">Department</Label>
                <SimpleSelect
                  id="pe-dept"
                  value={dept}
                  onValueChange={setDept}
                  placeholder="All"
                  options={[
                    { value: "", label: "All" },
                    ...departments.map((d) => ({ value: d.id, label: d.name })),
                  ]}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {presets.map((p) => (
                <Button
                  key={p.id}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={() => {
                    setFrom(p.from);
                    setTo(p.to);
                  }}
                >
                  {p.label}
                </Button>
              ))}
            </div>

            <div className="max-w-md space-y-1">
              <Label htmlFor="pe-tpl">Template</Label>
              <SimpleSelect
                id="pe-tpl"
                value={templateId}
                onValueChange={applyTemplate}
                placeholder="Custom (unsaved)"
                options={[
                  { value: "", label: "Custom (unsaved)" },
                  ...templates.map((t) => ({
                    value: t.id,
                    label: t.isDefault ? `${t.name} (default)` : t.name,
                  })),
                ]}
              />
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Settings</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={includeHeader}
                    onChange={(e) => setIncludeHeader(e.target.checked)}
                  />
                  Export header line
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={includeSalaried}
                    onChange={(e) => setIncludeSalaried(e.target.checked)}
                  />
                  Include salaried
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={approvedOnly}
                    onChange={(e) => setApprovedOnly(e.target.checked)}
                  />
                  Approved entries only
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Split by</Label>
                  <SimpleSelect
                    value={splitBy}
                    onValueChange={(v) => setSplitBy(v as typeof splitBy)}
                    options={[
                      { value: "NONE", label: "None (one row per punch)" },
                      { value: "JOB_CODE", label: "Job code" },
                      { value: "RATE", label: "Rate" },
                    ]}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Sort</Label>
                  <SimpleSelect
                    value={sortOrder}
                    onValueChange={(v) => setSortOrder(v as typeof sortOrder)}
                    options={[
                      { value: "NAME", label: "Name" },
                      { value: "EMPLOYEE_ID", label: "Employee ID" },
                      { value: "EXPORT_CODE", label: "Export code" },
                    ]}
                  />
                </div>
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Columns</legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {EXPORT_COLUMN_KEYS.map((key) => {
                  const on = columns.includes(key);
                  return (
                    <label key={key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => {
                          setColumns((prev) =>
                            on ? prev.filter((c) => c !== key) : [...prev, key],
                          );
                        }}
                      />
                      {key}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <LoadingButton
              disabled={columns.length === 0}
              pendingLabel="Generating…"
              successLabel="Downloaded"
              errorLabel="Failed"
              onAction={async () => {
                const res = await runAction(() =>
                  generateHoursPeriodExport({
                    from,
                    to,
                    columns,
                    splitBy,
                    includeHeader,
                    includeSalaried,
                    approvedOnly,
                    sortOrder,
                    templateId: templateId || undefined,
                    departmentId: dept || undefined,
                  }),
                );
                if (!toastAction(res) || !res.ok) {
                  throw new Error(res.ok ? "Export failed" : res.error);
                }
                const blob = new Blob([res.csv], {
                  type: "text/csv;charset=utf-8",
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = res.filename;
                a.click();
                URL.revokeObjectURL(url);
                toast.success(`Downloaded (${res.rowHint})`);
              }}
            >
              Generate
            </LoadingButton>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Save as template</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="min-w-[12rem] flex-1 space-y-1">
              <Label htmlFor="pe-name">Name</Label>
              <Input
                id="pe-name"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="Default job-code split"
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={pending || templateName.trim().length < 1}
              onClick={() => {
                start(async () => {
                  const res = await runAction(() =>
                    saveHoursExportTemplate({
                      name: templateName.trim(),
                      columns,
                      splitBy,
                      includeHeader,
                      includeSalaried,
                      approvedOnly,
                      sortOrder,
                      isDefault: templates.length === 0,
                    }),
                  );
                  if (!toastAction(res)) return;
                  toast.success("Template saved — refresh to select it");
                  setTemplateName("");
                });
              }}
            >
              Save as
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Automation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-xs text-muted-foreground">
              Schedules run via{" "}
              <code className="text-[10px]">scripts/run-scheduled-hours-exports.ts</code>{" "}
              (cron on the host). Files land in S3 under{" "}
              <code className="text-[10px]">payroll/hours-exports/</code>.
            </p>
            <div className="space-y-1">
              <Label>Description</Label>
              <Input value={schedDesc} onChange={(e) => setSchedDesc(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Weekday (Central)</Label>
              <SimpleSelect
                value={String(weekday)}
                onValueChange={(v) => setWeekday(Number(v))}
                options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))}
              />
            </div>
            <Button
              type="button"
              size="sm"
              disabled={pending || !templateId}
              onClick={() => {
                start(async () => {
                  const res = await runAction(() =>
                    createHoursExportSchedule({
                      templateId,
                      description: schedDesc.trim(),
                      weekday,
                      minuteOfDay: 360,
                      rangeDays: 7,
                    }),
                  );
                  if (!toastAction(res)) return;
                  toast.success("Schedule added — refresh to see it");
                });
              }}
            >
              + Add
            </Button>
            <ul className="divide-y rounded-md border">
              {schedules.length === 0 ? (
                <li className="px-3 py-4 text-xs text-muted-foreground">No automations yet.</li>
              ) : (
                schedules.map((s) => (
                  <li key={s.id} className="px-3 py-2">
                    <div className="font-medium">{s.description}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {s.templateName} · {WEEKDAYS[s.weekday]} · {s.rangeDays}d window
                      {s.enabled ? "" : " · disabled"}
                    </div>
                    {s.lastError ? (
                      <div className="text-[11px] text-destructive">{s.lastError}</div>
                    ) : null}
                  </li>
                ))
              )}
            </ul>
            <Button asChild variant="outline" size="sm" className="w-full">
              <Link href="/admin/payroll">Open payroll periods</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
