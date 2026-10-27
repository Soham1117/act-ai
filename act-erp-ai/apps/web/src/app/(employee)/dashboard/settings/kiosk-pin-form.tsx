"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { runAction } from "@/lib/toast-action";
import { setMyKioskPin } from "@/server/actions/kiosk";
import { usePortalLanguage } from "@/components/portal-language";

export function KioskPinForm() {
  const { t, toastAction } = usePortalLanguage();
  const [pending, startTransition] = useTransition();
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{4}$/.test(pin)) return toast.error(t("account.kioskPin.invalid"));
    if (pin !== confirmPin) return toast.error(t("account.kioskPin.mismatch"));
    startTransition(async () => {
      const res = await runAction(() => setMyKioskPin(password, pin));
      if (!toastAction(res)) return;
      toast.success(t("account.kioskPin.updated"));
      setPassword("");
      setPin("");
      setConfirmPin("");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">{t("account.password.current")}</Label>
        <Input
          aria-label={t("account.password.current")}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">{t("account.kioskPin.new")}</Label>
        <Input
          type="password"
          aria-label={t("account.kioskPin.new")}
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          required
          minLength={4}
          maxLength={4}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">{t("account.kioskPin.confirm")}</Label>
        <Input
          type="password"
          aria-label={t("account.kioskPin.confirm")}
          inputMode="numeric"
          value={confirmPin}
          onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          required
          minLength={4}
          maxLength={4}
        />
      </div>
      <Button type="submit" disabled={pending || !pin || !password}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {t("account.kioskPin.set")}
      </Button>
    </form>
  );
}
