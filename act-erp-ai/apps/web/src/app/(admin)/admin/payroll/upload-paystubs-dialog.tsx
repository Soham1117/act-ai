"use client";

import { useRef, useState } from "react";
import { Loader2, Upload, X, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { previewPaystub, uploadPayrollDocument, type PaystubPreview } from "@/server/actions/payroll";
import { humanizeUnexpectedError } from "@/lib/action-result";

type CalendarPeriod = { id: string; title: string; payPeriodStart: Date; payPeriodEnd: Date };
type EmployeeOption = { id: string; name: string };

type Row = {
  key: string;
  file: File;
  status: "parsing" | "ready" | "uploading" | "done" | "error";
  preview: PaystubPreview | null;
  employeeId: string | null;
  payPeriodStart: string;
  payPeriodEnd: string;
  errorMessage?: string;
};

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const CONCURRENCY = 4;

async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function toDateInput(d: Date | string | null): string {
  if (!d) return "";
  const iso = typeof d === "string" ? d : d.toISOString();
  return iso.slice(0, 10);
}

export function UploadPaystubsDialog({
  calendarPeriods,
  employees,
}: {
  calendarPeriods: CalendarPeriod[];
  employees: EmployeeOption[];
}) {
  const [open, setOpen] = useState(false);
  const [periodId, setPeriodId] = useState<string>(calendarPeriods[0]?.id ?? "");
  const [category, setCategory] = useState("Pay Stub");
  const [rows, setRows] = useState<Row[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedPeriod = calendarPeriods.find((p) => p.id === periodId) ?? null;

  function reset() {
    setRows([]);
    setCategory("Pay Stub");
    setPeriodId(calendarPeriods[0]?.id ?? "");
  }

  function updateRow(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    const newRows: Row[] = files.map((file) => ({
      key: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
      file,
      status: "parsing",
      preview: null,
      employeeId: null,
      payPeriodStart: "",
      payPeriodEnd: "",
    }));
    setRows((prev) => [...prev, ...newRows]);

    await mapWithConcurrency(newRows, CONCURRENCY, async (row) => {
      if (row.file.type !== "application/pdf") {
        updateRow(row.key, { status: "ready", errorMessage: "Not a PDF — enter details manually." });
        return;
      }
      if (row.file.size > MAX_FILE_BYTES) {
        updateRow(row.key, {
          status: "ready",
          errorMessage: "File too large to auto-read (>5 MB) — enter details manually.",
        });
        return;
      }
      try {
        const bytes = await row.file.arrayBuffer();
        const preview = await previewPaystub({
          name: row.file.name,
          type: row.file.type,
          bytes,
        });
        updateRow(row.key, {
          status: "ready",
          preview,
          employeeId: preview.match.employeeId,
          payPeriodStart: toDateInput(preview.parsed?.payPeriodStart ?? null),
          payPeriodEnd: toDateInput(preview.parsed?.payPeriodEnd ?? null),
        });
      } catch (err) {
        updateRow(row.key, {
          status: "ready",
          errorMessage: humanizeUnexpectedError(err) ?? "Couldn't read this file — enter details manually.",
        });
      }
    });
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  const readyRows = rows.filter((r) => r.status === "ready" || r.status === "error");
  const allResolved = rows.length > 0 && rows.every((r) => r.status !== "parsing" && r.status !== "uploading");
  const allHaveEmployee = readyRows.length > 0 && readyRows.every((r) => r.employeeId && r.payPeriodStart && r.payPeriodEnd);

  async function onConfirm() {
    if (!allHaveEmployee) return;
    setUploading(true);
    let succeeded = 0;
    let failed = 0;
    await mapWithConcurrency(readyRows, CONCURRENCY, async (row) => {
      updateRow(row.key, { status: "uploading" });
      const bytes = await row.file.arrayBuffer();
      const res = await uploadPayrollDocument(
        {
          employeeId: row.employeeId!,
          title: `${category} — ${row.payPeriodEnd}`,
          category,
          payPeriodStart: row.payPeriodStart,
          payPeriodEnd: row.payPeriodEnd,
        },
        { name: row.file.name, type: row.file.type || "application/pdf", bytes },
      );
      if (!res.ok) {
        updateRow(row.key, {
          status: "error",
          errorMessage: res.error || "Upload failed",
        });
        failed++;
        return;
      }
      updateRow(row.key, { status: "done" });
      succeeded++;
    });
    setUploading(false);
    if (failed === 0) {
      toast.success(`${succeeded} pay stub${succeeded === 1 ? "" : "s"} uploaded`);
      setOpen(false);
      reset();
    } else {
      toast.error(`${succeeded} uploaded, ${failed} failed — see rows below`);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v && !uploading) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Upload className="mr-1.5 h-3.5 w-3.5" />
          Upload pay stubs
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Upload pay stubs</DialogTitle>
          <DialogDescription>
            Drop every stub for a pay period at once — each file is matched to an
            employee automatically by SSN and name. Review every row before
            confirming; nothing is saved until you click Upload.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Pay period</Label>
            <Select value={periodId} onValueChange={setPeriodId} disabled={rows.length > 0}>
              <SelectTrigger>
                <SelectValue placeholder="Select a pay period" />
              </SelectTrigger>
              <SelectContent>
                {calendarPeriods.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Category</Label>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} disabled={rows.length > 0} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Files</Label>
          <Input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            multiple
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {rows.length > 0 && (
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="p-2 text-left font-medium">File</th>
                  <th className="p-2 text-left font-medium">Employee</th>
                  <th className="p-2 text-left font-medium">Pay period</th>
                  <th className="p-2 text-left font-medium">Status</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row) => {
                  const periodMismatch =
                    selectedPeriod &&
                    row.payPeriodStart &&
                    row.payPeriodEnd &&
                    (toDateInput(selectedPeriod.payPeriodStart) !== row.payPeriodStart ||
                      toDateInput(selectedPeriod.payPeriodEnd) !== row.payPeriodEnd);
                  const confidence = row.preview?.match.confidence;
                  return (
                    <tr key={row.key} className="align-top">
                      <td className="max-w-[160px] truncate p-2" title={row.file.name}>
                        {row.file.name}
                      </td>
                      <td className="p-2">
                        {row.status === "parsing" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        ) : (
                          <div className="space-y-1">
                            <Select
                              value={row.employeeId ?? ""}
                              onValueChange={(v) => updateRow(row.key, { employeeId: v })}
                            >
                              <SelectTrigger className="h-7 w-44 text-xs">
                                <SelectValue placeholder="Select employee" />
                              </SelectTrigger>
                              <SelectContent>
                                {employees.map((e) => (
                                  <SelectItem key={e.id} value={e.id}>
                                    {e.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {confidence && (
                              <Badge
                                variant={
                                  confidence === "high" ? "success" : confidence === "medium" ? "warning" : "destructive"
                                }
                                className="text-[10px]"
                              >
                                {confidence === "high" && "Matched"}
                                {confidence === "medium" && "Check this match"}
                                {(confidence === "low" || confidence === "none") && "No confident match"}
                              </Badge>
                            )}
                            {row.preview?.duplicateOf && (
                              <p className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                                <AlertTriangle className="h-3 w-3 shrink-0" />
                                Already has a stub for this period
                              </p>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="p-2">
                        {row.status !== "parsing" && (
                          <div className="space-y-1">
                            <Input
                              type="date"
                              className="h-7 w-32 text-xs"
                              value={row.payPeriodStart}
                              onChange={(e) => updateRow(row.key, { payPeriodStart: e.target.value })}
                            />
                            <Input
                              type="date"
                              className="h-7 w-32 text-xs"
                              value={row.payPeriodEnd}
                              onChange={(e) => updateRow(row.key, { payPeriodEnd: e.target.value })}
                            />
                            {periodMismatch && (
                              <p className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                                <AlertTriangle className="h-3 w-3 shrink-0" />
                                Doesn&apos;t match selected period
                              </p>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="p-2">
                        {row.status === "uploading" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        {row.status === "done" && <Badge variant="success" className="text-[10px]">Uploaded</Badge>}
                        {row.status === "error" && (
                          <span className="text-[10px] text-destructive">{row.errorMessage ?? "Failed"}</span>
                        )}
                      </td>
                      <td className="p-2">
                        {row.status !== "uploading" && row.status !== "done" && (
                          <button
                            type="button"
                            onClick={() => removeRow(row.key)}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={uploading}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={!allResolved || !allHaveEmployee || uploading || !periodId}
          >
            {uploading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Confirm &amp; upload {readyRows.length > 0 ? readyRows.length : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
