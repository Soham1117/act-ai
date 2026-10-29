"use client";

import { useId, useState, useTransition } from "react";
import { CheckCircle2, Loader2, Plus, Repeat, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  InlinePanel,
  InlinePanelContent,
  InlinePanelFooter,
  InlinePanelHeader,
  InlinePanelTitle,
  InlinePanelTrigger,
} from "@/components/inline-panel";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  upsertEnrollment,
  changeEnrollmentTier,
  endEnrollment,
  upsertRetirementElection,
  endRetirementElection,
  confirmEnrollment,
  confirmRetirementElection,
} from "@/server/actions/benefits";
import { runAction, toastAction } from "@/lib/toast-action";
import { benefitTypeLabel, tierLabel, coverageState, utcToday } from "@/lib/benefits";
import {
  attainedAgeYears,
  resolveMedicalEmployeeCost,
  type AgeRateBand,
} from "@/lib/benefit-age-rates";
import { formatCurrency, formatDateOnly } from "@/lib/format";

const TIERS = [
  "EMPLOYEE_ONLY", "EMPLOYEE_SPOUSE", "EMPLOYEE_CHILDREN", "EMPLOYEE_PLUS_ONE", "FAMILY", "OTHER",
] as const;
const STATUSES = ["PENDING", "ENROLLED", "WAIVED"] as const;

export type PlanOption = {
  id: string;
  type: string;
  name: string;
  carrierName: string;
  costPeriod: string;
  tiers: { tier: (typeof TIERS)[number]; employeeCost: number; employerCost: number }[];
  ageRates: AgeRateBand[];
};

export type EnrollmentRow = {
  id: string;
  tier: (typeof TIERS)[number] | null;
  status: (typeof STATUSES)[number];
  effectiveDate: string;
  endDate: string | null;
  memberId: string | null;
  confirmedAsOf: string;
  plan: { id: string; type: string; name: string; costPeriod: string };
};

export type ElectionRow = {
  id: string;
  status: (typeof STATUSES)[number];
  effectiveDate: string;
  endDate: string | null;
  preTaxPercent: number | null;
  rothPercent: number | null;
  flatAmountPerPay: number | null;
  plan: { id: string; name: string };
};

