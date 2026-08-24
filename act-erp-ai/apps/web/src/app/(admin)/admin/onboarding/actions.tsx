"use client";

import { useState, useTransition } from "react";
import { Plus, Loader2, Copy, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toastAction } from "@/lib/toast-action";
import {
  createOnboardingInvite,
  revokeOnboardingInvite,
} from "@/server/actions/onboarding";

export function OnboardingActions() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const invite = await createOnboardingInvite({ email: email || undefined });
      if (!toastAction(invite)) return;
      const url = `${window.location.origin}/onboard/${invite.token}`;
      setGeneratedUrl(url);
    });
  }

  function copy() {
    if (!generatedUrl) return;
    navigator.clipboard.writeText(generatedUrl);
    toast.success("Link copied");
  }

  function close() {
    setOpen(false);
    setEmail("");
    setGeneratedUrl(null);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); else setOpen(true); }}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" /> Generate invite
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Generate onboarding invite</DialogTitle>
        </DialogHeader>
        {generatedUrl ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Share this link with the new hire. It expires in 7 days and can
              only be used once.
            </p>
            <div className="flex gap-2">
              <Input value={generatedUrl} readOnly className="font-mono text-xs" />
              <Button type="button" variant="secondary" onClick={copy}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Email (optional)</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="newhire@actools.com"
              />
              <p className="text-[10px] text-muted-foreground">
                For your records only. The new hire enters their own email
                during onboarding.
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>Cancel</Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Generate link
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function RowActions({ inviteId, token }: { inviteId: string; token: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex gap-1.5">
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          const url = `${window.location.origin}/onboard/${token}`;
          navigator.clipboard.writeText(url);
          toast.success("Link copied");
        }}
      >
        <Copy className="mr-2 h-3 w-3" /> Copy link
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await revokeOnboardingInvite(inviteId);
            if (!toastAction(res)) return;
            toast.success("Invite revoked");
          })
        }
      >
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
      </Button>
    </div>
  );
}
