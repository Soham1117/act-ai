"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { Button } from "@/components/ui/button";
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
import { upsertBenefitPlan } from "@/server/actions/benefits";
import { runAction, toastAction } from "@/lib/toast-action";
import { tierLabel } from "@/lib/benefits";

const TYPES = [
  "MEDICAL",
  "DENTAL",
  "VISION",
  "RETIREMENT_401K",
  "LIFE",
  "DISABILITY_STD",
  "DISABILITY_LTD",
  "HSA",
  "FSA",
  "OTHER",
] as const;
const TIERS = [
  "EMPLOYEE_ONLY",
  "EMPLOYEE_SPOUSE",
  "EMPLOYEE_CHILDREN",
  "EMPLOYEE_PLUS_ONE",
  "FAMILY",
  "OTHER",
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
  planCode: string | null;
  planDesignation: string | null;
  matchDescription: string | null;
  vestingDescription: string | null;
  notes: string | null;
  tiers: { tier: (typeof TIERS)[number]; employeeCost: number; employerCost: number }[];
  ageRates: {
    ageFrom: number;
    ageTo: number;
    monthlyEmployeeCost: number;
    perPay26EmployeeCost: number;
  }[];
};

type AgeRow = {
  ageFrom: string;
  ageTo: string;
  monthlyEmployeeCost: string;
  perPay26EmployeeCost: string;
};

