import { Button } from "@/components/ui/button";
import { formatBusinessTime, formatDateOnly, formatHours } from "@/lib/format";
import type { KioskTimingEntry } from "@/server/actions/kiosk";

/** Past-30-days shift list shown on the kiosk confirm card (employees and contract crew). */
export function TimingsList({
  entries,
  totalWorkMin,
  onBack,
}: {
  entries: KioskTimingEntry[];
  totalWorkMin: number;
  onBack: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium">Past 30 days</p>
        <p className="font-mono text-sm tabular-nums">Total {formatHours(totalWorkMin)}</p>
      </div>
      {entries.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No shifts in the past 30 days.
        </p>
      ) : (
        <ul className="max-h-[45vh] divide-y overflow-auto rounded-md border text-sm">
          {entries.map((e) => (
            <li key={e.id} className="grid grid-cols-[88px_1fr_auto] items-center gap-2 px-3 py-2">
              <span className="text-xs text-muted-foreground">{formatDateOnly(e.date)}</span>
              <span className="font-mono text-xs">
                {formatBusinessTime(e.clockInIso)} →{" "}
                {e.clockOutIso ? formatBusinessTime(e.clockOutIso) : "now"}
              </span>
              <span className="font-mono text-sm tabular-nums">
                {e.clockOutIso ? formatHours(e.totalWorkMin) : "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Button variant="outline" size="lg" className="h-10 w-full text-xs" onClick={onBack}>
        Back
      </Button>
    </div>
  );
}
