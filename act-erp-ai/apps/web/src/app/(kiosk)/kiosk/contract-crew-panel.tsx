"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { CalendarDays, Loader2, Play, Search, Square, X } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  kioskContractAction,
  kioskContractChangePin,
  kioskContractTimings,
  kioskListContractWorkers,
  kioskContractUpdateProfilePhoto,
  type KioskContractWorker,
} from "@/server/actions/kiosk-contract";
import type { KioskTimingEntry } from "@/server/actions/kiosk";
import { TimingsList } from "./timings-list";
import { BUSINESS_TIME_ZONE } from "@/lib/format";
import { runAction } from "@/lib/toast-action";
import { setKioskBusy } from "@/lib/kiosk-version";
import { cn } from "@/lib/utils";
import { PunchCameraPreview, type PunchCamera } from "./punch-camera";
import { useKioskLanguage } from "./kiosk-language";
import { KioskPersonPhoto } from "./kiosk-person-photo";
import { KioskProfilePhotoEditor } from "./kiosk-profile-photo-editor";

type ContractAction = "CLOCK_IN" | "CLOCK_OUT";

/** Roster refresh while the tab is open and visible (server limit: 20/min). */
const ROSTER_REFRESH_MS = 60_000;
/** Auto-cancel a worker selection after this long without a tap. */
const IDLE_CANCEL_MS = 30_000;