export function PlanForm({ plan }: { plan?: PlanForEdit }) {
  const isEdit = !!plan;
  const formId = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [type, setType] = useState<(typeof TYPES)[number]>(plan?.type ?? "MEDICAL");
  const [name, setName] = useState(plan?.name ?? "");
  const [carrierName, setCarrierName] = useState(plan?.carrierName ?? "");
  const [groupNumber, setGroupNumber] = useState(plan?.groupNumber ?? "");
  const [carrierPhone, setCarrierPhone] = useState(plan?.carrierPhone ?? "");
  const [carrierPortalUrl, setCarrierPortalUrl] = useState(plan?.carrierPortalUrl ?? "");
  const [planYearStart, setPlanYearStart] = useState(plan?.planYearStart ?? "");
  const [planYearEnd, setPlanYearEnd] = useState(plan?.planYearEnd ?? "");
  const [costPeriod, setCostPeriod] = useState<(typeof PERIODS)[number]>(
    plan?.costPeriod ?? "MONTHLY",
  );
  const [planCode, setPlanCode] = useState(plan?.planCode ?? "");
  const [planDesignation, setPlanDesignation] = useState(plan?.planDesignation ?? "");
  const [matchDescription, setMatchDescription] = useState(plan?.matchDescription ?? "");
  const [vestingDescription, setVestingDescription] = useState(
    plan?.vestingDescription ?? "",
  );
  const [notes, setNotes] = useState(plan?.notes ?? "");
  const [tierPrices, setTierPrices] = useState<
    Record<string, { employeeCost: string; employerCost: string }>
  >(() =>
    Object.fromEntries(
      TIERS.map((t) => {
        const existing = plan?.tiers.find((x) => x.tier === t);
        return [
          t,
          {
            employeeCost: existing?.employeeCost.toString() ?? "",
            employerCost: existing?.employerCost.toString() ?? "",
          },
        ];
      }),
    ),
  );
  const [ageRows, setAgeRows] = useState<AgeRow[]>(() =>
    (plan?.ageRates ?? []).map((r) => ({
      ageFrom: String(r.ageFrom),
      ageTo: String(r.ageTo),
      monthlyEmployeeCost: String(r.monthlyEmployeeCost),
      perPay26EmployeeCost: String(r.perPay26EmployeeCost),
    })),
  );

  const hasTiers = type !== "RETIREMENT_401K";
  const showAgeRates = type === "MEDICAL";

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const partial = hasTiers
      ? TIERS.find((t) => {
          const a = tierPrices[t].employeeCost.trim() !== "";
          const b = tierPrices[t].employerCost.trim() !== "";
          return a !== b;
        })
      : undefined;
    if (partial) {
      toast.error(
        `Enter both employee and employer prices for ${tierLabel(partial)}, or clear both to remove the tier.`,
      );
      return;
    }
    if (planYearEnd <= planYearStart) {
      toast.error("The plan year must end after it starts.");
      return;
    }
    startTransition(async () => {
      const tiers = hasTiers
        ? TIERS.filter((t) => tierPrices[t].employeeCost.trim() !== "").map((t) => ({
            tier: t,
            employeeCost: Number(tierPrices[t].employeeCost),
            employerCost: Number(tierPrices[t].employerCost),
          }))
        : undefined;
      const ageRates = showAgeRates
        ? ageRows
            .filter((r) => r.ageFrom.trim() !== "" && r.ageTo.trim() !== "")
            .map((r) => ({
              ageFrom: Number(r.ageFrom),
              ageTo: Number(r.ageTo),
              monthlyEmployeeCost: Number(r.monthlyEmployeeCost || 0),
              perPay26EmployeeCost: Number(r.perPay26EmployeeCost || 0),
            }))
        : undefined;
      const input = {
        id: plan?.id,
        tiers,
        ageRates,
        type,
        name,
        carrierName,
        groupNumber: groupNumber || undefined,
        carrierPhone: carrierPhone || undefined,
        carrierPortalUrl: carrierPortalUrl || undefined,
        planYearStart,
        planYearEnd,
        costPeriod,
        planCode: planCode || undefined,
        planDesignation: planDesignation || undefined,
        matchDescription: matchDescription || undefined,
        vestingDescription: vestingDescription || undefined,
        notes: notes || undefined,
      };
      const planRes = await runAction(() => upsertBenefitPlan(input));
      if (!toastAction(planRes)) return;
      toast.success(isEdit ? "Plan updated" : "Plan created");
      router.push("/admin/benefits");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-3xl space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${formId}-type`}>Type</Label>
          <Select
            value={type}
            onValueChange={(v) => setType(v as typeof type)}
            disabled={isEdit}
          >
            <SelectTrigger id={`${formId}-type`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${formId}-costPeriod`}>Cost period</Label>
          <Select
            value={costPeriod}
            onValueChange={(v) => setCostPeriod(v as typeof costPeriod)}
          >
            <SelectTrigger id={`${formId}-costPeriod`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => (
                <SelectItem key={p} value={p}>
                  {p.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${formId}-name`}>Plan name</Label>
        <Input
          id={`${formId}-name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="BCBS Blue Advantage Silver HMO"
          required
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${formId}-carrierName`}>Carrier</Label>
          <Input
            id={`${formId}-carrierName`}
            value={carrierName}
            onChange={(e) => setCarrierName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${formId}-planCode`}>Plan code</Label>
          <Input
            id={`${formId}-planCode`}
            value={planCode}
            onChange={(e) => setPlanCode(e.target.value)}
            placeholder="S9J7ADT"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${formId}-planDesignation`}>Designation</Label>
          <Input
            id={`${formId}-planDesignation`}
            value={planDesignation}
            onChange={(e) => setPlanDesignation(e.target.value)}
            placeholder="BASE or BUY_UP"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${formId}-groupNumber`}>Group number</Label>
          <Input
            id={`${formId}-groupNumber`}
            value={groupNumber}
            onChange={(e) => setGroupNumber(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${formId}-carrierPhone`}>Carrier phone</Label>
          <Input
            id={`${formId}-carrierPhone`}
            value={carrierPhone}
            onChange={(e) => setCarrierPhone(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${formId}-carrierPortalUrl`}>Carrier portal URL</Label>
          <Input
            id={`${formId}-carrierPortalUrl`}
            value={carrierPortalUrl}
            onChange={(e) => setCarrierPortalUrl(e.target.value)}
            placeholder="https://…"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${formId}-planYearStart`}>Plan year start</Label>
          <Input
            id={`${formId}-planYearStart`}
            type="date"
            value={planYearStart}
            onChange={(e) => setPlanYearStart(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${formId}-planYearEnd`}>Plan year end</Label>
          <Input
            id={`${formId}-planYearEnd`}
            type="date"
            value={planYearEnd}
            onChange={(e) => setPlanYearEnd(e.target.value)}
            required
          />
        </div>
      </div>

      {hasTiers ? (
        <div className="space-y-2">
          <Label>Tier pricing (clear both boxes to remove a tier)</Label>
          <p className="text-xs text-muted-foreground">
            For medical age-banded plans, leave tiers at 0 — employee cost comes from the
            age table below.
          </p>
          <div className="space-y-2 rounded-md border p-3">
            {TIERS.map((t) => (
              <div
                key={t}
                className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_100px_100px]"
              >
                <span className="text-sm text-muted-foreground">{tierLabel(t)}</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  aria-label={`${tierLabel(t)} employee cost`}
                  placeholder="Employee"
                  value={tierPrices[t].employeeCost}
                  onChange={(e) =>
                    setTierPrices((p) => ({
                      ...p,
                      [t]: { ...p[t], employeeCost: e.target.value },
                    }))
                  }
                />
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  aria-label={`${tierLabel(t)} employer cost`}
                  placeholder="Employer"
                  value={tierPrices[t].employerCost}
                  onChange={(e) =>
                    setTierPrices((p) => ({
                      ...p,
                      [t]: { ...p[t], employerCost: e.target.value },
                    }))
                  }
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-matchDescription`}>Employer match</Label>
            <Textarea
              id={`${formId}-matchDescription`}
              value={matchDescription}
              onChange={(e) => setMatchDescription(e.target.value)}
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-vestingDescription`}>Vesting</Label>
            <Textarea
              id={`${formId}-vestingDescription`}
              value={vestingDescription}
              onChange={(e) => setVestingDescription(e.target.value)}
              rows={2}
            />
          </div>
        </>
      )}

      {showAgeRates && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>Age-banded employee cost (after ACT contribution)</Label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                setAgeRows((rows) => [
                  ...rows,
                  {
                    ageFrom: "",
                    ageTo: "",
                    monthlyEmployeeCost: "",
                    perPay26EmployeeCost: "",
                  },
                ])
              }
            >
              Add band
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Monthly and 26-pay amounts from the renewal rate sheet. Empty list clears all
            bands on save.
          </p>
          <div className="space-y-2 rounded-md border p-3">
            <div className="hidden grid-cols-[70px_70px_minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 text-xs text-muted-foreground sm:grid">
              <span>From</span>
              <span>To</span>
              <span>Monthly $</span>
              <span>26-pay $</span>
              <span />
            </div>
            {ageRows.length === 0 && (
              <p className="text-sm text-muted-foreground">No age bands yet.</p>
            )}
            {ageRows.map((row, idx) => (
              <div
                key={idx}
                className="grid grid-cols-2 gap-2 rounded-md border p-2 sm:grid-cols-[70px_70px_minmax(0,1fr)_minmax(0,1fr)_auto] sm:border-0 sm:p-0"
              >
                <Input
                  aria-label={`Band ${idx + 1} from age`}
                  placeholder="From age"
                  value={row.ageFrom}
                  onChange={(e) =>
                    setAgeRows((rs) =>
                      rs.map((r, i) =>
                        i === idx ? { ...r, ageFrom: e.target.value } : r,
                      ),
                    )
                  }
                />
                <Input
                  aria-label={`Band ${idx + 1} to age`}
                  placeholder="To age"
                  value={row.ageTo}
                  onChange={(e) =>
                    setAgeRows((rs) =>
                      rs.map((r, i) => (i === idx ? { ...r, ageTo: e.target.value } : r)),
                    )
                  }
                />
                <Input
                  aria-label={`Band ${idx + 1} monthly employee cost`}
                  placeholder="Monthly $"
                  type="number"
                  step="0.01"
                  min="0"
                  value={row.monthlyEmployeeCost}
                  onChange={(e) =>
                    setAgeRows((rs) =>
                      rs.map((r, i) =>
                        i === idx ? { ...r, monthlyEmployeeCost: e.target.value } : r,
                      ),
                    )
                  }
                />
                <Input
                  aria-label={`Band ${idx + 1} 26-pay employee cost`}
                  placeholder="26-pay $"
                  type="number"
                  step="0.01"
                  min="0"
                  value={row.perPay26EmployeeCost}
                  onChange={(e) =>
                    setAgeRows((rs) =>
                      rs.map((r, i) =>
                        i === idx ? { ...r, perPay26EmployeeCost: e.target.value } : r,
                      ),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setAgeRows((rs) => rs.filter((_, i) => i !== idx))}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor={`${formId}-notes`}>Internal notes</Label>
        <Textarea
          id={`${formId}-notes`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
        />
      </div>

      <div className="flex flex-wrap gap-2 [&_button]:min-h-11">
        <Button
          type="submit"
          disabled={pending || !name || !carrierName || !planYearStart || !planYearEnd}
        >
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isEdit ? "Save plan" : "Create plan"}
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link href="/admin/benefits">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
