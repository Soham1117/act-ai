"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import {
  Coffee,
  LogOut,
  Pause,
  Play,
  Square,
  X,
  Loader2,
  ScanLine,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/logo";
import {
  kioskAction,
  kioskLookup,
  endKioskSession,
} from "@/server/actions/kiosk";
import { getAvatarUrl } from "@/lib/format";
import { toast } from "sonner";
import { toastAction } from "@/lib/toast-action";
import type { ActionOk } from "@/lib/action-result";

type LookupMatch = ActionOk<{
  id: string;
  employeeId: string;
  name: string;
  email: string | null;
  profilePic: string | null;
  jobTitle: string | null;
  hasPin: boolean;
  status: "ACTIVE" | "ON_BREAK" | "OUT";
  activeEntryId: string | null;
}>;

export function KioskScreen({
  slug,
  label,
}: {
  slug: string;
  label: string;
}) {
  const [now, setNow] = useState(new Date());
  const [input, setInput] = useState("");
  const [match, setMatch] = useState<LookupMatch | null>(null);
  const [pin, setPin] = useState("");
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const pinRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!match) return;
    const id = setTimeout(() => {
      setMatch(null);
      setPin("");
      setTimeout(() => inputRef.current?.focus(), 0);
    }, 12_000);
    return () => clearTimeout(id);
  }, [match]);

  useEffect(() => {
    if (!match) inputRef.current?.focus();
    else pinRef.current?.focus();
  }, [match, pending]);

  function submit(value: string) {
    const trimmed = value.trim().toUpperCase();
    if (!trimmed) return;
    startTransition(async () => {
      const r = await kioskLookup(slug, trimmed);
      setInput("");
      if (!toastAction(r)) return;
      setMatch(r);
    });
  }

  function act(action: "CLOCK_IN" | "CLOCK_OUT" | "START_BREAK" | "END_BREAK") {
    if (!match) return;
    if (!/^\d{4,6}$/.test(pin)) {
      toast.error("Enter your 4-6 digit PIN");
      return;
    }
    startTransition(async () => {
      const res = await kioskAction({ slug, employeeId: match.employeeId, pin, action });
      if (!toastAction(res)) {
        setPin("");
        return;
      }
      const labels: Record<typeof action, string> = {
        CLOCK_IN: "Clocked in",
        CLOCK_OUT: "Clocked out",
        START_BREAK: "Break started",
        END_BREAK: "Break ended",
      };
      toast.success(`${labels[action]} · ${match.name}`);
      setMatch(null);
      setPin("");
    });
  }

  return (
    <div className="grid min-h-screen grid-rows-[auto_1fr_auto] bg-muted/30 text-foreground">
      <header className="flex items-center justify-between border-b bg-background px-8 py-4">
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
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            })}
          </p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {now.toLocaleDateString([], {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>
      </header>

      <div className="grid place-items-center p-8">
        <div className="w-full max-w-md">
          <AnimatePresence mode="wait">
            {!match ? (
              <motion.div
                key="entry"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
                <Card className="shadow-sm">
                  <CardContent className="space-y-5 p-8">
                    <div className="space-y-1.5 text-center">
                      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <ScanLine className="h-5 w-5" />
                      </div>
                      <h2 className="text-lg font-semibold tracking-tight">
                        Enter your Employee ID
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        Scan your badge or type the ID, then press Enter.
                      </p>
                    </div>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        submit(input);
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
                        placeholder="EMP-2026-0001"
                        className="h-16 text-center font-mono text-2xl tracking-[0.18em] tabular-nums"
                        autoFocus
                      />
                      <Button
                        type="submit"
                        size="lg"
                        className="h-12 w-full text-sm"
                        disabled={pending || input.length === 0}
                      >
                        {pending && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        Continue
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              </motion.div>
            ) : (
              <motion.div
                key={match.employeeId}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
              >
                <Card className="shadow-sm">
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
                        <p className="truncate text-base font-semibold">
                          {match.name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {match.jobTitle ?? "—"} · {match.employeeId}
                        </p>
                      </div>
                      <Badge
                        variant={
                          match.status === "ACTIVE"
                            ? "success"
                            : match.status === "ON_BREAK"
                            ? "warning"
                            : "outline"
                        }
                        className="text-[10px]"
                      >
                        {match.status === "ACTIVE"
                          ? "On shift"
                          : match.status === "ON_BREAK"
                          ? "On break"
                          : "Clocked out"}
                      </Badge>
                    </div>

                    {!match.hasPin ? (
                      <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-center text-xs text-destructive">
                        No kiosk PIN set for this account. Set one in
                        Settings before clocking in/out here.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        <label className="block text-center text-xs text-muted-foreground">
                          Enter your PIN to confirm
                        </label>
                        <Input
                          ref={pinRef}
                          type="password"
                          inputMode="numeric"
                          autoComplete="off"
                          maxLength={6}
                          value={pin}
                          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                          disabled={pending}
                          placeholder="••••"
                          className="h-12 text-center font-mono text-xl tracking-[0.4em]"
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
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
                        onClick={() => setMatch(null)}
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

      <footer className="flex items-center justify-between border-t bg-background px-8 py-3">
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