function statusLabel(
  status: KioskContractWorker["status"],
  t: (english: string) => string,
) {
  if (status === "ACTIVE") return t("In");
  if (status === "ON_BREAK") return t("On break");
  return t("Out");
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
  const { t } = useKioskLanguage();
  return (
    <div className="mx-auto flex w-full max-w-md gap-1 rounded-md border bg-background p-1">
      <Button
        type="button"
        variant={mode === "employees" ? "secondary" : "ghost"}
        className="h-12 flex-1 text-sm"
        onClick={() => onChange("employees")}
      >
        {t("Employees")}
      </Button>
      <Button
        type="button"
        variant={mode === "contract" ? "secondary" : "ghost"}
        className="h-12 flex-1 text-sm"
        onClick={() => onChange("contract")}
      >
        {t("Contract crew")}
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
  const { t, toastAction } = useKioskLanguage();
  const { start: startCamera, stop: stopCamera } = camera;
  const [workers, setWorkers] = useState<KioskContractWorker[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [agencyFilter, setAgencyFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [timings, setTimings] = useState<{
    entries: KioskTimingEntry[];
    totalWorkMin: number;
  } | null>(null);
  const [activity, setActivity] = useState(0);
  const [pin, setPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pendingAction, setPendingAction] = useState<ContractAction | null>(null);
  const [choosingPin, setChoosingPin] = useState(false);
  const [pending, startTransition] = useTransition();
  const [editingPhoto, setEditingPhoto] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);

  const busy = selectedId !== null || pending || profileSaving;
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
  }, [slug, toastAction]);

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
    setTimings(null);
    setSelectedId(null);
    setPin("");
    setNewPin("");
    setConfirmPin("");
    setPendingAction(null);
    setChoosingPin(false);
    setEditingPhoto(false);
    setProfileSaving(false);
  }, [stopCamera]);

  // Camera runs only while the confirm card is open; also stop on tab switch/unmount.
  useEffect(() => stopCamera, [stopCamera]);

  // Idle auto-cancel, same rule as the employee flow.
  useEffect(() => {
    if (!selected || pending || profileSaving) return;
    const id = setTimeout(clearSelection, IDLE_CANCEL_MS);
    return () => clearTimeout(id);
  }, [selected, pending, profileSaving, activity, clearSelection]);

  const agencies = useMemo(
    () => [...new Set(workers.map((w) => w.agencyName))].sort((a, b) => a.localeCompare(b)),
    [workers],
  );

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byAgency = agencyFilter
      ? workers.filter((w) => w.agencyName === agencyFilter)
      : workers;
    const list = q
      ? byAgency.filter(
          (w) =>
            w.name.toLowerCase().includes(q) ||
            w.workerId.toLowerCase().includes(q) ||
            w.agencyName.toLowerCase().includes(q),
        )
      : byAgency;
    const map = new Map<string, KioskContractWorker[]>();
    for (const w of list) {
      const arr = map.get(w.agencyName) ?? [];
      arr.push(w);
      map.set(w.agencyName, arr);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [workers, query, agencyFilter]);

  function act(worker: KioskContractWorker, action: ContractAction) {
    if (!/^\d{4}$/.test(pin)) {
      toast.error(t("Enter your 4-digit PIN"));
      return;
    }
    if (worker.mustChangePin) {
      // Temporary PIN: choose a new one before the punch proceeds.
      setPendingAction(action);
      setNewPin("");
      setConfirmPin("");
      setChoosingPin(true);
      return;
    }
    startTransition(async () => {
      await punch(worker, action, pin);
    });
  }

  async function punch(
    worker: KioskContractWorker,
    action: ContractAction,
    pinValue: string,
  ) {
    {
      // Best-effort photo; null never blocks the punch.
      const photo = (await camera.capture()) ?? undefined;
      const res = await runAction(() =>
        kioskContractAction({ slug, workerId: worker.id, action, pin: pinValue, photo }),
      );
      if (!toastAction(res)) {
        setPin("");
        return;
      }
      const time = new Date().toLocaleTimeString([], {
        timeZone: BUSINESS_TIME_ZONE,
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      const labels: Record<ContractAction, string> = {
        CLOCK_IN: t("Clocked in"),
        CLOCK_OUT: t("Clocked out"),
      };
      toast.success(`${labels[action]} · ${time} · ${worker.name}`);
      if (res.autoClosed) {
        toast.warning(
          t(
            "Your previous shift was left open more than 16 hours. It was closed automatically and flagged for an admin to review.",
          ),
          { duration: 10_000 },
        );
      }
      clearSelection();
      setQuery("");
      setAgencyFilter(null);
      await load();
    }
  }

  function viewTimings(worker: KioskContractWorker) {
    if (!/^\d{4}$/.test(pin)) {
      toast.error(t("Enter your 4-digit PIN"));
      return;
    }
    startTransition(async () => {
      const res = await runAction(() =>
        kioskContractTimings({ slug, workerId: worker.id, pin }),
      );
      if (!toastAction(res)) {
        setPin("");
        return;
      }
      setTimings({ entries: res.entries, totalWorkMin: res.totalWorkMin });
    });
  }

  function submitNewPin(e: React.FormEvent, worker: KioskContractWorker) {
    e.preventDefault();
    if (!pendingAction) return;
    if (!/^\d{4}$/.test(newPin)) {
      toast.error(t("Your new PIN must be exactly 4 digits."));
      return;
    }
    if (newPin !== confirmPin) {
      toast.error(t("The two PINs do not match. Re-enter them."));
      return;
    }
    startTransition(async () => {
      const changed = await runAction(() =>
        kioskContractChangePin({ slug, workerId: worker.id, currentPin: pin, newPin }),
      );
      if (!toastAction(changed)) {
        if (/incorrect pin|too many/i.test(changed.error)) {
          setChoosingPin(false);
          setPin("");
        }
        return;
      }
      toast.success(t("PIN updated. Use your new PIN from now on."));
      setWorkers((ws) =>
        ws.map((w) => (w.id === worker.id ? { ...w, mustChangePin: false } : w)),
      );
      setChoosingPin(false);
      await punch(worker, pendingAction, newPin);
    });
  }

  if (selected) {
    const detail = [selected.project, selected.jobCode].filter(Boolean).join(" · ");
    return (
      <motion.div
        key={selected.id}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className={cn("mx-auto w-full", timings ? "max-w-xl" : "max-w-md")}
      >
        <Card
          className="shadow-sm"
          onKeyDownCapture={() => setActivity((n) => n + 1)}
          onPointerDownCapture={() => setActivity((n) => n + 1)}
        >
          <CardContent className="space-y-5 p-6">
            {editingPhoto ? (
              <KioskProfilePhotoEditor
                punchCamera={camera}
                onSave={(pinValue, photo) =>
                  kioskContractUpdateProfilePhoto({
                    slug,
                    workerId: selected.id,
                    pin: pinValue,
                    photo,
                  })
                }
                onSaved={(url) => {
                  toast.success(t("Photo saved."));
                  setWorkers((current) =>
                    current.map((worker) =>
                      worker.id === selected.id
                        ? { ...worker, capturedPhotoUrl: url }
                        : worker,
                    ),
                  );
                  setPin("");
                  setEditingPhoto(false);
                  void load();
                }}
                onClose={() => {
                  setEditingPhoto(false);
                  setPin("");
                }}
                onBusyChange={setProfileSaving}
              />
            ) : (
              <PunchCameraPreview status={camera.status} setVideo={camera.setVideo} />
            )}
            <div className="flex items-center gap-4">
              {selected.capturedPhotoUrl && (
                <KioskPersonPhoto
                  photoUrl={selected.capturedPhotoUrl}
                  name={selected.name}
                  className="h-[60px] w-[60px]"
                  sizes="60px"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {t("Agency staff")}
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
                {statusLabel(selected.status, t)}
              </Badge>
            </div>

            {!editingPhoto && !timings && !choosingPin && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                disabled={pending || profileSaving}
                onClick={() => {
                  setPin("");
                  startCamera();
                  setEditingPhoto(true);
                }}
              >
                {t("Change photo")}
              </Button>
            )}

            {editingPhoto ? null : timings ? (
              <TimingsList
                entries={timings.entries}
                totalWorkMin={timings.totalWorkMin}
                onBack={() => setTimings(null)}
              />
            ) : choosingPin ? (
              <form onSubmit={(e) => submitNewPin(e, selected)} className="space-y-3">
                <p className="text-center text-sm font-medium">
                  {t("Choose your new PIN")}
                </p>
                <p className="text-center text-xs text-muted-foreground">
                  {t(
                    "You are using a temporary PIN. Pick exactly 4 digits that are not easy to guess (no 1234 or 0000), then your punch will go through.",
                  )}
                </p>
                <Input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  autoFocus
                  maxLength={4}
                  value={newPin}
                  onChange={(e) =>
                    setNewPin(e.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                  disabled={pending}
                  placeholder={t("New PIN")}
                  className="h-12 text-center font-mono text-xl tracking-[0.4em]"
                />
                <Input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  value={confirmPin}
                  onChange={(e) =>
                    setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                  disabled={pending}
                  placeholder={t("Confirm PIN")}
                  className="h-12 text-center font-mono text-xl tracking-[0.4em]"
                />
                <Button
                  type="submit"
                  size="lg"
                  className="h-12 w-full text-sm"
                  disabled={pending || newPin.length < 4 || confirmPin.length < 4}
                >
                  {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t("Save PIN and continue")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="h-10 w-full text-xs"
                  disabled={pending}
                  onClick={clearSelection}
                >
                  <X className="mr-1.5 h-3.5 w-3.5" /> {t("Cancel")}
                </Button>
              </form>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2 space-y-1.5">
                  <label className="block text-center text-xs text-muted-foreground">
                    {selected.mustChangePin
                      ? t("Enter the temporary PIN from your admin")
                      : t("Enter your PIN to confirm")}
                  </label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    autoFocus
                    maxLength={4}
                    value={pin}
                    onChange={(e) =>
                      setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
                    }
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" || pending) return;
                      e.preventDefault();
                      act(selected, selected.status === "OUT" ? "CLOCK_IN" : "CLOCK_OUT");
                    }}
                    disabled={pending}
                    placeholder="••••"
                    className="h-12 text-center font-mono text-xl tracking-[0.4em]"
                  />
                </div>
                {selected.status === "OUT" && (
                  <Button
                    size="lg"
                    variant="success"
                    className="col-span-2 h-16 text-base"
                    disabled={pending || pin.length < 4}
                    onClick={() => act(selected, "CLOCK_IN")}
                  >
                    {pending ? (
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    ) : (
                      <Play className="mr-2 h-5 w-5" />
                    )}
                    {t("Clock in")}
                  </Button>
                )}
                {(selected.status === "ACTIVE" || selected.status === "ON_BREAK") && (
                  <Button
                    size="lg"
                    variant="destructive"
                    className="col-span-2 h-16 text-base"
                    disabled={pending || pin.length < 4}
                    onClick={() => act(selected, "CLOCK_OUT")}
                  >
                    {pending ? (
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    ) : (
                      <Square className="mr-2 h-5 w-5" />
                    )}
                    {t("Clock out")}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="lg"
                  className="col-span-2 h-12 text-sm"
                  disabled={pending || pin.length < 4}
                  onClick={() => viewTimings(selected)}
                >
                  <CalendarDays className="mr-1.5 h-4 w-4" /> {t("My past month")}
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  className="col-span-2 h-12 text-sm"
                  disabled={pending}
                  onClick={clearSelection}
                >
                  <X className="mr-1.5 h-4 w-4" /> {t("Cancel")}
                </Button>
              </div>
            )}
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
          placeholder={t("Search by name or CW ID")}
          className="h-12 pl-9 text-base"
        />
      </div>

      {agencies.length > 1 && (
        <div className="mx-auto flex max-w-3xl flex-wrap justify-center gap-2">
          {agencies.map((agency) => (
            <Button
              key={agency}
              type="button"
              variant={agencyFilter === agency ? "secondary" : "outline"}
              className="h-12 px-4 text-sm"
              onClick={() => setAgencyFilter(agencyFilter === agency ? null : agency)}
            >
              {agency}
            </Button>
          ))}
        </div>
      )}

      <p className="text-center text-[10px] uppercase tracking-wider text-muted-foreground">
        {t("Agency staff · contract crew only")}
      </p>

      {loading ? (
        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t("Loading contract crew…")}
        </div>
      ) : grouped.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {query.trim()
              ? t("No contract workers match that search.")
              : t("No contract workers are scheduled for today. Ask your supervisor.")}
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
                        {w.capturedPhotoUrl && (
                          <KioskPersonPhoto
                            photoUrl={w.capturedPhotoUrl}
                            name={w.name}
                            className="h-[60px] w-[60px]"
                            sizes="60px"
                          />
                        )}
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
                          {statusLabel(w.status, t)}
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
