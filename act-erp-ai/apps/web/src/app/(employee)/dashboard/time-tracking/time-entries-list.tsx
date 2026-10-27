'use client';

import { Badge } from "@/components/ui/badge";
import { Globe, MonitorSmartphone, Sparkles, PenLine } from "lucide-react";
import type { TimeEntrySource } from "@prisma/client";
import { usePortalLanguage } from "@/components/portal-language";

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

  return (
    <ul className="divide-y text-sm">
      {entries.map((e) => {
        const variant =
          e.approvalStatus === "APPROVED"
            ? "success"
            : e.approvalStatus === "REJECTED"
              ? "destructive"
              : "warning";
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
              <span
                className={
                  "font-mono text-sm tabular-nums" +
                  (e.approvalStatus === "REJECTED" ? " text-muted-foreground line-through" : "")
                }
              >
                {formatTrackedHours(e.totalWorkMin)}
              </span>
              <Badge variant={variant} className="text-[10px]">
                {e.approvalStatus === "APPROVED"
                  ? t("timesheet.approval.approved")
                  : e.approvalStatus === "REJECTED"
                    ? t("timesheet.approval.rejected")
                    : e.approvalStatus === "PENDING"
                      ? t("timesheet.approval.pending")
                      : enumLabel(e.approvalStatus)}
              </Badge>
            </div>
            {e.approvalStatus === "REJECTED" && (
              <p className="col-span-full rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {t("timesheet.rejectedHelp", {
                  notes: e.approvalNotes
                    ? `: ${e.approvalNotes.trim().replace(/[.!?]?$/, ".")}`
                    : ".",
                })}
              </p>
            )}
            {e.approvalStatus !== "REJECTED" && e.approvalNotes && (
              <p className="col-span-full text-xs text-muted-foreground">
                {t("timesheet.adminNote", { note: e.approvalNotes })}
              </p>
            )}
            {(e.edited || e.autoClosed) && e.editReason && (
              <p className="col-span-full text-xs text-muted-foreground">
                {e.autoClosed ? t("timesheet.autoClosedReview") : t("timesheet.editedByAdmin")}{" "}
                {e.editReason}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
