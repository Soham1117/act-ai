"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { POLICY_FIELDS } from "@/lib/watch/catalog";
import type { WatchPolicy } from "@/lib/watch/types";
import { runAction, toastAction } from "@/lib/toast-action";
import { saveWatchPolicy, setRuleEnabled } from "@/server/actions/watch";

type Rule = { id: string; label: string; group: string; enabled: boolean; offByDefault: boolean };

export function RulesWorkspace({ rules, policy }: { rules: Rule[]; policy: WatchPolicy }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [numbers, setNumbers] = useState<Record<string, string>>(
    Object.fromEntries(POLICY_FIELDS.map((f) => [f.key, String(policy[f.key])])),
  );
  const [recipients, setRecipients] = useState(policy.digestRecipientEmails.join(", "));

  function toggle(rule: Rule) {
    start(async () => {
      const res = await runAction(() => setRuleEnabled({ ruleId: rule.id, enabled: !rule.enabled }));
      if (!toastAction(res)) return;
      toast.success(`${rule.label}: ${rule.enabled ? "off" : "on"}`);
      router.refresh();
    });
  }

  function save() {
    start(async () => {
      const res = await runAction(() => saveWatchPolicy({ numbers, recipients }));
      if (!toastAction(res)) return;
      toast.success("Settings saved. They apply on the next check.");
      router.refresh();
    });
  }

  const groups = [...new Set(rules.map((r) => r.group))];

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-base font-semibold">Numbers the checks use</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {POLICY_FIELDS.map((f) => (
            <div key={f.key} className="space-y-1">
              <Label htmlFor={`p-${f.key}`} className="text-sm">
                {f.label}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id={`p-${f.key}`}
                  type="number"
                  inputMode="decimal"
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  value={numbers[f.key]}
                  onChange={(e) => setNumbers({ ...numbers, [f.key]: e.target.value })}
                  className="h-9 max-w-[8rem]"
                />
                <span className="text-xs text-muted-foreground">{f.unit}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-1">
          <Label htmlFor="p-recipients" className="text-sm">
            Who gets the daily digest (emails, separated by commas)
          </Label>
          <Input
            id="p-recipients"
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
            className="h-9 max-w-xl"
          />
        </div>
        <Button onClick={save} disabled={pending}>
          Save settings
        </Button>
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold">Checks</h2>
        {groups.map((g) => (
          <div key={g} className="space-y-1">
            <h3 className="text-sm font-medium text-muted-foreground">{g}</h3>
            <ul className="divide-y rounded-md border">
              {rules
                .filter((r) => r.group === g)
                .map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <span>{r.label}</span>
                      {r.offByDefault && !r.enabled && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          off until the data supports it
                        </span>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant={r.enabled ? "default" : "outline"}
                      disabled={pending}
                      onClick={() => toggle(r)}
                      aria-pressed={r.enabled}
                      aria-label={`${r.label}: ${r.enabled ? "on" : "off"}`}
                    >
                      {r.enabled ? "On" : "Off"}
                    </Button>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
