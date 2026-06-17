"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

export function ChangePasswordForm() {
  const [pending, startTransition] = useTransition();
  const [pw, setPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pw !== confirmPw) return toast.error("Passwords do not match");
    if (pw.length < 8) return toast.error("Min 8 characters");
    startTransition(async () => {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) toast.error(error.message);
      else {
        toast.success("Password updated");
        setPw(""); setConfirmPw("");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">New password</Label>
        <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={8} />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Confirm password</Label>
        <Input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} required minLength={8} />
      </div>
      <Button type="submit" disabled={pending || !pw}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Update password
      </Button>
    </form>
  );
}
