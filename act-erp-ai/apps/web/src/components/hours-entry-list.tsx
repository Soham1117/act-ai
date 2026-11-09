import { Fragment, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PanelSlot, PanelSlotRow } from "@/components/inline-panel";
import { ResponsiveDataList } from "@/components/mobile";
import { formatBusinessTime, formatDateOnly, formatHours } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  hoursRowClass,
  hoursTableClass,
  hoursTdClass,
  hoursThClass,
  hoursTheadClass,
} from "@/components/hours-ui";

export type HoursEntryPresentation = {
  id: string;
  name: string;
  code: string;
  href: string;
  avatar?: string;
  date: string;
  clockIn: string;
  clockOut: string | null;
  workMin: number;
  breakMin: number;
  approvalStatus: string;
  open: boolean;
  autoClosed: boolean;
  editReason?: string | null;
  approvalNotes?: string | null;
  sourceLabel?: string;
  metadata: Record<string, ReactNode>;
  photos: ReactNode;
  selection?: ReactNode;
  actions: ReactNode;
  panelId: string;
};

export function HoursApprovalBadge({
  status,
  open = false,
}: {
  status: HoursEntryPresentation["approvalStatus"];
  open?: boolean;
}) {
  return (
    <Badge
      variant={
        open
          ? "outline"
          : status === "APPROVED"
            ? "success"
            : status === "REJECTED"
              ? "destructive"
              : "warning"
      }
      className="text-[10px]"
    >
      {open
        ? "Open"
        : status === "APPROVED"
          ? "Approved"
          : status === "REJECTED"
            ? "Rejected"
            : "Pending"}
    </Badge>
  );
}

function Person({
  row,
  showStatus = false,
}: {
  row: HoursEntryPresentation;
  showStatus?: boolean;
}) {
  return (
    <Link href={row.href} className="flex min-w-0 items-center gap-2.5 hover:underline">
      <span className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
        {row.avatar ? (
          <Image
            src={row.avatar}
            alt=""
            fill
            sizes="32px"
            className="object-cover"
            unoptimized
          />
        ) : (
          <UserRound aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
        )}
      </span>
      <div className="min-w-0">
        <span className="block max-w-56 truncate text-sm font-medium" title={row.name}>
          {row.name}
        </span>
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="block min-w-0 truncate text-[11px] text-muted-foreground" title={row.code}>
            {row.code}
          </span>
          {showStatus && <Status row={row} />}
        </div>
      </div>
    </Link>
  );
}

function Status({ row }: { row: HoursEntryPresentation }) {
  return (
    <div className="flex max-w-full shrink-0 flex-wrap items-center gap-1.5">
      <HoursApprovalBadge status={row.approvalStatus} open={row.open} />
      {row.autoClosed && (
        <Badge variant="destructive" className="text-[10px]" title="Auto-closed at the 16-hour cap. Verify the hours.">
          Auto-closed
        </Badge>
      )}
      {row.editReason && (
        <Badge variant="outline" className="text-[10px]" title={row.editReason}>
          Edited
        </Badge>
      )}
      {row.sourceLabel && (
        <Badge variant="outline" className="text-[10px]">
          {row.sourceLabel}
        </Badge>
      )}
      {row.approvalStatus === "REJECTED" && row.approvalNotes && (
        <span
          className="max-w-48 truncate text-xs text-destructive"
          title={row.approvalNotes}
        >
          {row.approvalNotes}
        </span>
      )}
    </div>
  );
}