export function BenefitsCard({
  employeeId,
  plans,
  enrollments,
  elections,
  dateOfBirth,
}: {
  employeeId: string;
  plans: PlanOption[];
  enrollments: EnrollmentRow[];
  elections: ElectionRow[];
  dateOfBirth: string | null;
}) {
  const healthPlans = plans.filter((p) => p.type !== "RETIREMENT_401K");
  const retirementPlans = plans.filter((p) => p.type === "RETIREMENT_401K");
  const today = utcToday();
  const dob = dateOfBirth ? new Date(`${dateOfBirth}T00:00:00.000Z`) : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Benefits</CardTitle>

      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex min-w-0 flex-wrap gap-2">
          <EnrollPanel employeeId={employeeId} plans={healthPlans} dateOfBirth={dob} />
          <ElectionPanel employeeId={employeeId} plans={retirementPlans} />
        </div>
        {enrollments.length === 0 && elections.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">No benefits information on file.</p>
        )}
        {enrollments.length > 0 && (
          <ul className="divide-y">
            {enrollments.map((e) => {
              const state = coverageState(
                { status: e.status, effectiveDate: new Date(e.effectiveDate), endDate: e.endDate ? new Date(e.endDate) : null },
                null,
                today,
              );
              const isOpen = !e.endDate;
              return (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <div>
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">{benefitTypeLabel(e.plan.type)}</Badge>
                      <span className="font-medium">{e.plan.name}</span>
                      <StateBadge state={state} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {tierLabel(e.tier)} · {e.memberId ?? "no member ID"} ·{" "}
                      {formatDateOnly(new Date(e.effectiveDate))} →{" "}
                      {e.endDate ? formatDateOnly(new Date(e.endDate)) : "present"}
                    </p>
                  </div>
                  {isOpen && (
                    <div className="flex w-full flex-wrap gap-2">
                      {e.status === "PENDING" && (
                        <ConfirmButton onConfirm={() => confirmEnrollment(e.id)} label="Confirm enrollment" />
                      )}
                      {e.status === "ENROLLED" && e.tier && (
                        <ChangeTierPanel enrollment={e} plans={healthPlans} />
                      )}
                      <EndEnrollmentPanel enrollmentId={e.id} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {elections.length > 0 && (
          <ul className="divide-y">
            {elections.map((el) => {
              const state = coverageState(
                { status: el.status, effectiveDate: new Date(el.effectiveDate), endDate: el.endDate ? new Date(el.endDate) : null },
                null,
                today,
              );
              const isOpen = !el.endDate;
              return (
                <li key={el.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <div>
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">401(k)</Badge>
                      <span className="font-medium">{el.plan.name}</span>
                      <StateBadge state={state} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {el.flatAmountPerPay !== null
                        ? `${formatCurrency(el.flatAmountPerPay)}/paycheck`
                        : [
                            el.preTaxPercent !== null ? `${el.preTaxPercent}% pre-tax` : null,
                            el.rothPercent !== null ? `${el.rothPercent}% Roth` : null,
                          ]
                            .filter(Boolean)
                            .join(" + ") || "—"}{" "}
                      · {formatDateOnly(new Date(el.effectiveDate))} →{" "}
                      {el.endDate ? formatDateOnly(new Date(el.endDate)) : "present"}
                    </p>
                  </div>
                  {isOpen && (
                    <div className="flex w-full flex-wrap gap-2">
                      {el.status === "PENDING" && (
                        <ConfirmButton onConfirm={() => confirmRetirementElection(el.id)} label="Confirm election" />
                      )}
                      <EndElectionPanel electionId={el.id} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ConfirmButton({
  onConfirm,
  label,
}: {
  onConfirm: () => Promise<{ ok: true } | { ok: false; error: string }>;
  label: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await runAction(onConfirm);
          if (!toastAction(res)) return;
          toast.success("Confirmed");
        })
      }
    >
      {pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
      {label}
    </Button>
  );
}

function StateBadge({ state }: { state: string }) {
  const variant =
    state === "current" ? "success" : state === "waived" ? "secondary" : state === "pending" ? "warning" : "destructive";
  return <Badge variant={variant} className="text-[10px]">{state}</Badge>;
}

function EnrollPanel({
  employeeId,
  plans,
  dateOfBirth,
}: {
  employeeId: string;
  plans: PlanOption[];
  dateOfBirth: Date | null;
}) {
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("ENROLLED");
  const [tier, setTier] = useState<(typeof TIERS)[number] | "">("EMPLOYEE_ONLY");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [memberId, setMemberId] = useState("");
  const [employeeCostOverride, setEmployeeCostOverride] = useState("");
  const [employerCostOverride, setEmployerCostOverride] = useState("");
  const [notes, setNotes] = useState("");

  const selectedPlan = plans.find((p) => p.id === planId);
  const asOf = effectiveDate ? new Date(`${effectiveDate}T00:00:00.000Z`) : utcToday();
  const medicalBand =
    selectedPlan?.type === "MEDICAL" && selectedPlan.ageRates.length > 0
      ? resolveMedicalEmployeeCost(selectedPlan.ageRates, dateOfBirth, asOf)
      : null;
  const medicalAgeHint =
    selectedPlan?.type === "MEDICAL" && selectedPlan.ageRates.length > 0
      ? medicalBand && dateOfBirth
        ? `Age ${attainedAgeYears(dateOfBirth, asOf)} → ${formatCurrency(medicalBand.monthlyEmployeeCost)}/mo (${formatCurrency(medicalBand.perPay26EmployeeCost)} / 26-pay). Confirm will lock this as employee cost unless you override.`
        : "This medical plan uses age-banded rates. Add date of birth on the employee, or enter an employee cost override."
      : null;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await runAction(() => upsertEnrollment({
        employeeId,
        planId,
        tier: status === "WAIVED" ? null : (tier || null),
        status,
        effectiveDate,
        memberId: memberId || undefined,
        employeeCostOverride: employeeCostOverride ? Number(employeeCostOverride) : null,
        employerCostOverride: employerCostOverride ? Number(employerCostOverride) : null,
        notes: notes || undefined,
      }));
      if (!toastAction(res)) return;
      toast.success("Enrollment saved");
      setOpen(false);
    });
  }

  if (plans.length === 0) return null;

  return (
    <InlinePanel disabled={pending} open={open} onOpenChange={setOpen}>
      <InlinePanelTrigger asChild>
        <Button size="sm" variant="outline"><Plus className="mr-1.5 h-3.5 w-3.5" /> Enroll</Button>
      </InlinePanelTrigger>
      <InlinePanelContent>
        <InlinePanelHeader><InlinePanelTitle>New enrollment</InlinePanelTitle></InlinePanelHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-1`} className="text-xs">Plan</Label>
            <Select value={planId} onValueChange={setPlanId}>
              <SelectTrigger id={`${fieldId}-1`}><SelectValue /></SelectTrigger>
              <SelectContent>
                {plans.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {benefitTypeLabel(p.type)} · {p.name} ({p.carrierName})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {medicalAgeHint && (
              <p className="text-xs text-muted-foreground">{medicalAgeHint}</p>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-2`} className="text-xs">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                <SelectTrigger id={`${fieldId}-2`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {status !== "WAIVED" && (
              <div className="space-y-1.5">
                <Label htmlFor={`${fieldId}-3`} className="text-xs">Tier</Label>
                <Select value={tier} onValueChange={(v) => setTier(v as typeof tier)}>
                  <SelectTrigger id={`${fieldId}-3`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIERS.map((t) => <SelectItem key={t} value={t}>{tierLabel(t)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-4`} className="text-xs">Effective date</Label>
              <Input id={`${fieldId}-4`} type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-5`} className="text-xs">Member ID</Label>
              <Input id={`${fieldId}-5`} value={memberId} onChange={(e) => setMemberId(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-6`} className="text-xs">Employee cost override</Label>
              <Input id={`${fieldId}-6`} type="number" step="0.01" min="0" placeholder="Standard tier rate" value={employeeCostOverride} onChange={(e) => setEmployeeCostOverride(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-7`} className="text-xs">Employer cost override</Label>
              <Input id={`${fieldId}-7`} type="number" step="0.01" min="0" placeholder="Standard tier rate" value={employerCostOverride} onChange={(e) => setEmployerCostOverride(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-8`} className="text-xs">Notes (optional)</Label>
            <Textarea id={`${fieldId}-8`} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <InlinePanelFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending || !planId || !effectiveDate}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </InlinePanelFooter>
        </form>
      </InlinePanelContent>
    </InlinePanel>
  );
}

function ChangeTierPanel({ enrollment, plans }: { enrollment: EnrollmentRow; plans: PlanOption[] }) {
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [newTier, setNewTier] = useState<(typeof TIERS)[number]>(enrollment.tier ?? "EMPLOYEE_ONLY");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [memberId, setMemberId] = useState(enrollment.memberId ?? "");
  const plan = plans.find((p) => p.id === enrollment.plan.id);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await runAction(() => changeEnrollmentTier({
        enrollmentId: enrollment.id,
        newTier,
        effectiveDate,
        memberId: memberId || undefined,
      }));
      if (!toastAction(res)) return;
      toast.success("Tier changed — old row ended, new row created");
      setOpen(false);
    });
  }

  return (
    <InlinePanel disabled={pending} open={open} onOpenChange={setOpen}>
      <InlinePanelTrigger asChild>
        <Button size="sm" variant="outline"><Repeat className="mr-1.5 h-3.5 w-3.5" /> Change tier</Button>
      </InlinePanelTrigger>
      <InlinePanelContent>
        <InlinePanelHeader><InlinePanelTitle>Change tier — {enrollment.plan.name}</InlinePanelTitle></InlinePanelHeader>
        <p className="text-xs text-muted-foreground">
          Ends the current row on the new effective date and creates a new row at the new tier — the old
          rate stays on record under Past coverage.
        </p>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-9`} className="text-xs">New tier</Label>
            <Select value={newTier} onValueChange={(v) => setNewTier(v as typeof newTier)}>
              <SelectTrigger id={`${fieldId}-9`}><SelectValue /></SelectTrigger>
              <SelectContent>
                {(plan?.tiers.map((t) => t.tier) ?? TIERS).map((t) => (
                  <SelectItem key={t} value={t}>{tierLabel(t)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-10`} className="text-xs">Effective date</Label>
              <Input id={`${fieldId}-10`} type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-11`} className="text-xs">Member ID</Label>
              <Input id={`${fieldId}-11`} value={memberId} onChange={(e) => setMemberId(e.target.value)} />
            </div>
          </div>
          <InlinePanelFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending || !effectiveDate}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Change tier
            </Button>
          </InlinePanelFooter>
        </form>
      </InlinePanelContent>
    </InlinePanel>
  );
}

function EndEnrollmentPanel({ enrollmentId }: { enrollmentId: string }) {
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await runAction(() => endEnrollment({ enrollmentId, endDate, notes: notes || undefined }));
      if (!toastAction(res)) return;
      toast.success("Enrollment ended");
      setOpen(false);
    });
  }

  return (
    <InlinePanel disabled={pending} open={open} onOpenChange={setOpen}>
      <InlinePanelTrigger asChild>
        <Button size="sm" variant="outline"><Square className="mr-1.5 h-3.5 w-3.5" /> End</Button>
      </InlinePanelTrigger>
      <InlinePanelContent>
        <InlinePanelHeader><InlinePanelTitle>End enrollment</InlinePanelTitle></InlinePanelHeader>
        <p className="text-xs text-muted-foreground">
          For termination, COBRA, or a life event — this system never computes COBRA deadlines; check the
          plan document or carrier for the correct end date (end-of-month vs. date-of-event).
        </p>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-12`} className="text-xs">End date</Label>
            <Input id={`${fieldId}-12`} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-13`} className="text-xs">Notes (optional)</Label>
            <Textarea id={`${fieldId}-13`} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <InlinePanelFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={pending || !endDate}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              End enrollment
            </Button>
          </InlinePanelFooter>
        </form>
      </InlinePanelContent>
    </InlinePanel>
  );
}

function ElectionPanel({ employeeId, plans }: { employeeId: string; plans: PlanOption[] }) {
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("ENROLLED");
  const [mode, setMode] = useState<"percent" | "flat">("percent");
  const [preTaxPercent, setPreTaxPercent] = useState("");
  const [rothPercent, setRothPercent] = useState("");
  const [flatAmountPerPay, setFlatAmountPerPay] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [notes, setNotes] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await runAction(() => upsertRetirementElection({
        employeeId,
        planId,
        status,
        preTaxPercent: mode === "percent" && preTaxPercent ? Number(preTaxPercent) : null,
        rothPercent: mode === "percent" && rothPercent ? Number(rothPercent) : null,
        flatAmountPerPay: mode === "flat" && flatAmountPerPay ? Number(flatAmountPerPay) : null,
        effectiveDate,
        notes: notes || undefined,
      }));
      if (!toastAction(res)) return;
      toast.success("Election saved");
      setOpen(false);
    });
  }

  if (plans.length === 0) return null;

  return (
    <InlinePanel disabled={pending} open={open} onOpenChange={setOpen}>
      <InlinePanelTrigger asChild>
        <Button size="sm" variant="outline"><Plus className="mr-1.5 h-3.5 w-3.5" /> 401(k) election</Button>
      </InlinePanelTrigger>
      <InlinePanelContent>
        <InlinePanelHeader><InlinePanelTitle>New 401(k) election</InlinePanelTitle></InlinePanelHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-14`} className="text-xs">Plan</Label>
            <Select value={planId} onValueChange={setPlanId}>
              <SelectTrigger id={`${fieldId}-14`}><SelectValue /></SelectTrigger>
              <SelectContent>
                {plans.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} ({p.carrierName})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-15`} className="text-xs">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                <SelectTrigger id={`${fieldId}-15`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-16`} className="text-xs">Effective date</Label>
              <Input id={`${fieldId}-16`} type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} required />
            </div>
          </div>
          {status !== "WAIVED" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor={`${fieldId}-17`} className="text-xs">Deferral type</Label>
                <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
                  <SelectTrigger id={`${fieldId}-17`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Percentage of pay</SelectItem>
                    <SelectItem value="flat">Flat amount per paycheck</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {mode === "percent" ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`${fieldId}-18`} className="text-xs">Pre-tax %</Label>
                    <Input id={`${fieldId}-18`} type="number" step="0.01" min="0" max="100" value={preTaxPercent} onChange={(e) => setPreTaxPercent(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${fieldId}-19`} className="text-xs">Roth %</Label>
                    <Input id={`${fieldId}-19`} type="number" step="0.01" min="0" max="100" value={rothPercent} onChange={(e) => setRothPercent(e.target.value)} />
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor={`${fieldId}-20`} className="text-xs">Flat amount per paycheck</Label>
                  <Input id={`${fieldId}-20`} type="number" step="0.01" min="0" value={flatAmountPerPay} onChange={(e) => setFlatAmountPerPay(e.target.value)} />
                </div>
              )}
            </>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-21`} className="text-xs">Notes (optional)</Label>
            <Textarea id={`${fieldId}-21`} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <InlinePanelFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending || !planId || !effectiveDate}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </InlinePanelFooter>
        </form>
      </InlinePanelContent>
    </InlinePanel>
  );
}

function EndElectionPanel({ electionId }: { electionId: string }) {
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [endDate, setEndDate] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await runAction(() => endRetirementElection({ electionId, endDate }));
      if (!toastAction(res)) return;
      toast.success("Election ended");
      setOpen(false);
    });
  }

  return (
    <InlinePanel disabled={pending} open={open} onOpenChange={setOpen}>
      <InlinePanelTrigger asChild>
        <Button size="sm" variant="outline"><Square className="mr-1.5 h-3.5 w-3.5" /> End</Button>
      </InlinePanelTrigger>
      <InlinePanelContent>
        <InlinePanelHeader><InlinePanelTitle>End 401(k) election</InlinePanelTitle></InlinePanelHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-22`} className="text-xs">Stop deferral date</Label>
            <Input id={`${fieldId}-22`} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
          </div>
          <InlinePanelFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={pending || !endDate}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              End election
            </Button>
          </InlinePanelFooter>
        </form>
      </InlinePanelContent>
    </InlinePanel>
  );
}
