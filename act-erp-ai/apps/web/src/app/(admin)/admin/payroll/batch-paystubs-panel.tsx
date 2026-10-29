"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Eye, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { humanizeUnexpectedError } from "@/lib/action-result";
import { bulkUpdatePaystubRows, canBulkReviewPaystub } from "@/lib/paystub-bulk-review";
import type {
  BatchDecision,
  BatchPage,
  BatchPreview,
  BatchReceipt,
} from "@/lib/paystub-import";
import { confirmPaystubBatch, previewPaystubBatch } from "@/server/actions/paystub-batch";

type Period = { payPeriodStart: Date; payPeriodEnd: Date };
type Employee = { id: string; name: string };
type ReviewRow = {
  key: string;
  sourceId: string;
  page: BatchPage;
  employeeId: string;
  start: string;
  end: string;
  selected: boolean;
  reviewed: boolean;
  overrideReason: string;
  dateReason: string;
  duplicateMode: BatchDecision["duplicateMode"];
  replaceId: string;
  receipt?: BatchReceipt;
};
type Source = {
  id: string;
  file: File;
  preview?: BatchPreview;
  ocr: boolean;
  error?: string;
};
const MAX_BYTES = 10 * 1024 * 1024;
const date = (value: Date | string | null | undefined) =>
  value instanceof Date ? value.toISOString().slice(0, 10) : (value?.slice(0, 10) ?? "");
const complete = (row: ReviewRow) => row.receipt && row.receipt.status !== "FAILED";

function MatchMark({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium ${ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}
      title={`${label}: ${ok ? "match" : "no match"}`}
    >
      {ok ? <Check className="h-3.5 w-3.5" aria-hidden /> : <X className="h-3.5 w-3.5" aria-hidden />}
      <span className="sr-only">
        {label} {ok ? "match" : "no match"}
      </span>
      <span aria-hidden>{label}</span>
    </span>
  );
}

