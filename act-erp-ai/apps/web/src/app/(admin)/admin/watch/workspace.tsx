"use client";

import Link from "next/link";
import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { allowedActions, type FindingAction } from "@/lib/watch/status";
import { runAction, toastAction } from "@/lib/toast-action";
import { actOnFinding, runWatchNow, sendTestDigest } from "@/server/actions/watch";
import type { adminWatchData } from "@/server/queries/watch";

type Data = Awaited<ReturnType<typeof adminWatchData>>;
type Row = Data["rows"][number];

const SEVERITY_ORDER = { CRITICAL: 0, WARN: 1, INFO: 2 } as const;
const SEVERITY_STYLE: Record<Row["severity"], string> = {
  CRITICAL: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  WARN: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  INFO: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
};
const ACTION_LABEL: Record<FindingAction, string> = {
  ACKNOWLEDGE: "Mark reviewed",
  RESOLVE: "Recheck and resolve",
  SNOOZE_1D: "Snooze 1 day",
  SNOOZE_7D: "Snooze 1 week",
  DISMISS: "Not a problem",
  REOPEN: "Reopen",
};
const STATUS_TABS = [
  { key: "ACTIVE", label: "Needs attention" },
  { key: "SNOOZED", label: "Snoozed" },
  { key: "DISMISSED", label: "Dismissed" },
  { key: "REPORTS", label: "Reports" },
] as const;

const isReport = (r: { ruleId: string }) => r.ruleId.startsWith("report.");

function ago(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "today";
  return days === 1 ? "1 day" : `${days} days`;
}

