"use client";

import { useState, useTransition } from "react";
import { Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toastAction, toastCaught } from "@/lib/toast-action";
import {
  addTrustedNetwork,
  removeTrustedNetwork,
  trustCurrentNetwork,
} from "@/server/actions/kiosk";

export type TrustedNetworkItem = {
  id: string;
  cidr: string;
  label: string | null;
  addedByEmail: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};

export function TrustedNetworksCard({
  env,
  trusted,
  currentIp,
  currentAllowed,
}: {
  env: string[];
  trusted: TrustedNetworkItem[];
  currentIp: string | null;
  currentAllowed: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [cidr, setCidr] = useState("");
  const [label, setLabel] = useState("");
  const [removing, setRemoving] = useState<TrustedNetworkItem | null>(null);

  function run(fn: () => Promise<void>) {
    startTransition(() => {
      void fn().catch(toastCaught);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Trusted networks</CardTitle>
        <CardDescription>
          A kiosk can only be activated from these networks. After activation the device cookie
          is what keeps it working, so a changing IP will not lock out a running kiosk.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 p-3 text-xs">
          <p>
            Your current IP:{" "}
            <span className="font-mono font-medium">{currentIp ?? "unknown"}</span>{" "}
            <Badge variant={currentAllowed ? "default" : "destructive"} className="ml-1 text-[10px]">
              {currentAllowed ? "allowed" : "not allowed"}
            </Badge>
          </p>
          {!currentAllowed && (
            <Button
              size="sm"
              className="ml-auto"
              disabled={pending || !currentIp}
              onClick={() =>
                run(async () => {
                  const res = await trustCurrentNetwork(label || undefined);
                  if (!toastAction(res)) return;
                  toast.success(`Trusted ${res.cidr}`);
                  setLabel("");
                })
              }
            >
              {pending ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="mr-2 h-3.5 w-3.5" />
              )}
              Trust my current network
            </Button>
          )}
        </div>

        <ul className="divide-y rounded-md border">
          {env.length === 0 && trusted.length === 0 && (
            <li className="p-3 text-xs text-muted-foreground">No trusted networks yet.</li>
          )}
          {env.map((n) => (
            <li key={`env:${n}`} className="flex items-center gap-3 p-3 text-xs">
              <span className="font-mono font-medium">{n}</span>
              <Badge variant="secondary" className="text-[10px]">
                server config
              </Badge>
            </li>
          ))}
          {trusted.map((t) => (
            <li key={t.id} className="flex items-center gap-3 p-3 text-xs">
              <div className="min-w-0 flex-1">
                <p className="truncate">
                  <span className="font-mono font-medium">{t.cidr}</span>
                  {t.label ? <span className="ml-2">{t.label}</span> : null}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Added {new Date(t.createdAt).toLocaleString()}
                  {t.addedByEmail ? ` by ${t.addedByEmail}` : ""}
                  {t.lastUsedAt
                    ? ` · last used ${new Date(t.lastUsedAt).toLocaleString()}`
                    : " · never used"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                disabled={pending}
                onClick={() => setRemoving(t)}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remove
              </Button>
            </li>
          ))}
        </ul>

        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const res = await addTrustedNetwork({ cidr, label: label || undefined });
              if (!toastAction(res)) return;
              toast.success(`Trusted ${res.cidr}`);
              setCidr("");
              setLabel("");
            });
          }}
        >
          <Input
            value={cidr}
            onChange={(e) => setCidr(e.target.value)}
            placeholder="IP or CIDR, e.g. 98.97.83.9"
            className="h-9 w-56 font-mono text-xs"
            aria-label="IP address or CIDR"
          />
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (optional)"
            maxLength={80}
            className="h-9 w-48 text-xs"
            aria-label="Label"
          />
          <Button type="submit" size="sm" disabled={pending || !cidr.trim()}>
            Add network
          </Button>
        </form>
      </CardContent>

      <AlertDialog open={!!removing} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this network?</AlertDialogTitle>
            <AlertDialogDescription>
              Kiosks cannot be activated from{" "}
              <span className="font-mono">{removing?.cidr}</span> after this. Kiosks that are
              already activated keep working.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                const target = removing;
                if (!target) return;
                run(async () => {
                  const res = await removeTrustedNetwork(target.id);
                  if (!toastAction(res)) return;
                  toast.success("Network removed");
                  setRemoving(null);
                });
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
