import { Badge } from "@/components/ui/badge";
import { formatHours } from "@/lib/format";
import { Globe, MonitorSmartphone, Sparkles, PenLine } from "lucide-react";
import type { TimeEntrySource } from "@prisma/client";

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
};

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function SourceBadge({
  source,
  kioskLabel,
}: {
  source: TimeEntrySource;
  kioskLabel?: string | null;
}) {
  const cfg: Record<TimeEntrySource, { label: string; icon: React.ReactNode }> = {
    KIOSK: { label: "Kiosk", icon: <MonitorSmartphone className="h-3 w-3" /> },
    WEB: { label: "Web", icon: <Globe className="h-3 w-3" /> },
    AUTO: { label: "Auto", icon: <Sparkles className="h-3 w-3" /> },
    MANUAL: { label: "Manual", icon: <PenLine className="h-3 w-3" /> },
  };
  const { label, icon } = cfg[source];
  const display = source === "KIOSK" && kioskLabel ? kioskLabel : label;
  return (
    <span
      title={source === "KIOSK" && kioskLabel ? `Kiosk: ${kioskLabel}` : undefined}
      className="inline-flex max-w-[140px] items-center gap-1 truncate rounded border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground"
    >
      {icon}
      <span className="truncate">{display}</span>
    </span>
  );
}

export function TimeEntriesList({ entries }: { entries: Entry[] }) {
  if (entries.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">No entries yet.</p>
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
            <span className="text-xs text-muted-foreground">{fmtDate(e.date)}</span>
            <span className="font-mono text-xs">
              {fmtTime(e.clockInIso)} → {fmtTime(e.clockOutIso)}
            </span>
            <span className="font-mono text-xs text-muted-foreground">{e.jobCode}</span>
            <SourceBadge source={e.source} kioskLabel={e.kioskLabel} />
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm tabular-nums">
                {formatHours(e.totalWorkMin)}
              </span>
              <Badge variant={variant} className="text-[10px]">
                {e.approvalStatus}
              </Badge>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
