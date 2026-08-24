"use client";

import { useState, useTransition } from "react";
import { Plus, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createBenefitPlan, updateBenefitPlan, upsertPlanTiers } from "@/server/actions/benefits";
import { tierLabel } from "@/lib/benefits";

const TYPES = [
  "MEDICAL", "DENTAL", "VISION", "RETIREMENT_401K",
  "LIFE", "DISABILITY_STD", "DISABILITY_LTD", "HSA", "FSA", "OTHER",
] as const;
const TIERS = [
  "EMPLOYEE_ONLY", "EMPLOYEE_SPOUSE", "EMPLOYEE_CHILDREN", "EMPLOYEE_PLUS_ONE", "FAMILY", "OTHER",
] as const;
const PERIODS = ["PER_PAYCHECK", "MONTHLY", "ANNUAL"] as const;

export type PlanForEdit = {
  id: string;
  type: (typeof TYPES)[number];
  name: string;
  carrierName: string;
  groupNumber: string | null;
  carrierPhone: string | null;
  carrierPortalUrl: string | null;
  planYearStart: string;
  planYearEnd: string;
  costPeriod: (typeof PERIODS)[number];
  matchDescription: string | null;
  vestingDescription: string | null;
  notes: string | null;
  tiers: { tier: (typeof TIERS)[number]; employeeCost: number; employerCost: number }[];
};

export function PlanDialog({ plan }: { plan?: PlanForEdit }) {
  const isEdit = !!plan;
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [type, setType] = useState<(typeof TYPES)[number]>(plan?.type ?? "MEDICAL");
  const [name, setName] = useState(plan?.name ?? "");
  const [carrierName, setCarrierName] = useState(plan?.carrierName ?? "");
  const [groupNumber, setGroupNumber] = useState(plan?.groupNumber ?? "");
  const [carrierPhone, setCarrierPhone] = useState(plan?.carrierPhone ?? "");
  const [carrierPortalUrl, setCarrierPortalUrl] = useState(plan?.carrierPortalUrl ?? "");
  const [planYearStart, setPlanYearStart] = useState(plan?.planYearStart ?? "");
  const [planYearEnd, setPlanYearEnd] = useState(plan?.planYearEnd ?? "");
  const [costPeriod, setCostPeriod] = useState<(typeof PERIODS)[number]>(plan?.costPeriod ?? "PER_PAYCHECK");
  const [matchDescription, setMatchDescription] = useState(plan?.matchDescription ?? "");
  const [vestingDescription, setVestingDescription] = useState(plan?.vestingDescription ?? "");
  const [notes, setNotes] = useState(plan?.notes ?? "");
  const [tierPrices, setTierPrices] = useState<Record<string, { employeeCost: string; employerCost: string }>>(
    () =>
      Object.fromEntries(
        TIERS.map((t) => {
          const existing = plan?.tiers.find((x) => x.tier === t);
          return [t, { employeeCost: existing?.employeeCost.toString() ?? "", employerCost: existing?.employerCost.toString() ?? "" }];
        }),
      ),
  );

  const hasTiers = type !== "RETIREMENT_401K";

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const input = {
          type,
          name,
          carrierName,
          groupNumber: groupNumber || undefined,
          carrierPhone: carrierPhone || undefined,
          carrierPortalUrl: carrierPortalUrl || undefined,
          planYearStart,
          planYearEnd,
          costPeriod,
          matchDescription: matchDescription || undefined,
          vestingDescription: vestingDescription || undefined,
          notes: notes || undefined,
        };
        const { id } = isEdit ? await updateBenefitPlan(plan.id, input) : await createBenefitPlan(input);

        if (hasTiers) {
          const rows = TIERS.filter(
            (t) => tierPrices[t].employeeCost.trim() !== "" || tierPrices[t].employerCost.trim() !== "",
          ).map((t) => ({
            tier: t,
            employeeCost: Number(tierPrices[t].employeeCost || 0),
            employerCost: Number(tierPrices[t].employerCost || 0),
          }));
          if (rows.length > 0) await upsertPlanTiers(id, rows);
        }

        toast.success(isEdit ? "Plan updated" : "Plan created");
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {isEdit ? (
          <Button size="sm" variant="outline">
            <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
          </Button>
        ) : (
          <Button size="sm">
            <Plus className="mr-1.5 h-3.5 w-3.5" /> New plan
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit plan" : "New plan"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as typeof type)} disabled={isEdit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Cost period</Label>
              <Select value={costPeriod} onValueChange={(v) => setCostPeriod(v as typeof costPeriod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PERIODS.map((p) => <SelectItem key={p} value={p}>{p.replace(/_/g, " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Plan name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="BCBS PPO Gold" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Carrier</Label>
              <Input value={carrierName} onChange={(e) => setCarrierName(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Group number</Label>
              <Input value={groupNumber} onChange={(e) => setGroupNumber(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Carrier phone</Label>
              <Input value={carrierPhone} onChange={(e) => setCarrierPhone(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Carrier portal URL</Label>
              <Input value={carrierPortalUrl} onChange={(e) => setCarrierPortalUrl(e.target.value)} placeholder="https://…" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Plan year start</Label>
              <Input type="date" value={planYearStart} onChange={(e) => setPlanYearStart(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Plan year end</Label>
              <Input type="date" value={planYearEnd} onChange={(e) => setPlanYearEnd(e.target.value)} required />
            </div>
          </div>

          {hasTiers ? (
            <div className="space-y-1.5">
              <Label className="text-xs">Tier pricing (leave blank to skip a tier)</Label>
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
          ) : (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Employer match (free text, copied from plan document)</Label>
                <Textarea
                  value={matchDescription}
                  onChange={(e) => setMatchDescription(e.target.value)}
                  rows={2}
                  placeholder="100% of the first 3%, then 50% of the next 2%"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Vesting</Label>
                <Textarea value={vestingDescription} onChange={(e) => setVestingDescription(e.target.value)} rows={2} />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">Internal notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending || !name || !carrierName || !planYearStart || !planYearEnd}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEdit ? "Save" : "Create plan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
