"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Image from "next/image";
import {
  Coffee,
  LayoutGrid,
  List,
  LogOut,
  Pause,
  Play,
  ScanLine,
  Search,
  Square,
  X,
  Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/logo";
import {
  endKioskSession,
  kioskAction,
  kioskChangePin,
  kioskListEmployees,
  kioskLookup,
  type KioskRosterEmployee,
} from "@/server/actions/kiosk";
import { BUSINESS_TIME_ZONE, getAvatarUrl } from "@/lib/format";
import { toast } from "sonner";
import { toastAction } from "@/lib/toast-action";
import type { ActionOk } from "@/lib/action-result";
import { cn } from "@/lib/utils";

type LookupMatch = ActionOk<{
  id: string;
  employeeId: string;
  name: string;
  email: string | null;
  profilePic: string | null;
  jobTitle: string | null;
  hasPin: boolean;
  mustChangePin: boolean;
  status: "ACTIVE" | "ON_BREAK" | "OUT";
  activeEntryId: string | null;
  staleShift: boolean;
}>;

type KioskActionName = "CLOCK_IN" | "CLOCK_OUT" | "START_BREAK" | "END_BREAK";

const ROSTER_REFRESH_MS = 60_000;
/** Auto-cancel an employee selection after this long without any keypress or tap. */
const IDLE_CANCEL_MS = 30_000;

type ViewMode = "grid" | "list";

function statusLabel(status: KioskRosterEmployee["status"]) {
  if (status === "ACTIVE") return "On shift";
  if (status === "ON_BREAK") return "On break";
  return "Out";
}

function statusVariant(
  status: KioskRosterEmployee["status"],
): "success" | "warning" | "outline" {
  if (status === "ACTIVE") return "success";
  if (status === "ON_BREAK") return "warning";
  return "outline";
}

export function KioskScreen({ slug, label }: { slug: string; label: string }) {
  const [now, setNow] = useState(new Date());
  const [roster, setRoster] = useState<KioskRosterEmployee[]>([]);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewMode>("grid");
  const [showIdEntry, setShowIdEntry] = useState(false);
  const [input, setInput] = useState("");
  const [match, setMatch] = useState<LookupMatch | null>(null);
  const [pin, setPin] = useState("");
  const [step, setStep] = useState<"pin" | "newpin">("pin");
  const [pendingAction, setPendingAction] = useState<KioskActionName | null>(null);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [activity, setActivity] = useState(0);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const pinRef = useRef<HTMLInputElement>(null);
  const newPinRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadRoster = useCallback(async () => {
    const res = await kioskListEmployees(slug);
    if (!res.ok) {
      toastAction(res);
      setRosterLoading(false);
      return;
    }
    setRoster(res.employees);
    setRosterLoading(false);
  }, [slug]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // First load is deferred one tick so state is only ever set from a callback,
    // never synchronously in the effect body.
    const first = setTimeout(() => void loadRoster(), 0);
    const id = setInterval(() => void loadRoster(), ROSTER_REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [loadRoster]);

  const resetSelection = useCallback(() => {
    setMatch(null);
    setPin("");
    setStep("pin");
    setPendingAction(null);
    setNewPin("");
    setConfirmPin("");
    setTimeout(() => searchRef.current?.focus(), 0);
  }, []);

  // Idle auto-cancel: only runs while an employee is selected (never on the
  // roster), restarts on every keypress/tap (activity), and is paused while
  // a request is in flight.
  useEffect(() => {
    if (!match || pending) return;
    const id = setTimeout(resetSelection, IDLE_CANCEL_MS);
    return () => clearTimeout(id);
  }, [match, pending, activity, resetSelection]);

  useEffect(() => {
    if (match) (step === "newpin" ? newPinRef : pinRef).current?.focus();
    else if (showIdEntry) inputRef.current?.focus();
  }, [match, pending, showIdEntry, step]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.employeeId.toLowerCase().includes(q) ||
        (e.jobTitle ?? "").toLowerCase().includes(q),
    );
  }, [roster, query]);

  function selectByEmployeeId(employeeId: string) {
    startTransition(async () => {
      const r = await kioskLookup(slug, employeeId);
      if (!toastAction(r)) return;
      setMatch(r);
      setPin("");
      setStep("pin");
      setPendingAction(null);
      setNewPin("");
      setConfirmPin("");
      setShowIdEntry(false);
      setInput("");
    });
  }

  function submitId(value: string) {
    const trimmed = value.trim().toUpperCase();
    if (!trimmed) return;
    selectByEmployeeId(trimmed);
  }

  async function runAction(m: LookupMatch, action: KioskActionName, pinValue: string) {
    const res = await kioskAction({ slug, employeeId: m.employeeId, pin: pinValue, action });
    if (!toastAction(res)) {
      setPin("");
      return false;
    }
    const labels: Record<KioskActionName, string> = {
      CLOCK_IN: "Clocked in",
      CLOCK_OUT: "Clocked out",
      START_BREAK: "Break started",
      END_BREAK: "Break ended",
    };
    toast.success(`${labels[action]} · ${m.name}`);
    if (res.autoClosed) {
      toast.warning(
        "Your previous shift was left open more than 16 hours. It was closed automatically and flagged for an admin to review.",
        { duration: 10_000 },
      );
    }
    resetSelection();
    void loadRoster();
    return true;
  }

  function act(action: KioskActionName) {
    if (!match) return;
    if (!/^\d{4,6}$/.test(pin)) {
      toast.error("Enter your 4-6 digit PIN");
      return;
    }
    if (match.mustChangePin) {
      // Temporary PIN: choose a new one before the punch proceeds.
      setPendingAction(action);
      setNewPin("");
      setConfirmPin("");
      setStep("newpin");
      return;
    }
    startTransition(async () => {
      await runAction(match, action, pin);
    });
  }

  function submitNewPin(e: React.FormEvent) {
    e.preventDefault();
    if (!match || !pendingAction) return;
    if (!/^\d{4,6}$/.test(newPin)) {
      toast.error("Your new PIN must be 4 to 6 digits.");
      return;
    }
    if (newPin !== confirmPin) {
      toast.error("The two PINs do not match. Re-enter them.");
      return;
    }
    startTransition(async () => {
      const changed = await kioskChangePin({
        slug,
        employeeId: match.employeeId,
        currentPin: pin,
        newPin,
      });
      if (!toastAction(changed)) {
        // A wrong temporary PIN sends them back to re-enter it; a weak PIN stays here.
        if (/incorrect pin|too many/i.test(changed.error)) {
          setStep("pin");
          setPin("");
        }
        return;
      }
      toast.success("PIN updated. Use your new PIN from now on.");
      await runAction(match, pendingAction, newPin);
    });
  }

  return (
    <div className="grid min-h-screen grid-rows-[auto_1fr_auto] bg-muted/30 text-foreground">
      <header className="flex items-center justify-between border-b bg-background px-6 py-4 sm:px-8">
        <div className="flex items-center gap-3">
          <Logo className="h-8" />
          <div className="hidden sm:block">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Kiosk · {label}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-2xl font-semibold tabular-nums">
            {now.toLocaleTimeString([], {
              timeZone: BUSINESS_TIME_ZONE,
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            })}
          </p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {now.toLocaleDateString([], {
              timeZone: BUSINESS_TIME_ZONE,
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>
      </header>

      <div className="overflow-auto p-4 sm:p-6 lg:p-8">
        <div className={cn("mx-auto w-full", match ? "max-w-md" : "max-w-5xl")}>
          <AnimatePresence mode="wait">
            {!match ? (
              <motion.div
                key="roster"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="space-y-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      ref={searchRef}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search by name or employee ID"
                      className="h-12 pl-9 text-base"
                      autoFocus
                    />
                  </div>
                  <div className="flex shrink-0 gap-1 rounded-md border bg-background p-1">
                    <Button
                      type="button"
                      size="sm"
                      variant={view === "grid" ? "secondary" : "ghost"}
                      className="h-10 px-3"
                      onClick={() => setView("grid")}
                    >
                      <LayoutGrid className="mr-1.5 h-4 w-4" /> Grid
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={view === "list" ? "secondary" : "ghost"}
                      className="h-10 px-3"
                      onClick={() => setView("list")}
                    >
                      <List className="mr-1.5 h-4 w-4" /> List
                    </Button>
                  </div>
                </div>

                {rosterLoading ? (
                  <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading employees…
                  </div>
                ) : filtered.length === 0 ? (
                  <Card>
                    <CardContent className="py-12 text-center text-sm text-muted-foreground">
                      {query.trim()
                        ? "No employees match that search."
                        : "No active employees found."}
                    </CardContent>
                  </Card>
                ) : view === "grid" ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {filtered.map((emp) => (
                      <button
                        key={emp.id}
                        type="button"
                        disabled={pending}
                        onClick={() => selectByEmployeeId(emp.employeeId)}
                        className="flex flex-col items-center gap-3 rounded-xl border bg-background p-4 text-center shadow-sm transition hover:border-primary/50 hover:bg-muted/40 active:scale-[0.98] disabled:opacity-60"
                      >
                        <span className="relative h-16 w-16 overflow-hidden rounded-full ring-2 ring-border">
                          <Image
                            src={emp.profilePic ?? getAvatarUrl(emp.employeeId)}
                            alt={emp.name}
                            fill
                            sizes="64px"
                            className="object-cover"
                            unoptimized
                          />
                        </span>
                        <div className="min-w-0 w-full space-y-1">
                          <p className="truncate text-sm font-semibold">{emp.name}</p>
                          {emp.jobTitle && (
                            <p className="truncate text-[11px] text-muted-foreground">
                              {emp.jobTitle}
                            </p>
                          )}
                          <Badge
                            variant={statusVariant(emp.status)}
                            className="text-[10px]"
                          >
                            {statusLabel(emp.status)}
                          </Badge>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-xl border bg-background shadow-sm">
                    <ul className="divide-y">
                      {filtered.map((emp) => (
                        <li key={emp.id}>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => selectByEmployeeId(emp.employeeId)}
                            className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-muted/40 active:bg-muted/60 disabled:opacity-60"
                          >
                            <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full ring-1 ring-border">
                              <Image
                                src={emp.profilePic ?? getAvatarUrl(emp.employeeId)}
                                alt={emp.name}
                                fill
                                sizes="44px"
                                className="object-cover"
                                unoptimized
                              />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{emp.name}</p>
                              <p className="truncate text-xs text-muted-foreground">
                                {emp.jobTitle ?? "—"} · {emp.employeeId}
                              </p>
                            </div>
                            <Badge
                              variant={statusVariant(emp.status)}
                              className="shrink-0 text-[10px]"
                            >
                              {statusLabel(emp.status)}
                            </Badge>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="pt-2 text-center">
                  {!showIdEntry ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-xs text-muted-foreground"
                      onClick={() => setShowIdEntry(true)}
                    >
                      <ScanLine className="mr-1.5 h-3.5 w-3.5" />
                      Enter ID / scan badge
                    </Button>
                  ) : (
                    <Card className="mx-auto max-w-md shadow-sm">
                      <CardContent className="space-y-3 p-5">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium">Enter Employee ID</p>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs"
                            onClick={() => {
                              setShowIdEntry(false);
                              setInput("");
                            }}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            submitId(input);
                          }}
                          className="space-y-3"
                        >
                          <Input
                            ref={inputRef}
                            type="text"
                            inputMode="text"
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="characters"
                            spellCheck={false}
                            value={input}
                            onChange={(e) =>
                              setInput(e.target.value.toUpperCase().slice(0, 24))
                            }
                            disabled={pending}
                            placeholder="Full ID or last digits"
                            className="h-14 text-center font-mono text-xl tabular-nums tracking-[0.18em]"
                          />
                          <Button
                            type="submit"
                            size="lg"
                            className="h-11 w-full text-sm"
                            disabled={pending || input.trim().length === 0}
                          >
                            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Continue
                          </Button>
                        </form>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key={match.employeeId}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
              >
                <Card
                  className="shadow-sm"
                  onKeyDownCapture={() => setActivity((n) => n + 1)}
                  onPointerDownCapture={() => setActivity((n) => n + 1)}
                >
                  <CardContent className="space-y-5 p-6">
                    <div className="flex items-center gap-4">
                      <span className="relative h-14 w-14 overflow-hidden rounded-full ring-2 ring-border">
                        <Image
                          src={match.profilePic ?? getAvatarUrl(match.email)}
                          alt={match.name}
                          fill
                          sizes="56px"
                          className="object-cover"
                          unoptimized
                        />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-base font-semibold">{match.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {match.jobTitle ?? "—"} · {match.employeeId}
                        </p>
                      </div>
                      <Badge
                        variant={statusVariant(match.status)}
                        className="text-[10px]"
                      >
                        {statusLabel(match.status)}
                      </Badge>
                    </div>

                    {match.staleShift && step === "pin" && (
                      <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-center text-xs text-amber-700 dark:text-amber-300">
                        Your last shift was never clocked out. Clocking in now will close it and
                        flag it for an admin to review.
                      </p>
                    )}

                    {step === "newpin" ? (
                      <form onSubmit={submitNewPin} className="space-y-3">
                        <p className="text-center text-sm font-medium">Choose your new PIN</p>
                        <p className="text-center text-xs text-muted-foreground">
                          You are using a temporary PIN. Pick 4 to 6 digits that are not easy to
                          guess (no 1234 or 0000), then your punch will go through.
                        </p>
                        <Input
                          ref={newPinRef}
                          type="password"
                          inputMode="numeric"
                          autoComplete="off"
                          maxLength={6}
                          value={newPin}
                          onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                          disabled={pending}
                          placeholder="New PIN"
                          className="h-12 text-center font-mono text-xl tracking-[0.4em]"
                        />
                        <Input
                          type="password"
                          inputMode="numeric"
                          autoComplete="off"
                          maxLength={6}
                          value={confirmPin}
                          onChange={(e) =>
                            setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 6))
                          }
                          disabled={pending}
                          placeholder="Confirm PIN"
                          className="h-12 text-center font-mono text-xl tracking-[0.4em]"
                        />
                        <Button
                          type="submit"
                          size="lg"
                          className="h-12 w-full text-sm"
                          disabled={pending || newPin.length < 4 || confirmPin.length < 4}
                        >
                          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Save PIN and continue
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="lg"
                          className="h-10 w-full text-xs"
                          disabled={pending}
                          onClick={resetSelection}
                        >
                          <X className="mr-1.5 h-3.5 w-3.5" /> Cancel
                        </Button>
                      </form>
                    ) : !match.hasPin ? (
                      <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-center text-xs text-destructive">
                        No kiosk PIN set for this account. Ask an admin to reset your PIN.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        <label className="block text-center text-xs text-muted-foreground">
                          {match.mustChangePin
                            ? "Enter the temporary PIN from your admin"
                            : "Enter your PIN to confirm"}
                        </label>
                        <Input
                          ref={pinRef}
                          type="password"
                          inputMode="numeric"
                          autoComplete="off"
                          maxLength={6}
                          value={pin}
                          onChange={(e) =>
                            setPin(e.target.value.replace(/\D/g, "").slice(0, 6))
                          }
                          disabled={pending}
                          placeholder="••••"
                          className="h-12 text-center font-mono text-xl tracking-[0.4em]"
                        />
                      </div>
                    )}

                    <div className={cn("grid grid-cols-2 gap-2", step === "newpin" && "hidden")}>
                      {match.status === "OUT" && (
                        <Button
                          size="lg"
                          variant="success"
                          className="col-span-2 h-12 text-sm"
                          disabled={pending || !match.hasPin || pin.length < 4}
                          onClick={() => act("CLOCK_IN")}
                        >
                          <Play className="mr-2 h-4 w-4" /> Clock in
                        </Button>
                      )}
                      {match.status === "ACTIVE" && (
                        <>
                          <Button
                            size="lg"
                            variant="warning"
                            className="h-12 text-sm"
                            disabled={pending || !match.hasPin || pin.length < 4}
                            onClick={() => act("START_BREAK")}
                          >
                            <Pause className="mr-2 h-4 w-4" /> Break
                          </Button>
                          <Button
                            size="lg"
                            variant="destructive"
                            className="h-12 text-sm"
                            disabled={pending || !match.hasPin || pin.length < 4}
                            onClick={() => act("CLOCK_OUT")}
                          >
                            <Square className="mr-2 h-4 w-4" /> Clock out
                          </Button>
                        </>
                      )}
                      {match.status === "ON_BREAK" && (
                        <Button
                          size="lg"
                          variant="success"
                          className="col-span-2 h-12 text-sm"
                          disabled={pending || !match.hasPin || pin.length < 4}
                          onClick={() => act("END_BREAK")}
                        >
                          <Coffee className="mr-2 h-4 w-4" /> End break
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="lg"
                        className="col-span-2 h-10 text-xs"
                        disabled={pending}
                        onClick={resetSelection}
                      >
                        <X className="mr-1.5 h-3.5 w-3.5" /> Cancel
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <footer className="flex items-center justify-between border-t bg-background px-6 py-3 sm:px-8">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          /kiosk/{slug}
        </p>
        <form action={endKioskSession.bind(null, slug)}>
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className="text-[11px] text-muted-foreground"
          >
            <LogOut className="mr-1.5 h-3 w-3" /> End kiosk session
          </Button>
        </form>
      </footer>
    </div>
  );
}
