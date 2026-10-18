"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Loader2, Play, Search, Square, X } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  kioskContractAction,
  kioskListContractWorkers,
  type KioskContractWorker,
} from "@/server/actions/kiosk-contract";
import { BUSINESS_TIME_ZONE } from "@/lib/format";
import { runAction, toastAction } from "@/lib/toast-action";
import { setKioskBusy } from "@/lib/kiosk-version";
import { cn } from "@/lib/utils";
import { PunchCameraPreview, type PunchCamera } from "./punch-camera";

type ContractAction = "CLOCK_IN" | "CLOCK_OUT";

/** Roster refresh while the tab is open and visible (server limit: 20/min). */
const ROSTER_REFRESH_MS = 60_000;
/** Auto-cancel a worker selection after this long without a tap. */
const IDLE_CANCEL_MS = 30_000;

function statusLabel(status: KioskContractWorker["status"]) {
  if (status === "ACTIVE") return "In";
  if (status === "ON_BREAK") return "On break";
  return "Out";
}

function statusVariant(
  status: KioskContractWorker["status"],
): "success" | "warning" | "outline" {
  if (status === "ACTIVE") return "success";
  if (status === "ON_BREAK") return "warning";
  return "outline";
}

/** Segmented switch shown above both kiosk lists. */
export function KioskModeSwitch({
  mode,
  onChange,
}: {
  mode: "employees" | "contract";
  onChange: (mode: "employees" | "contract") => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md gap-1 rounded-md border bg-background p-1">
      <Button
        type="button"
        variant={mode === "employees" ? "secondary" : "ghost"}
        className="h-12 flex-1 text-sm"
        onClick={() => onChange("employees")}
      >
        Employees
      </Button>
      <Button
        type="button"
        variant={mode === "contract" ? "secondary" : "ghost"}
        className="h-12 flex-1 text-sm"
        onClick={() => onChange("contract")}
      >
        Contract crew
      </Button>
    </div>
  );
}

