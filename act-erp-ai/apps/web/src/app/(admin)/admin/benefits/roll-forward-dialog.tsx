"use client";

import { useState, useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { rollForwardPlanYear } from "@/server/actions/benefits";
import { toastAction } from "@/lib/toast-action";
import { tierLabel } from "@/lib/benefits";

const TIERS = [
  "EMPLOYEE_ONLY", "EMPLOYEE_SPOUSE", "EMPLOYEE_CHILDREN", "EMPLOYEE_PLUS_ONE", "FAMILY", "OTHER",
] as const;

export function RollForwardDialog({
  plan,
}: {
  plan: {
    id: string;
    name: string;
    type: string;
    planYearEnd: string;
    openEnrollmentCount: number;
    tiers: { tier: (typeof TIERS)[number]; employeeCost: number; employerCost: number }[];
  };
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [planYearStart, setPlanYearStart] = useState(plan.planYearEnd);
  const [planYearEnd, setPlanYearEnd] = useState("");
  const hasTiers = plan.type !== "RETIREMENT_401K";
  const [tierPrices, setTierPrices] = useState<Record<string, { employeeCost: string; employerCost: string }>>(
    () =>
      Object.fromEntries(
        TIERS.map((t) => {
          const existing = plan.tiers.find((x) => x.tier === t);
          return [t, { employeeCost: existing?.employeeCost.toString() ?? "", employerCost: existing?.employerCost.toString() ?? "" }];
        }),
      ),
  );

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const tiers = hasTiers
        ? TIERS.filter(
            (t) => tierPrices[t].employeeCost.trim() !== "" || tierPrices[t].employerCost.trim() !== "",
          ).map((t) => ({
            tier: t,
            employeeCost: Number(tierPrices[t].employeeCost || 0),
            employerCost: Number(tierPrices[t].employerCost || 0),
          }))
        : undefined;
      const res = await rollForwardPlanYear({ oldPlanId: plan.id, planYearStart, planYearEnd, tiers });
      if (!toastAction(res)) return;
      toast.success(`Rolled forward — ${plan.openEnrollmentCount} enrollment(s) mirrored to the new plan year`);
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Roll forward
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Roll forward {plan.name}</DialogTitle>
          <DialogDescription>
            Clones this plan into a new plan-year row, ends the {plan.openEnrollmentCount} currently-open
            enrollment(s) on {new Date(plan.planYearEnd).toLocaleDateString()}, and mirrors each of them
            onto the new plan carrying tier forward. Cost overrides are dropped — re-negotiate them for the
            new year if still needed.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">New plan year start</Label>
              <Input type="date" value={planYearStart} onChange={(e) => setPlanYearStart(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">New plan year end</Label>
              <Input type="date" value={planYearEnd} onChange={(e) => setPlanYearEnd(e.target.value)} required />
            </div>
          </div>

          {hasTiers && (
            <div className="space-y-1.5">
              <Label className="text-xs">New tier pricing</Label>
              <div className="space-y-1.5 rounded-md border p-2">
                {TIERS.map((t) => (
                  <div key={t} className="grid grid-cols-[1fr_90px_90px] items-center gap-2">
                    <span className="text-xs text-muted-foreground">{tierLabel(t)}</span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Employee"
                      value={tierPrices[t].employeeCost}
                      onChange={(e) =>
                        setTierPrices((p) => ({ ...p, [t]: { ...p[t], employeeCost: e.target.value } }))
                      }
                    />
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Employer"
                      value={tierPrices[t].employerCost}
                      onChange={(e) =>
                        setTierPrices((p) => ({ ...p, [t]: { ...p[t], employerCost: e.target.value } }))
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending || !planYearStart || !planYearEnd}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Roll forward
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
