"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { runAction } from "@/lib/toast-action";
import { updateMyPersonalEmail } from "@/server/actions/employees";
import { usePortalLanguage } from "@/components/portal-language";

export function PersonalEmailForm({
  current,
  required,
}: {
  current: string;
  required: boolean;
}) {
  const { t, toastAction } = usePortalLanguage();
  const [pending, startTransition] = useTransition();
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState(current);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await runAction(() => updateMyPersonalEmail(password, email));
      if (!toastAction(res)) return;
      toast.success(t("account.personalEmail.updated"));
      setPassword("");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">
          {t(
            required
              ? "account.personalEmail.labelRequired"
              : "account.personalEmail.labelOptional",
          )}
        </Label>
        <Input
          type="email"
          aria-label={t("account.personalEmail.label")}
          placeholder={t("account.personalEmail.placeholder")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required={required}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">{t("account.password.current")}</Label>
        <Input
          type="password"
          aria-label={t("account.password.current")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <Button type="submit" disabled={pending || !password || email === current}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {t("account.personalEmail.update")}
      </Button>
    </form>
  );
}