export function HoursEntryList({
  rows,
  selection,
  extraColumns,
  emptyMessage = "No entries in this range.",
}: {
  rows: HoursEntryPresentation[];
  selection?: ReactNode;
  extraColumns: Array<{ key: string; label: string; numeric?: boolean }>;
  emptyMessage?: string;
}) {
  if (!rows.length)
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">{emptyMessage}</p>
    );
  const columns = 9 + extraColumns.length;
  const widths = [
    40,
    112,
    208,
    96,
    96,
    88,
    88,
    ...extraColumns.map((_, i) => (i === 0 ? 80 : 144)),
    104,
    144,
  ];
  const numeric = "whitespace-nowrap text-right font-mono text-xs tabular-nums";
  const time = "whitespace-nowrap font-mono text-xs tabular-nums";
  return (
    <ResponsiveDataList
      mobile={
        <div className="space-y-2 p-2">
          {rows.map((row) => (
            <Fragment key={row.id}>
              <article
                data-hours-entry={row.id}
                className="min-w-0 space-y-3 rounded-lg border bg-card p-3"
              >
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{formatDateOnly(row.date)}</span>
                  {row.selection}
                </div>
                <Person row={row} />
                <Status row={row} />
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  {[
                    ["In", formatBusinessTime(row.clockIn)],
                    ["Out", row.clockOut ? formatBusinessTime(row.clockOut) : "Open"],
                    ["Break", formatHours(row.breakMin)],
                    ["Hours", row.open ? "—" : formatHours(row.workMin)],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="mt-0.5 whitespace-nowrap font-mono tabular-nums">
                        {value}
                      </dd>
                    </div>
                  ))}
                  {extraColumns.map((col) => (
                    <div key={col.key} className="min-w-0">
                      <dt className="text-muted-foreground">{col.label}</dt>
                      <dd
                        className={cn(
                          "mt-0.5 min-w-0",
                          col.numeric && "font-mono tabular-nums",
                        )}
                      >
                        {row.metadata[col.key]}
                      </dd>
                    </div>
                  ))}
                </dl>
                {row.photos}
                <div
                  data-hours-actions
                  className="flex flex-wrap items-center gap-1.5 border-t pt-3"
                >
                  {row.actions}
                </div>
              </article>
              <PanelSlot id={row.panelId} view="mobile" />
            </Fragment>
          ))}
        </div>
      }
      desktop={
        <div className="overflow-x-auto [&_[data-panel-slot]]:max-w-[calc(100cqw_-_2rem)]" style={{ containerType: "inline-size" }}>
          <table
            data-sorter="1"
            className={cn(hoursTableClass, "table-fixed")}
            style={{ minWidth: widths.reduce((sum, width) => sum + width, 0) }}
          >
            <colgroup>
              {widths.map((width, i) => (
                <col key={i} style={{ width }} />
              ))}
            </colgroup>
            <thead className={hoursTheadClass}>
              <tr>
                <th className={cn(hoursThClass, "w-10")}>{selection}</th>
                <th className={cn(hoursThClass, "whitespace-nowrap")}>Date</th>
                <th className={hoursThClass}>Person</th>
                <th className={hoursThClass}>In</th>
                <th className={hoursThClass}>Out</th>
                <th className={cn(hoursThClass, "text-right")}>Break</th>
                <th className={cn(hoursThClass, "text-right")}>Hours</th>
                {extraColumns.map((col) => (
                  <th
                    key={col.key}
                    className={cn(hoursThClass, col.numeric && "text-right")}
                  >
                    {col.label}
                  </th>
                ))}
                <th className={hoursThClass}>Photos</th>
                <th className={cn(hoursThClass, "sticky right-0 bg-card text-right")}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Fragment key={row.id}>
                  <tr
                    data-hours-entry={row.id}
                    className={cn(
                      hoursRowClass,
                      "h-16 [&:has(+tr_[data-panel-open])]:bg-primary/10",
                    )}
                  >
                    <td className={hoursTdClass}>{row.selection}</td>
                    <td className={cn(hoursTdClass, "whitespace-nowrap text-xs")}>
                      {formatDateOnly(row.date)}
                    </td>
                    <td className={cn(hoursTdClass, "min-w-52")}>
                      <Person row={row} showStatus />
                    </td>
                    <td className={cn(hoursTdClass, time)}>
                      {formatBusinessTime(row.clockIn)}
                    </td>
                    <td className={cn(hoursTdClass, time)}>
                      {row.clockOut ? formatBusinessTime(row.clockOut) : "Open"}
                    </td>
                    <td className={cn(hoursTdClass, numeric)}>
                      {formatHours(row.breakMin)}
                    </td>
                    <td className={cn(hoursTdClass, numeric)}>
                      {row.open ? "—" : formatHours(row.workMin)}
                    </td>
                    {extraColumns.map((col) => (
                      <td
                        key={col.key}
                        className={cn(hoursTdClass, col.numeric ? numeric : "text-xs")}
                      >
                        {row.metadata[col.key]}
                      </td>
                    ))}
                    <td className={hoursTdClass}>{row.photos}</td>
                    <td className={cn(hoursTdClass, "sticky right-0 border-l bg-card")}>
                      <div
                        data-hours-actions
                        className="flex items-center justify-end gap-1.5 whitespace-nowrap"
                      >
                        {row.actions}
                      </div>
                    </td>
                  </tr>
                  <PanelSlotRow id={row.panelId} colSpan={columns} />
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      }
    />
  );
}
