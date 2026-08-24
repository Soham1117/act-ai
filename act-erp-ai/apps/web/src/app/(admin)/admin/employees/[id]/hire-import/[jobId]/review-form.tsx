"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, FileText, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  applyHirePacketImport,
  cancelHirePacketImport,
  getHirePacketImportStatus,
} from "@/server/actions/hire-packet";
import {
  HIRE_PACKET_FIELD_GROUPS,
  HIRE_PACKET_FIELD_LABELS,
  type HirePacketFileResult,
  type HirePacketProposals,
} from "@/lib/hire-packet/types";
import { toastAction } from "@/lib/toast-action";

type Props = {
  jobId: string;
  employeeId: string;
  employeeName: string;
  initialStatus: string;
  initialError: string | null;
  currentValues: Record<string, string | null>;
};

const POLL_MS = 2500;

function defaultSelected(
  proposals: HirePacketProposals,
  current: Record<string, string | null>,
): Set<string> {
  const keys = new Set<string>();
  for (const [key, proposal] of Object.entries(proposals)) {
    if (!proposal?.value) continue;
    const cur = (current[key] ?? "").trim();
    const next = proposal.value.trim();
    if (!cur || cur !== next) keys.add(key);
  }
  return keys;
}

function formatDisplay(key: string, value: string | null | undefined): string {
  if (!value?.trim()) return "—";
  if (key === "dateOfBirth" || key === "dateOfHire") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString();
  }
  return value;
}

export function HireImportReviewForm({
  jobId,
  employeeId,
  employeeName,
  initialStatus,
  initialError,
  currentValues,
}: Props) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [errorMessage, setErrorMessage] = useState(initialError);
  const [proposals, setProposals] = useState<HirePacketProposals | null>(null);
  const [fileResults, setFileResults] = useState<HirePacketFileResult[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const isProcessing = status === "PENDING" || status === "PROCESSING";
  const isReady = status === "READY";
  const isFailed = status === "FAILED";
  const isApplied = status === "APPLIED";

  const refresh = useCallback(async () => {
    const res = await getHirePacketImportStatus(jobId);
    if (!res.ok) return;
    setStatus(res.status);
    setErrorMessage(res.errorMessage);
    if (res.proposedFields) {
      setProposals(res.proposedFields);
      setSelected((prev) =>
        prev.size > 0 ? prev : defaultSelected(res.proposedFields!, currentValues),
      );
    }
    if (Array.isArray(res.fileResults)) {
      setFileResults(res.fileResults as HirePacketFileResult[]);
    }
  }, [jobId, currentValues]);

  useEffect(() => {
    if (!isProcessing) return;
    const id = setInterval(() => {
      void refresh();
    }, POLL_MS);
    void refresh();
    return () => clearInterval(id);
  }, [isProcessing, refresh]);

  useEffect(() => {
    if (initialStatus === "READY" && !proposals) {
      void refresh();
    }
  }, [initialStatus, proposals, refresh]);

  const groupedFields = useMemo(() => {
    if (!proposals) return [];
    return HIRE_PACKET_FIELD_GROUPS.map((group) => ({
      ...group,
      rows: group.fields
        .map((key) => ({ key, proposal: proposals[key], current: currentValues[key] ?? null }))
        .filter((r) => r.proposal?.value),
    })).filter((g) => g.rows.length > 0);
  }, [proposals, currentValues]);

  function toggleField(key: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function onApply() {
    startTransition(async () => {
      const res = await applyHirePacketImport({
        jobId,
        selectedFields: [...selected],
      });
      if (!toastAction(res)) return;
      router.push(`/admin/employees/${employeeId}?tab=documents`);
      router.refresh();
    });
  }

  function onCancel() {
    startTransition(async () => {
      const res = await cancelHirePacketImport(jobId);
      if (!toastAction(res)) return;
      router.push(`/admin/employees/${employeeId}`);
    });
  }

  if (isProcessing) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-medium">Processing hire packet…</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Extracting text from PDFs and images. This page updates automatically.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (isFailed) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-sm font-medium">Import failed</p>
          <p className="max-w-md text-xs text-muted-foreground">{errorMessage ?? "Unknown error."}</p>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/admin/employees/${employeeId}`}>Back to employee</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (isApplied) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <CheckCircle2 className="h-8 w-8 text-green-600" />
          <p className="text-sm font-medium">Fields applied to {employeeName}</p>
          <Button size="sm" asChild>
            <Link href={`/admin/employees/${employeeId}`}>View employee profile</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!isReady || !proposals) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Loading import results…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {fileResults.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Imported files ({fileResults.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {fileResults.map((f) => (
              <div
                key={f.documentId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{f.fileName}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {f.formType.replace(/_/g, " ")}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px]">
                    {f.textSource}
                  </Badge>
                </div>
                <a
                  href={`/api/documents/${f.documentId}/file`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:underline"
                >
                  Open
                </a>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {groupedFields.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No employee fields were extracted. Documents were still saved — update the profile manually.
          </CardContent>
        </Card>
      ) : (
        groupedFields.map((group) => (
          <Card key={group.title}>
            <CardHeader>
              <CardTitle className="text-base">{group.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {group.rows.map(({ key, proposal, current }) => {
                if (!proposal) return null;
                const checked = selected.has(key);
                const differs = (current ?? "").trim() !== proposal.value.trim();
                return (
                  <div
                    key={key}
                    className="flex gap-3 rounded-md border p-3"
                  >
                    <Checkbox
                      id={`field-${key}`}
                      checked={checked}
                      disabled={pending}
                      onCheckedChange={(v) => toggleField(key, v === true)}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <Label htmlFor={`field-${key}`} className="text-sm font-medium">
                        {HIRE_PACKET_FIELD_LABELS[key as keyof typeof HIRE_PACKET_FIELD_LABELS]}
                      </Label>
                      <div className="grid gap-2 text-xs sm:grid-cols-2">
                        <div>
                          <span className="text-muted-foreground">Current: </span>
                          <span className={differs ? "" : "text-muted-foreground"}>
                            {formatDisplay(key, current)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Proposed: </span>
                          <span className="font-medium">{formatDisplay(key, proposal.value)}</span>
                        </div>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {proposal.sourceForm.replace(/_/g, " ")} · {proposal.sourceFile} ·{" "}
                        <Badge variant="outline" className="ml-1 text-[9px]">
                          {proposal.confidence}
                        </Badge>
                      </p>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          disabled={pending || selected.size === 0}
          onClick={onApply}
        >
          {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Apply {selected.size} field{selected.size === 1 ? "" : "s"}
        </Button>
        <Button variant="outline" disabled={pending} onClick={onCancel}>
          Cancel import
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/admin/employees/${employeeId}`}>Back without applying</Link>
        </Button>
      </div>
    </div>
  );
}
