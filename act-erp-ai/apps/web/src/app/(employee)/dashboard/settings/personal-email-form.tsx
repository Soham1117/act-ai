"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toastAction } from "@/lib/toast-action";
import { updateMyPersonalEmail } from "@/server/actions/employees";

export function PersonalEmailForm({
  current,
  required,
}: {
  current: string;
  required: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState(current);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await updateMyPersonalEmail(password, email);
      if (!toastAction(res)) return;
      toast.success("Personal email updated");
      setPassword("");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Personal email {required ? "" : "(optional)"}</Label>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required={required}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Current password</Label>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <Button type="submit" disabled={pending || !password || email === current}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Update
      </Button>
    </form>
  );
}