export function ContractCrewPanel({
  slug,
  camera,
}: {
  slug: string;
  camera: PunchCamera;
}) {
  const { start: startCamera, stop: stopCamera } = camera;
  const [workers, setWorkers] = useState<KioskContractWorker[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activity, setActivity] = useState(0);
  const [pending, startTransition] = useTransition();

  const busy = selectedId !== null || pending;
  useEffect(() => {
    setKioskBusy("crew", busy);
    return () => setKioskBusy("crew", false);
  }, [busy]);

  const selected = useMemo(
    () => workers.find((w) => w.id === selectedId) ?? null,
    [workers, selectedId],
  );

  const load = useCallback(async () => {
    const res = await runAction(() => kioskListContractWorkers(slug));
    if (!res.ok) {
      toastAction(res);
      setLoading(false);
      return;
    }
    setWorkers(res.workers);
    setLoading(false);
  }, [slug]);

  useEffect(() => {
    // Deferred one tick so state is only set from a callback, not the effect body.
    const first = setTimeout(() => void load(), 0);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, ROSTER_REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);

  const clearSelection = useCallback(() => {
    stopCamera();
    setSelectedId(null);
  }, [stopCamera]);

  // Camera runs only while the confirm card is open; also stop on tab switch/unmount.
  useEffect(() => stopCamera, [stopCamera]);

  // Idle auto-cancel, same rule as the employee flow.
  useEffect(() => {
    if (!selected || pending) return;
    const id = setTimeout(clearSelection, IDLE_CANCEL_MS);
    return () => clearTimeout(id);
  }, [selected, pending, activity, clearSelection]);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? workers.filter(
          (w) =>
            w.name.toLowerCase().includes(q) ||
            w.workerId.toLowerCase().includes(q) ||
            w.agencyName.toLowerCase().includes(q),
        )
      : workers;
    const map = new Map<string, KioskContractWorker[]>();
    for (const w of list) {
      const arr = map.get(w.agencyName) ?? [];
      arr.push(w);
      map.set(w.agencyName, arr);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [workers, query]);

  function act(worker: KioskContractWorker, action: ContractAction) {
    startTransition(async () => {
      // Best-effort photo; null never blocks the punch.
      const photo = (await camera.capture()) ?? undefined;
      const res = await runAction(() => kioskContractAction({ slug, workerId: worker.id, action, photo }));
      if (!toastAction(res)) return;
      const time = new Date().toLocaleTimeString([], {
        timeZone: BUSINESS_TIME_ZONE,
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      const labels: Record<ContractAction, string> = {
        CLOCK_IN: "Clocked in",
        CLOCK_OUT: "Clocked out",
      };
      toast.success(`${labels[action]} at ${time} · ${worker.name}`);
      if (res.autoClosed) {
        toast.warning(
          "Your previous shift was left open more than 16 hours. It was closed automatically and flagged for an admin to review.",
          { duration: 10_000 },
        );
      }
      clearSelection();
      await load();
    });
  }

  if (selected) {
    const detail = [selected.project, selected.jobCode].filter(Boolean).join(" · ");
    return (
      <motion.div
        key={selected.id}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="mx-auto w-full max-w-md"
      >
        <Card
          className="shadow-sm"
          onKeyDownCapture={() => setActivity((n) => n + 1)}
          onPointerDownCapture={() => setActivity((n) => n + 1)}
        >
          <CardContent className="space-y-5 p-6">
            <PunchCameraPreview status={camera.status} setVideo={camera.setVideo} />
            <div className="flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Agency staff
                </p>
                <p className="truncate text-lg font-semibold">{selected.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {selected.workerId} · {selected.agencyName}
                </p>
                {detail && (
                  <p className="truncate text-xs text-muted-foreground">{detail}</p>
                )}
              </div>
              <Badge variant={statusVariant(selected.status)} className="text-[10px]">
                {statusLabel(selected.status)}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {selected.status === "OUT" && (
                <Button
                  size="lg"
                  variant="success"
                  className="col-span-2 h-16 text-base"
                  disabled={pending}
                  onClick={() => act(selected, "CLOCK_IN")}
                >
                  {pending ? (
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  ) : (
                    <Play className="mr-2 h-5 w-5" />
                  )}
                  Clock in
                </Button>
              )}
              {(selected.status === "ACTIVE" || selected.status === "ON_BREAK") && (
                <Button
                  size="lg"
                  variant="destructive"
                  className="col-span-2 h-16 text-base"
                  disabled={pending}
                  onClick={() => act(selected, "CLOCK_OUT")}
                >
                  {pending ? (
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  ) : (
                    <Square className="mr-2 h-5 w-5" />
                  )}
                  Clock out
                </Button>
              )}
              <Button
                variant="outline"
                size="lg"
                className="col-span-2 h-12 text-sm"
                disabled={pending}
                onClick={clearSelection}
              >
                <X className="mr-1.5 h-4 w-4" /> Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative mx-auto min-w-0 max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or CW ID"
          className="h-12 pl-9 text-base"
        />
      </div>

      <p className="text-center text-[10px] uppercase tracking-wider text-muted-foreground">
        Agency staff · contract crew only
      </p>

      {loading ? (
        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading contract crew…
        </div>
      ) : grouped.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {query.trim()
              ? "No contract workers match that search."
              : "No contract workers are scheduled for today. Ask your supervisor."}
          </CardContent>
        </Card>
      ) : (
        <div className="mx-auto max-w-3xl space-y-4">
          {grouped.map(([agency, list]) => (
            <section key={agency} className="space-y-1.5">
              <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {agency}
              </h2>
              <div className="overflow-hidden rounded-xl border bg-background shadow-sm">
                <ul className="divide-y">
                  {list.map((w) => (
                    <li key={w.id}>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          setSelectedId(w.id);
                          startCamera();
                        }}
                        className={cn(
                          "flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-muted/40 active:bg-muted/60 disabled:opacity-60",
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{w.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {w.workerId} · {w.agencyName}
                          </p>
                        </div>
                        <Badge
                          variant={statusVariant(w.status)}
                          className="shrink-0 text-[10px]"
                        >
                          {statusLabel(w.status)}
                        </Badge>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
