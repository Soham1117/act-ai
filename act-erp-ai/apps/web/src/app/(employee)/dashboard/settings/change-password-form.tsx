"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { runAction } from "@/lib/toast-action";
import { changeMyPassword } from "@/server/actions/auth";
import { usePortalLanguage } from "@/components/portal-language";

export function ChangePasswordForm() {
  const { t, toastAction } = usePortalLanguage();
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pw !== confirmPw) return toast.error(t("account.password.mismatch"));
    if (pw.length < 8) return toast.error(t("account.password.tooShort"));
    startTransition(async () => {
      const res = await runAction(() => changeMyPassword(current, pw));
      if (!toastAction(res)) return;
      toast.success(t("account.password.updated"));
      setCurrent("");
      setPw("");
      setConfirmPw("");
      // Sessions were revoked; bounce to login.
      setTimeout(() => (window.location.href = "/login"), 1200);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">{t("account.password.current")}</Label>
        <Input
          aria-label={t("account.password.current")}
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">{t("account.password.new")}</Label>
        <Input
          aria-label={t("account.password.new")}
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          required
          minLength={8}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">{t("account.password.confirm")}</Label>
        <Input
          aria-label={t("account.password.confirm")}
          type="password"
          value={confirmPw}
          onChange={(e) => setConfirmPw(e.target.value)}
          required
          minLength={8}
        />
      </div>
      <Button type="submit" disabled={pending || !pw || !current}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {t("account.password.update")}
      </Button>
    </form>
  );
}
