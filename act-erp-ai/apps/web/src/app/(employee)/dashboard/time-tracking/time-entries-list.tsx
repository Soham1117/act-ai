'use client';

import { Badge } from "@/components/ui/badge";
import { Globe, MonitorSmartphone, Sparkles, PenLine, History } from "lucide-react";
import type { TimeEntrySource } from "@prisma/client";
import { usePortalLanguage } from "@/components/portal-language";
import { DataListCard, ResponsiveDataList } from "@/components/mobile";

type Entry = {
  id: string;
  date: string;
  clockInIso: string;
  clockOutIso: string | null;
  jobCode: string;
  totalWorkMin: number;
  totalBreakMin: number;
  status: string;
  approvalStatus: string;
  source: TimeEntrySource;
  kioskLabel: string | null;
  kioskSlug: string | null;
  approvalNotes: string | null;
  editReason: string | null;
  edited: boolean;
  autoClosed: boolean;
};

function SourceBadge({
  source,
  kioskLabel,
  t,
}: {
  source: TimeEntrySource;
  kioskLabel?: string | null;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const cfg: Record<TimeEntrySource, { label: string; icon: React.ReactNode }> = {
    KIOSK: { label: t("timesheet.kiosk"), icon: <MonitorSmartphone className="h-3 w-3" /> },
    WEB: { label: t("timesheet.web"), icon: <Globe className="h-3 w-3" /> },
    AUTO: { label: t("timesheet.auto"), icon: <Sparkles className="h-3 w-3" /> },
    MANUAL: { label: t("timesheet.manual"), icon: <PenLine className="h-3 w-3" /> },
    TCP: { label: "TCP import", icon: <History className="h-3 w-3" /> },
  };
  const { label, icon } = cfg[source];
  const display = source === "KIOSK" && kioskLabel ? kioskLabel : label;
  return (
    <span
      title={source === "KIOSK" && kioskLabel ? t("timesheet.kioskTitle", { name: kioskLabel }) : undefined}
      className="inline-flex max-w-[140px] items-center gap-1 truncate rounded border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground"
    >
      {icon}
      <span className="truncate">{display}</span>
    </span>
  );
}

function entryVariant(approvalStatus: string) {
  return approvalStatus === "APPROVED"
    ? "success"
    : approvalStatus === "REJECTED"
      ? "destructive"
      : "warning";
}

function EntryNotes({
  e,
  t,
}: {
  e: Entry;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  return (
    <>
      {e.approvalStatus === "REJECTED" && (
        <p className="break-words rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {t("timesheet.rejectedHelp", {
            notes: e.approvalNotes
              ? `: ${e.approvalNotes.trim().replace(/[.!?]?$/, ".")}`
              : ".",
          })}
        </p>
      )}
      {e.approvalStatus !== "REJECTED" && e.approvalNotes && (
        <p className="break-words text-xs text-muted-foreground">
          {t("timesheet.adminNote", { note: e.approvalNotes })}
        </p>
      )}
      {(e.edited || e.autoClosed) && e.editReason && (
        <p className="break-words text-xs text-muted-foreground">
          {e.autoClosed ? t("timesheet.autoClosedReview") : t("timesheet.editedByAdmin")}{" "}
          {e.editReason}
        </p>
      )}
    </>
  );
}

export function TimeEntriesList({ entries }: { entries: Entry[] }) {
  const { t, formatTime, formatDateOnly, enumLabel } = usePortalLanguage();
  const formatTrackedHours = (minutes: number | null | undefined) =>
    minutes === null || minutes === undefined
      ? "—"
      : t("timesheet.hoursFormat", {
          hours: Math.floor(minutes / 60),
          minutes: (minutes % 60).toString().padStart(2, "0"),
        });

  if (entries.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">{t("timesheet.noEntries")}</p>
    );
  }

  const approvalLabel = (approvalStatus: string) =>
    approvalStatus === "APPROVED"
      ? t("timesheet.approval.approved")
      : approvalStatus === "REJECTED"
        ? t("timesheet.approval.rejected")
        : approvalStatus === "PENDING"
          ? t("timesheet.approval.pending")
          : enumLabel(approvalStatus);

  const hoursClass = (approvalStatus: string) =>
    "font-mono text-sm tabular-nums" +
    (approvalStatus === "REJECTED" ? " text-muted-foreground line-through" : "");

  return (
    <ResponsiveDataList
      className="text-sm"
      mobile={
        <ul className="space-y-2">
          {entries.map((e) => {
            const variant = entryVariant(e.approvalStatus);
            return (
              <li key={e.id} className="space-y-2">
                <DataListCard className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {formatDateOnly(e.date)}
                    </span>
                    <Badge variant={variant} className="shrink-0 text-[10px]">
                      {approvalLabel(e.approvalStatus)}
                    </Badge>
                  </div>
                  <p className="font-mono text-xs">
                    {formatTime(e.clockInIso)} → {formatTime(e.clockOutIso)}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{e.jobCode}</span>
                    <SourceBadge source={e.source} kioskLabel={e.kioskLabel} t={t} />
                  </div>
                  <span className={hoursClass(e.approvalStatus)}>
                    {formatTrackedHours(e.totalWorkMin)}
                  </span>
                </DataListCard>
                <EntryNotes e={e} t={t} />
              </li>
            );
          })}
        </ul>
      }
      desktop={
        <ul className="divide-y">
          {entries.map((e) => {
            const variant = entryVariant(e.approvalStatus);
            return (
              <li
                key={e.id}
                className="grid grid-cols-[100px_1fr_auto_auto_auto] items-center gap-3 py-2.5"
              >
                <span className="text-xs text-muted-foreground">{formatDateOnly(e.date)}</span>
                <span className="font-mono text-xs">
                  {formatTime(e.clockInIso)} → {formatTime(e.clockOutIso)}
                </span>
                <span className="font-mono text-xs text-muted-foreground">{e.jobCode}</span>
                <SourceBadge source={e.source} kioskLabel={e.kioskLabel} t={t} />
                <div className="flex items-center gap-2">
                  <span className={hoursClass(e.approvalStatus)}>
                    {formatTrackedHours(e.totalWorkMin)}
                  </span>
                  <Badge variant={variant} className="text-[10px]">
                    {approvalLabel(e.approvalStatus)}
                  </Badge>
                </div>
                {e.approvalStatus === "REJECTED" && (
                  <p className="col-span-full break-words rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                    {t("timesheet.rejectedHelp", {
                      notes: e.approvalNotes
                        ? `: ${e.approvalNotes.trim().replace(/[.!?]?$/, ".")}`
                        : ".",
                    })}
                  </p>
                )}
                {e.approvalStatus !== "REJECTED" && e.approvalNotes && (
                  <p className="col-span-full break-words text-xs text-muted-foreground">
                    {t("timesheet.adminNote", { note: e.approvalNotes })}
                  </p>
                )}
                {(e.edited || e.autoClosed) && e.editReason && (
                  <p className="col-span-full break-words text-xs text-muted-foreground">
                    {e.autoClosed ? t("timesheet.autoClosedReview") : t("timesheet.editedByAdmin")}{" "}
                    {e.editReason}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      }
    />
  );
}
