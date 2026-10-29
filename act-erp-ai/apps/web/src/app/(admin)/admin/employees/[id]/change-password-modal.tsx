"use client";

import { useId, useState, useTransition } from "react";
import { Loader2, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  InlinePanel,
  InlinePanelContent,
  InlinePanelDescription,
  InlinePanelFooter,
  InlinePanelHeader,
  InlinePanelTitle,
  InlinePanelTrigger,
} from "@/components/inline-panel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { runAction, toastAction } from "@/lib/toast-action";
import { changeEmployeePassword } from "@/server/actions/employees";
import { AdminPasswordField } from "../password-field";

export function ChangePasswordPanel({
  employeeId,
  employeeName,
}: {
  employeeId: string;
  employeeName: string;
}) {
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [mustChange, setMustChange] = useState(true);

  function reset() {
    setPassword("");
    setConfirm("");
    setMustChange(true);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Passwords don't match");
      return;
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    startTransition(async () => {
      const res = await runAction(() => changeEmployeePassword(employeeId, { password, mustChange }));
      if (!toastAction(res)) return;
      toast.success(`Password reset for ${employeeName}`);
      setOpen(false);
      reset();
    });
  }

  return (
    <InlinePanel disabled={pending}
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <InlinePanelTrigger asChild>
        <Button variant="outline" size="sm">
          <KeyRound className="mr-2 h-3.5 w-3.5" /> Reset password
        </Button>
      </InlinePanelTrigger>
      <InlinePanelContent className="max-w-md">
        <InlinePanelHeader>
          <InlinePanelTitle>Reset password</InlinePanelTitle>
          <InlinePanelDescription>
            Set a temporary password for {employeeName} and give it to them in person. Their
            current sessions are signed out.
          </InlinePanelDescription>
        </InlinePanelHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">New password</Label>
            <AdminPasswordField
              value={password}
              onChange={setPassword}
              onGenerate={(pw) => setConfirm(pw)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-1`} className="text-xs">Confirm password</Label>
            <Input id={`${fieldId}-1`}
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id="must-change"
              checked={mustChange}
              onCheckedChange={(v) => setMustChange(v === true)}
              className="mt-0.5"
            />
            <Label htmlFor="must-change" className="text-xs leading-snug">
              Require them to choose their own password at next sign-in (recommended)
            </Label>
          </div>
          <InlinePanelFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </InlinePanelFooter>
        </form>
      </InlinePanelContent>
    </InlinePanel>
  );
}