export function BatchPaystubsPanel({
  employees,
  selectedPeriod,
  onClose,
  onSavingChange,
  onHasRowsChange,
}: {
  employees: Employee[];
  selectedPeriod: Period | null;
  onClose: () => void;
  onSavingChange: (saving: boolean) => void;
  onHasRowsChange: (hasRows: boolean) => void;
}) {
  const router = useRouter();
  const [sources, setSources] = useState<Source[]>([]);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState<string[] | null>(null);
  const [finalChecked, setFinalChecked] = useState(false);
  const generation = useRef(0);
  const active = useRef(false);
  const previewWindows = useRef<Array<{ url: string; window: Window }>>([]);

  useEffect(() => {
    const requestGeneration = generation;
    const interval = window.setInterval(() => {
      previewWindows.current = previewWindows.current.filter((entry) => {
        if (!entry.window.closed) return true;
        URL.revokeObjectURL(entry.url);
        return false;
      });
    }, 1000);
    return () => {
      requestGeneration.current++;
      window.clearInterval(interval);
      previewWindows.current.forEach((entry) => URL.revokeObjectURL(entry.url));
    };
  }, []);

  function updateRow(key: string, patch: Partial<ReviewRow>) {
    setConfirmation(null);
    setFinalChecked(false);
    setRows((current) =>
      current.map((row) =>
        row.key === key ? { ...row, ...patch, reviewed: patch.reviewed ?? false } : row,
      ),
    );
  }

  function batchDuplicate(row: ReviewRow) {
    return (
      !!row.employeeId &&
      !!row.start &&
      !!row.end &&
      rows.some(
        (other) =>
          other.key !== row.key &&
          other.employeeId === row.employeeId &&
          other.start === row.start &&
          other.end === row.end &&
          other.page.status === "SUPPORTED",
      )
    );
  }

  function needsOverride(row: ReviewRow) {
    return (
      row.employeeId !== row.page.match.employeeId ||
      row.page.match.confidence !== "high" ||
      row.page.extraction === "OCR"
    );
  }

  function needsDateReason(row: ReviewRow) {
    return (
      row.start !== date(row.page.parsed?.payPeriodStart) ||
      row.end !== date(row.page.parsed?.payPeriodEnd) ||
      !!(
        selectedPeriod &&
        (row.start !== date(selectedPeriod.payPeriodStart) ||
          row.end !== date(selectedPeriod.payPeriodEnd))
      )
    );
  }

  function relevantDuplicates(row: ReviewRow) {
    return row.page.duplicates.filter(
      (duplicate) => duplicate.employeeId === row.employeeId || duplicate.exact,
    );
  }

  function skipped(row: ReviewRow) {
    return (
      row.page.duplicates.some((duplicate) => duplicate.exact) ||
      ((relevantDuplicates(row).length > 0 || batchDuplicate(row)) &&
        row.duplicateMode === "KEEP")
    );
  }

  function problem(row: ReviewRow): string | null {
    if (row.page.status !== "SUPPORTED")
      return row.page.reason || "This page cannot be imported.";
    if (skipped(row)) return "This page will be skipped.";
    if (!row.employeeId) return "Choose an employee.";
    if (!row.start || !row.end || row.end < row.start) return "Enter a valid pay period.";
    if (needsOverride(row) && row.overrideReason.trim().length < 5)
      return "Explain the employee assignment (at least 5 characters).";
    if (needsDateReason(row) && row.dateReason.trim().length < 5)
      return "Explain the pay period difference (at least 5 characters).";
    if (
      row.duplicateMode === "REPLACE" &&
      !row.page.duplicates.some(
        (duplicate) =>
          duplicate.id === row.replaceId && duplicate.employeeId === row.employeeId,
      )
    )
      return "Choose the exact document to replace.";
    if (!row.reviewed) return "Review this page and confirm its details.";
    return null;
  }

  async function analyze(source: Source, run: number) {
    try {
      const bytes = await source.file.arrayBuffer();
      if (run !== generation.current) return;
      const result = await previewPaystubBatch(
        { name: source.file.name, type: source.file.type || "application/pdf", bytes },
        { ocr: source.ocr },
      );
      if (run !== generation.current) return;
      if (!result.ok) throw new Error(result.error);
      setSources((current) =>
        current.map((item) =>
          item.id === source.id
            ? { ...item, preview: result, error: undefined, ocr: source.ocr }
            : item,
        ),
      );
      setRows((current) => [
        ...current.filter((row) => row.sourceId !== source.id),
        ...result.pages.map((page) => {
          const existing = current.find(
            (row) => row.key === `${source.id}-${page.pageNumber}`,
          );
          if (existing && complete(existing)) return existing;
          return {
            key: `${source.id}-${page.pageNumber}`,
            sourceId: source.id,
            page,
            employeeId: page.match.employeeId ?? "",
            start: date(page.parsed?.payPeriodStart),
            end: date(page.parsed?.payPeriodEnd),
            selected: false,
            reviewed: false,
            overrideReason: "",
            dateReason: "",
            duplicateMode: "KEEP" as const,
            replaceId: "",
          };
        }),
      ]);
    } catch (error) {
      if (run !== generation.current) return;
      setSources((current) =>
        current.map((item) =>
          item.id === source.id
            ? {
                ...item,
                error:
                  humanizeUnexpectedError(error) ??
                  "Could not analyze this PDF. Try again.",
              }
            : item,
        ),
      );
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length || active.current) return;
    const added = Array.from(files).map((file) => ({
      id: crypto.randomUUID(),
      file,
      ocr: false,
      error:
        file.size > MAX_BYTES
          ? "Larger than 10 MB. Choose a smaller PDF."
          : (file.type && file.type !== "application/pdf") ||
              !file.name.toLowerCase().endsWith(".pdf")
            ? "Choose a PDF file."
            : undefined,
    }));
    active.current = true;
    const run = ++generation.current;
    setSources((current) => [...current, ...added]);
    onHasRowsChange(true);
    setAnalyzing(true);
    setMessage("");
    setConfirmation(null);
    for (const source of added) {
      if (run !== generation.current) break;
      if (!source.error) await analyze(source, run);
    }
    if (run === generation.current) {
      active.current = false;
      setAnalyzing(false);
    }
  }

  async function retryAnalysis(source: Source, ocr: boolean) {
    if (active.current) return;
    active.current = true;
    const run = ++generation.current;
    setAnalyzing(true);
    setMessage("");
    setConfirmation(null);
    await analyze({ ...source, ocr }, run);
    if (run === generation.current) {
      active.current = false;
      setAnalyzing(false);
    }
  }

  function cancelAnalysis() {
    generation.current++;
    active.current = false;
    setAnalyzing(false);
    setMessage(
      "Analysis canceled. Completed previews are retained; pending responses will be ignored.",
    );
    setSources((current) =>
      current.map((source) =>
        !source.preview && !source.error
          ? { ...source, error: "Analysis canceled. Retry when ready." }
          : source,
      ),
    );
  }

  async function openPage(row: ReviewRow) {
    const source = sources.find((item) => item.id === row.sourceId);
    if (!source) return;
    const popup = window.open("", "_blank");
    if (!popup) {
      setMessage("Allow pop-ups to preview this page.");
      return;
    }
    popup.opener = null;
    popup.document.title = `Pay stub page ${row.page.pageNumber}`;
    popup.document.body.textContent = "Preparing this page…";
    try {
      const { PDFDocument, PDFName } = await import("pdf-lib");
      const original = await PDFDocument.load(await source.file.arrayBuffer());
      const single = await PDFDocument.create();
      const originalPage = original.getPage(row.page.pageNumber - 1);
      for (const key of ["Annots", "AA", "Metadata", "PieceInfo", "AF", "PresSteps"]) {
        originalPage.node.delete(PDFName.of(key));
      }
      const [page] = await single.copyPages(original, [row.page.pageNumber - 1]);
      single.addPage(page);
      const bytes = await single.save();
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
      );
      if (popup.closed) {
        URL.revokeObjectURL(url);
        return;
      }
      previewWindows.current.push({ url, window: popup });
      popup.location.replace(url);
    } catch {
      popup.close();
      setMessage(
        "Could not preview this page. Check that the PDF is readable and try again.",
      );
    }
  }

  const pending = rows.filter((row) => !complete(row));
  const selectable = pending.filter((row) => canBulkReviewPaystub(row, skipped(row)));
  const selected = selectable.filter((row) => row.selected);
  const allSelected = selectable.length > 0 && selectable.every((row) => row.selected);
  const allReviewed = selected.length > 0 && selected.every((row) => row.reviewed);
  const unresolved = pending.filter(
    (row) => !skipped(row) && row.page.status === "SUPPORTED" && problem(row),
  );
  const ready = pending.filter((row) => !problem(row));
  const failed = pending.filter((row) => row.receipt?.status === "FAILED");
  const confirmationRows = confirmation
    ? rows.filter((row) => confirmation.includes(row.key))
    : [];

  function bulkUpdate(action: "select" | "deselect" | "review" | "unreview") {
    if (saving || analyzing) return;
    setConfirmation(null);
    setFinalChecked(false);
    setRows((current) => bulkUpdatePaystubRows(current, action, skipped));
  }

  function reviewSelection(onlyFailed = false) {
    const chosen = selected.filter(
      (row) => !onlyFailed || row.receipt?.status === "FAILED",
    );
    if (!chosen.length || chosen.some((row) => problem(row))) return;
    setConfirmation(chosen.map((row) => row.key));
    setFinalChecked(false);
    setMessage("");
  }

  async function saveSelection() {
    if (
      !finalChecked ||
      !confirmationRows.length ||
      confirmationRows.some((row) => problem(row)) ||
      active.current
    )
      return;
    active.current = true;
    const run = ++generation.current;
    setSaving(true);
    onSavingChange(true);
    try {
      for (const source of sources) {
        const chosen = confirmationRows.filter(
          (row) => row.sourceId === source.id && !complete(row),
        );
        if (!chosen.length || !source.preview) continue;
        try {
          const decisions: BatchDecision[] = chosen.map((row) => {
            const target = row.page.duplicates.find(
              (duplicate) => duplicate.id === row.replaceId,
            );
            return {
              pageNumber: row.page.pageNumber,
              employeeId: row.employeeId,
              payPeriodStart: row.start,
              payPeriodEnd: row.end,
              reviewToken: row.page.reviewToken,
              confirmed: true,
              overrideReason: row.overrideReason.trim() || undefined,
              dateReason: row.dateReason.trim() || undefined,
              duplicateMode: row.duplicateMode,
              ...(row.duplicateMode === "REPLACE" && target
                ? { replaceId: target.id, replaceVersion: target.version }
                : {}),
            };
          });
          const result = await confirmPaystubBatch(
            { sourceHash: source.preview.sourceHash, ocr: source.ocr, rows: decisions },
            {
              name: source.file.name,
              type: source.file.type || "application/pdf",
              bytes: await source.file.arrayBuffer(),
            },
          );
          if (run !== generation.current) return;
          if (!result.ok) throw new Error(result.error);
          setRows((current) =>
            current.map((row) => {
              if (!chosen.some((item) => item.key === row.key)) return row;
              const receipt = result.results.find(
                (item) => item.pageNumber === row.page.pageNumber,
              ) ?? {
                pageNumber: row.page.pageNumber,
                status: "FAILED" as const,
                error: "No result received. Retry this page.",
              };
              return { ...row, receipt, selected: receipt.status === "FAILED" };
            }),
          );
        } catch (error) {
          if (run !== generation.current) return;
          const errorMessage =
            humanizeUnexpectedError(error) ?? "Upload failed. Retry this page.";
          setRows((current) =>
            current.map((row) =>
              chosen.some((item) => item.key === row.key)
                ? {
                    ...row,
                    receipt: {
                      pageNumber: row.page.pageNumber,
                      status: "FAILED",
                      error: errorMessage,
                    },
                  }
                : row,
            ),
          );
        }
      }
      setMessage(
        "Import finished. Saved and existing pages are retained below. Retry only failed pages after reviewing any errors.",
      );
      setConfirmation(null);
      setFinalChecked(false);
      // Refresh the payroll list while keeping receipts and failed rows in this dialog.
      router.refresh();
    } finally {
      if (run === generation.current) {
        active.current = false;
        setSaving(false);
        onSavingChange(false);
      }
    }
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="batch-paystub-files">PDF files</Label>
        <Input
          id="batch-paystub-files"
          type="file"
          accept="application/pdf,.pdf"
          multiple
          disabled={analyzing || saving || !selectedPeriod}
          onChange={(event) => {
            void handleFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <p className="text-xs text-muted-foreground">
          Up to 10 MB and 200 pages per PDF. One row per page — Name/SSN show match vs
          mismatch. Reasons only appear when confirmation is required.
        </p>
      </div>
      {analyzing && (
        <div role="status" className="flex flex-wrap items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Analyzing PDFs…
          <Button type="button" size="sm" variant="outline" onClick={cancelAnalysis}>
            Cancel processing
          </Button>
        </div>
      )}
      {message && (
        <p role="status" className="break-words text-sm">
          {message}
        </p>
      )}
      {sources.map((source) => (
        <div key={source.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="min-w-0 break-all font-medium">
            {source.file.name}
            {source.preview ? ` · ${source.preview.pageCount} pages` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {source.preview?.pages.some((page) => page.status === "OCR_REQUIRED") && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={analyzing || saving}
                onClick={() => void retryAnalysis(source, true)}
              >
                Use OCR for scanned pages
              </Button>
            )}
            {(source.error ||
              rows.some(
                (row) => row.sourceId === source.id && row.receipt?.status === "FAILED",
              )) && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={
                  analyzing ||
                  saving ||
                  source.file.size > MAX_BYTES ||
                  !source.file.name.toLowerCase().endsWith(".pdf")
                }
                onClick={() => void retryAnalysis(source, source.ocr)}
              >
                {source.preview ? "Analyze again" : "Retry analysis"}
              </Button>
            )}
          </div>
          {source.error && (
            <p role="alert" className="w-full text-sm text-destructive">
              {source.error}
            </p>
          )}
        </div>
      ))}
      {!!rows.length && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[960px] text-left text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="p-0 font-medium">
                  <label className="flex min-h-11 min-w-11 cursor-pointer items-center p-2 has-[:disabled]:cursor-not-allowed">
                    <Checkbox
                      checked={allSelected ? true : selected.length ? "indeterminate" : false}
                      disabled={saving || analyzing || !selectable.length}
                      aria-label="Select all importable pages"
                      onCheckedChange={(value) => bulkUpdate(value === true ? "select" : "deselect")}
                    />
                  </label>
                </th>
                <th className="p-2 font-medium">Page</th>
                <th className="p-2 font-medium">Extracted</th>
                <th className="p-2 font-medium">Name</th>
                <th className="p-2 font-medium">SSN</th>
                <th className="p-2 font-medium">Match</th>
                <th className="p-2 font-medium">Employee</th>
                <th className="p-2 font-medium">Period</th>
                <th className="p-0 font-medium">
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 p-2 has-[:disabled]:cursor-not-allowed">
                    <Checkbox
                      checked={allReviewed ? true : selected.some((row) => row.reviewed) ? "indeterminate" : false}
                      disabled={saving || analyzing || !selected.length}
                      aria-label="Mark all selected pages as reviewed"
                      onCheckedChange={(value) => bulkUpdate(value === true ? "review" : "unreview")}
                    />
                    Review
                  </label>
                </th>
                <th className="p-2 font-medium"> </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => {
                const locked = !!complete(row) || saving || analyzing;
                const exact = row.page.duplicates.some((duplicate) => duplicate.exact);
                const hasDuplicate =
                  relevantDuplicates(row).length > 0 || batchDuplicate(row);
                const issue = problem(row);
                const needsExtra =
                  row.page.status === "SUPPORTED" &&
                  !exact &&
                  (needsOverride(row) || needsDateReason(row) || hasDuplicate);
                const sourceName =
                  sources.find((source) => source.id === row.sourceId)?.file.name ?? "";
                return (
                  <Fragment key={row.key}>
                    <tr
                      aria-label={`Page ${row.page.pageNumber} of ${sourceName}`}
                      className="align-top"
                    >
                      <td className="relative min-w-11 p-0">
                        <label className="absolute inset-0 flex cursor-pointer items-start p-2 has-[:disabled]:cursor-not-allowed">
                          <Checkbox
                          checked={row.selected}
                          disabled={
                            locked ||
                            row.page.status !== "SUPPORTED" ||
                            exact ||
                            skipped(row)
                          }
                          aria-label={`Select page ${row.page.pageNumber} of ${sourceName}`}
                          onCheckedChange={(value) =>
                            updateRow(row.key, {
                              selected: value === true,
                              reviewed: row.reviewed,
                            })
                          }
                          />
                        </label>
                      </td>
                      <td className="whitespace-nowrap p-2">
                        <div className="font-medium">{row.page.pageNumber}</div>
                        <Badge
                          variant={
                            row.receipt?.status === "FAILED"
                              ? "destructive"
                              : row.receipt
                                ? "success"
                                : "outline"
                          }
                          className="mt-1 text-[10px]"
                        >
                          {row.receipt?.status ??
                            (skipped(row)
                              ? "Skipped"
                              : row.page.status === "SUPPORTED"
                                ? row.page.extraction === "OCR"
                                  ? "OCR"
                                  : issue ? "Needs review" : "Ready"
                                : row.page.status === "OCR_REQUIRED"
                                  ? "OCR needed"
                                  : "Unsupported")}
                        </Badge>
                      </td>
                      <td className="max-w-[140px] p-2">
                        <div className="truncate font-medium" title={row.page.parsed?.employeeName ?? undefined}>
                          {row.page.parsed?.employeeName || "—"}
                        </div>
                        <div className="text-muted-foreground">
                          {row.page.parsed?.ssnLast4
                            ? `•••-••-${row.page.parsed.ssnLast4}`
                            : "No SSN"}
                        </div>
                      </td>
                      <td className="p-2">
                        {row.page.status === "SUPPORTED" ? (
                          <MatchMark ok={row.page.match.nameOk} label="Name" />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="p-2">
                        {row.page.status === "SUPPORTED" ? (
                          <MatchMark ok={row.page.match.ssnOk} label="SSN" />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="p-2">
                        {row.page.status === "SUPPORTED" ? (
                          <Badge
                            variant={
                              row.page.match.confidence === "high"
                                ? "success"
                                : row.page.match.confidence === "medium"
                                  ? "warning"
                                  : "destructive"
                            }
                            className="text-[10px]"
                          >
                            {row.page.match.confidence}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">
                            {row.page.reason || "Cannot import"}
                          </span>
                        )}
                      </td>
                      <td className="min-w-[160px] p-2">
                        {row.page.status === "SUPPORTED" && !exact ? (
                          <Select
                            value={row.employeeId}
                            disabled={locked}
                            onValueChange={(value) =>
                              updateRow(row.key, {
                                employeeId: value,
                                replaceId: "",
                                duplicateMode: "KEEP",
                              })
                            }
                          >
                            <SelectTrigger
                              className="h-8 w-full min-w-0"
                              aria-label={`Employee for page ${row.page.pageNumber} of ${sourceName}`}
                            >
                              <SelectValue placeholder="Choose" />
                            </SelectTrigger>
                            <SelectContent>
                              {employees.map((employee) => (
                                <SelectItem key={employee.id} value={employee.id}>
                                  {employee.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : exact ? (
                          <span className="text-muted-foreground">Already imported</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="min-w-[180px] p-2">
                        {row.page.status === "SUPPORTED" && !exact ? (
                          <div className="flex flex-col gap-1">
                            <Input
                              className="h-8"
                              type="date"
                              value={row.start}
                              disabled={locked}
                              aria-label={`Period start page ${row.page.pageNumber} of ${sourceName}`}
                              onChange={(event) =>
                                updateRow(row.key, { start: event.target.value })
                              }
                            />
                            <Input
                              className="h-8"
                              type="date"
                              value={row.end}
                              disabled={locked}
                              aria-label={`Period end page ${row.page.pageNumber} of ${sourceName}`}
                              onChange={(event) =>
                                updateRow(row.key, { end: event.target.value })
                              }
                            />
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="relative min-w-11 p-0">
                        {row.page.status === "SUPPORTED" && !exact ? (
                          <label className="absolute inset-0 flex cursor-pointer items-start p-2 has-[:disabled]:cursor-not-allowed">
                            <Checkbox
                            checked={row.reviewed}
                            disabled={locked || skipped(row)}
                            aria-label={`Reviewed page ${row.page.pageNumber} of ${sourceName}`}
                            onCheckedChange={(value) =>
                              updateRow(row.key, { reviewed: value === true })
                            }
                            />
                          </label>
                        ) : null}
                      </td>
                      <td className="p-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 px-2"
                          onClick={() => void openPage(row)}
                          aria-label={`Preview page ${row.page.pageNumber} of ${sourceName}`}
                        >
                          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      </td>
                    </tr>
                    {needsExtra && (
                      <tr className="bg-muted/20">
                        <td colSpan={10} className="space-y-2 p-2">
                          {needsOverride(row) && (
                            <Input
                              maxLength={500}
                              value={row.overrideReason}
                              disabled={locked}
                              placeholder="Employee assignment reason (required)"
                              aria-label={`Employee assignment reason page ${row.page.pageNumber} of ${sourceName}`}
                              onChange={(event) =>
                                updateRow(row.key, { overrideReason: event.target.value })
                              }
                            />
                          )}
                          {needsDateReason(row) && (
                            <Input
                              maxLength={500}
                              value={row.dateReason}
                              disabled={locked}
                              placeholder="Pay period reason (required)"
                              aria-label={`Pay period reason page ${row.page.pageNumber} of ${sourceName}`}
                              onChange={(event) =>
                                updateRow(row.key, { dateReason: event.target.value })
                              }
                            />
                          )}
                          {hasDuplicate && (
                            <div className="flex flex-wrap items-center gap-2">
                              <Select
                                value={row.duplicateMode}
                                disabled={locked}
                                onValueChange={(value) =>
                                  updateRow(row.key, {
                                    duplicateMode: value as BatchDecision["duplicateMode"],
                                    selected: false,
                                    replaceId: "",
                                  })
                                }
                              >
                                <SelectTrigger
                                  className="h-8 w-56"
                                  aria-label={`Duplicate handling page ${row.page.pageNumber} of ${sourceName}`}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="KEEP">Skip (keep existing)</SelectItem>
                                  <SelectItem value="ADDITIONAL">Save as additional</SelectItem>
                                  {row.page.duplicates.some(
                                    (duplicate) => duplicate.employeeId === row.employeeId,
                                  ) && (
                                    <SelectItem value="REPLACE">Replace existing</SelectItem>
                                  )}
                                </SelectContent>
                              </Select>
                              {row.duplicateMode === "REPLACE" && (
                                <Select
                                  value={row.replaceId}
                                  disabled={locked}
                                  onValueChange={(value) =>
                                    updateRow(row.key, { replaceId: value })
                                  }
                                >
                                  <SelectTrigger
                                    className="h-8 w-64"
                                    aria-label={`Document to replace page ${row.page.pageNumber} of ${sourceName}`}
                                  >
                                    <SelectValue placeholder="Document to replace" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {row.page.duplicates
                                      .filter(
                                        (duplicate) =>
                                          duplicate.employeeId === row.employeeId,
                                      )
                                      .map((duplicate) => (
                                        <SelectItem key={duplicate.id} value={duplicate.id}>
                                          {duplicate.title} · {date(duplicate.payPeriodStart)}–
                                          {date(duplicate.payPeriodEnd)}
                                        </SelectItem>
                                      ))}
                                  </SelectContent>
                                </Select>
                              )}
                            </div>
                          )}
                          {row.selected && issue && (
                            <p className="text-destructive">{issue}</p>
                          )}
                        </td>
                      </tr>
                    )}
                    {row.receipt?.error && (
                      <tr className="bg-muted/20">
                        <td colSpan={10} className="p-2">
                          <p role="alert" className="text-destructive">
                            {row.receipt.error}
                          </p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!!rows.length && (
        <p role="status" className="text-sm">
          {ready.length} ready ·{" "}
          {
            rows.filter(
              (row) =>
                skipped(row) ||
                row.receipt?.status === "SKIPPED" ||
                row.receipt?.status === "EXISTING",
            ).length
          }{" "}
          skipped · {unresolved.length} unresolved ·{" "}
          {rows.filter((row) => row.page.status !== "SUPPORTED").length} unsupported / OCR
          · {rows.filter((row) => row.receipt?.status === "SAVED").length} saved
          {failed.length ? ` · ${failed.length} failed` : ""}
        </p>
      )}
      {confirmation && (
        <section
          className="space-y-3 rounded-md border p-3"
          aria-label="Confirm selected pages"
        >
          <p className="text-sm font-medium">
            Confirm {confirmationRows.length} selected page
            {confirmationRows.length === 1 ? "" : "s"}
          </p>
          <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
            {confirmationRows.map((row) => (
              <li key={row.key} className="break-words">
                {sources.find((source) => source.id === row.sourceId)?.file.name}, page{" "}
                {row.page.pageNumber}:{" "}
                {employees.find((employee) => employee.id === row.employeeId)?.name} ·{" "}
                {row.start} to {row.end}
              </li>
            ))}
          </ul>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={finalChecked}
              disabled={saving}
              onCheckedChange={(value) => setFinalChecked(value === true)}
            />
            I confirm these selected pages and any document replacements.
          </label>
        </section>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <Button
          type="button"
          variant="outline"
          disabled={saving || analyzing || !selectable.length}
          onClick={() => bulkUpdate(allSelected ? "deselect" : "select")}
        >
          {allSelected ? "Clear selection" : "Select all"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={saving || analyzing || !selected.length}
          onClick={() => bulkUpdate(allReviewed ? "unreview" : "review")}
        >
          {allReviewed ? "Clear review" : "Mark selected as reviewed"} ({selected.length})
        </Button>
        <span className="flex-1" />
        <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
          Back to payroll
        </Button>
        {failed.length > 0 && (
          <Button
            type="button"
            variant="outline"
            disabled={
              analyzing ||
              saving ||
              !selected.some((row) => row.receipt?.status === "FAILED") ||
              selected
                .filter((row) => row.receipt?.status === "FAILED")
                .some((row) => problem(row))
            }
            onClick={() => reviewSelection(true)}
          >
            Retry failed pages
          </Button>
        )}
        {confirmation ? (
          <Button
            type="button"
            disabled={saving || analyzing || !finalChecked}
            onClick={() => void saveSelection()}
          >
            {saving && (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            Save {confirmationRows.length} selected pages
          </Button>
        ) : (
          <Button
            type="button"
            disabled={
              saving ||
              analyzing ||
              !selected.length ||
              selected.some((row) => problem(row))
            }
            onClick={() => reviewSelection()}
          >
            Review selected ({selected.length})
          </Button>
        )}
      </div>
    </div>
  );
}