export function WatchWorkspace({ data }: { data: Data }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tab, setTab] = useState<(typeof STATUS_TABS)[number]["key"]>("ACTIVE");
  const [severity, setSeverity] = useState<"" | Row["severity"]>("");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const inTab = (r: Row) =>
    tab === "REPORTS"
      ? isReport(r) && r.status !== "DISMISSED"
      : !isReport(r) && (tab === "ACTIVE" ? r.status === "OPEN" || r.status === "ACKNOWLEDGED" : r.status === tab);
  const q = search.trim().toLowerCase();
  const visible = data.rows
    .filter(inTab)
    .filter((r) => !severity || r.severity === severity)
    .filter((r) => !q || `${r.title} ${r.employeeName ?? ""} ${r.ruleId}`.toLowerCase().includes(q))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.firstSeenAt.localeCompare(b.firstSeenAt));

  const active = data.rows.filter((r) => !isReport(r) && (r.status === "OPEN" || r.status === "ACKNOWLEDGED"));
  const count = (s: Row["severity"]) => active.filter((r) => r.severity === s).length;

  function act(row: Row, action: FindingAction) {
    start(async () => {
      const res = await runAction(() => actOnFinding({ id: row.id, action, note: note || undefined }));
      router.refresh();
      if (!toastAction(res)) return;
      toast.success(action === "RESOLVE" ? "Rechecked. The issue is resolved." : action === "ACKNOWLEDGE" ? "Marked reviewed. The flag stays until the issue is resolved." : ACTION_LABEL[action]);
      setNote("");
      setOpenId(null);
    });
  }

  function runNow() {
    start(async () => {
      const res = await runAction(() => runWatchNow());
      router.refresh();
      if (!toastAction(res)) return;
      toast.success(`Checked. ${res.created} new, ${res.autoResolved} cleared.`);
    });
  }

  function emailMe() {
    start(async () => {
      const res = await runAction(() => sendTestDigest());
      if (!toastAction(res)) return;
      toast.success(`Test digest sent to ${res.to}.`);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(["CRITICAL", "WARN", "INFO"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSeverity(severity === s ? "" : s)}
            aria-pressed={severity === s}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${SEVERITY_STYLE[s]} ${severity === s ? "ring-2 ring-foreground/40" : ""}`}
          >
            {s === "CRITICAL" ? "Critical" : s === "WARN" ? "Warning" : "Info"} {count(s)}
          </button>
        ))}
        <span className="text-sm text-muted-foreground">{data.resolvedThisWeek} cleared on their own this week</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {data.lastRunAt ? `Last check ${new Date(data.lastRunAt).toLocaleString()}` : "Not run yet"}
            {data.lastRunErrors > 0 ? ` (${data.lastRunErrors} rule errors)` : ""}
          </span>
          <Button size="sm" variant="outline" onClick={emailMe} disabled={pending}>
            Email me the digest
          </Button>
          <Button size="sm" variant="outline" onClick={runNow} disabled={pending}>
            Check now
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {STATUS_TABS.map((t) => (
          <Button
            key={t.key}
            size="sm"
            variant={tab === t.key ? "default" : "outline"}
            onClick={() => setTab(t.key)}
          >
            {t.label} ({data.rows.filter((r) => (t.key === "REPORTS" ? isReport(r) && r.status !== "DISMISSED" : !isReport(r) && (t.key === "ACTIVE" ? r.status === "OPEN" || r.status === "ACKNOWLEDGED" : r.status === t.key))).length})
          </Button>
        ))}
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or flag"
          className="ml-auto h-9 max-w-xs"
          aria-label="Search flags"
        />
      </div>

      {visible.length === 0 ? (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          {tab === "ACTIVE" ? "All clear. Nothing needs you." : "Nothing here."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2">Level</th>
                <th className="px-3 py-2">Flag</th>
                <th className="px-3 py-2">Who</th>
                <th className="px-3 py-2">Open for</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <Fragment key={r.id}>
                  <tr
                    className="cursor-pointer border-t hover:bg-muted/40"
                    onClick={() => { setOpenId(openId === r.id ? null : r.id); setNote(""); }}
                  >
                    <td className="px-3 py-2" data-sort-value={SEVERITY_ORDER[r.severity]}>
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLE[r.severity]}`}>
                        {r.severity === "WARN" ? "Warning" : r.severity === "CRITICAL" ? "Critical" : "Info"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="rounded text-left [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-expanded={openId === r.id}
                        aria-controls={`watch-detail-${r.id}`}
                        onClick={(event) => { event.stopPropagation(); setOpenId(openId === r.id ? null : r.id); setNote(""); }}
                      >
                        {r.title}
                      </button>
                    </td>
                    <td className="px-3 py-2">{r.employeeName ?? "-"}</td>
                    <td className="px-3 py-2" data-sort-value={r.firstSeenAt}>{ago(r.firstSeenAt)}</td>
                    <td className="px-3 py-2">{r.status === "ACKNOWLEDGED" ? "Reviewed · unresolved" : r.status === "SNOOZED" ? `Snoozed${r.snoozeUntil ? ` until ${new Date(r.snoozeUntil).toLocaleDateString()}` : ""}` : r.status === "DISMISSED" ? "Dismissed" : "Open"}</td>
                  </tr>
                  {openId === r.id && (
                    <tr className="border-t bg-muted/20">
                      <td id={`watch-detail-${r.id}`} colSpan={5} className="px-4 py-3">
                        <div className="max-w-[calc(100vw-4rem)] space-y-3 [overflow-wrap:anywhere] md:max-w-none">
                        <p className="whitespace-pre-line">{r.detail}</p>
                        {r.likelyCause && <p><span className="font-medium">Likely cause:</span> {r.likelyCause}</p>}
                        {r.suggestedFix && <p><span className="font-medium">Suggested fix:</span> {r.suggestedFix}</p>}
                        {r.handledNote && <p className="text-muted-foreground">Note: {r.handledNote}</p>}
                        {!isReport(r) && <p className="text-sm text-muted-foreground">Mark reviewed records that you have seen the flag. Recheck and resolve clears it when the check confirms the issue is gone.</p>}
                        <div className="flex flex-wrap items-center gap-2">
                          {r.fixLink && (
                            <Button asChild size="sm">
                              <Link href={r.fixLink}>Open the fix page</Link>
                            </Button>
                          )}
                          {(isReport(r) ? [] : allowedActions(r.status)).map((a) => (
                            <Button key={a} size="sm" variant="outline" disabled={pending} onClick={() => act(r, a)}>
                              {ACTION_LABEL[a]}
                            </Button>
                          ))}
                          <Input
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="Optional note"
                            className="h-8 max-w-xs"
                            aria-label="Note"
                            maxLength={500}
                          />
                        </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
