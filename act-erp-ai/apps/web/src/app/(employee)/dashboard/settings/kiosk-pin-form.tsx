"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setMyKioskPin } from "@/server/actions/kiosk";

export function KioskPinForm() {
  const [pending, startTransition] = useTransition();
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{4,6}$/.test(pin)) return toast.error("PIN must be 4-6 digits");
    if (pin !== confirmPin) return toast.error("PINs do not match");
    startTransition(async () => {
      const res = await setMyKioskPin(password, pin);
      if (!res.ok) {
        toast.error(res.error ?? "Could not set PIN");
        return;
      }
      toast.success("Kiosk PIN set");
      setPassword("");
      setPin("");
      setConfirmPin("");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Current password</Label>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">New PIN (4-6 digits)</Label>
        <Input
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          required
          minLength={4}
          maxLength={6}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Confirm PIN</Label>
        <Input
          type="password"
          inputMode="numeric"
          value={confirmPin}
          onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          required
          minLength={4}
          maxLength={6}
        />
      </div>
      <Button type="submit" disabled={pending || !pin || !password}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Set PIN
      </Button>
    </form>
  );
}
