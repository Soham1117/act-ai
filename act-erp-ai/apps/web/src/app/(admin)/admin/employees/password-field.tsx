"use client";

import { useState } from "react";
import { Copy, Eye, EyeOff, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { generatePassword } from "@/lib/password-generator";

/**
 * Masked password input for admin-set passwords, with Show/Hide, a strong
 * generator (reveals the result so it can be handed over) and Copy.
 */
export function AdminPasswordField({
  value,
  onChange,
  id,
  onGenerate,
}: {
  value: string;
  onChange: (v: string) => void;
  id?: string;
  /** Called with the generated password (e.g. to also fill a confirm box). */
  onGenerate?: (pw: string) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex gap-1.5">
      <Input
        id={id}
        type={show ? "text" : "password"}
        autoComplete="new-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        minLength={8}
        className="font-mono"
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="shrink-0"
        title={show ? "Hide" : "Show"}
        onClick={() => setShow((s) => !s)}
      >
        {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="shrink-0"
        title="Generate a strong password"
        onClick={() => {
          const pw = generatePassword();
          onChange(pw);
          onGenerate?.(pw);
          setShow(true);
        }}
      >
        <Wand2 className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="shrink-0"
        title="Copy"
        disabled={!value}
        onClick={() => {
          void navigator.clipboard.writeText(value);
          toast.success("Password copied");
        }}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
