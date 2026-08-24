"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, Repeat, Square } from "lucide-react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  upsertEnrollment,
  changeEnrollmentTier,
  endEnrollment,
  upsertRetirementElection,
  endRetirementElection,
} from "@/server/actions/benefits";
import { benefitTypeLabel, tierLabel, coverageState, utcToday } from "@/lib/benefits";
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
}: {
  employeeId: string;
  plans: PlanOption[];
  enrollments: EnrollmentRow[];
  elections: ElectionRow[];
}) {
  const healthPlans = plans.filter((p) => p.type !== "RETIREMENT_401K");
  const retirementPlans = plans.filter((p) => p.type === "RETIREMENT_401K");
  const today = utcToday();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Benefits</CardTitle>
        <div className="flex gap-2">
          <EnrollDialog employeeId={employeeId} plans={healthPlans} />
          <ElectionDialog employeeId={employeeId} plans={retirementPlans} />
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
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
                    <div className="flex items-center gap-2">
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
                    <div className="flex gap-1.5">
                      {e.status === "ENROLLED" && e.tier && (
                        <ChangeTierDialog enrollment={e} plans={healthPlans} />
                      )}
                      <EndEnrollmentDialog enrollmentId={e.id} />
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
                    <div className="flex items-center gap-2">
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
                    <div className="flex gap-1.5">
                      <EndElectionDialog electionId={el.id} />
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

function StateBadge({ state }: { state: string }) {
  const variant =
    state === "current" ? "success" : state === "waived" ? "secondary" : state === "pending" ? "warning" : "destructive";
  return <Badge variant={variant} className="text-[10px]">{state}</Badge>;
}

function EnrollDialog({ employeeId, plans }: { employeeId: string; plans: PlanOption[] }) {
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

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await upsertEnrollment({
          employeeId,
          planId,
          tier: status === "WAIVED" ? null : (tier || null),
          status,
          effectiveDate,
          memberId: memberId || undefined,
          employeeCostOverride: employeeCostOverride ? Number(employeeCostOverride) : null,
          employerCostOverride: employerCostOverride ? Number(employerCostOverride) : null,
          notes: notes || undefined,
        });
        toast.success("Enrollment saved");
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed");
      }
    });
  }

  if (plans.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Plus className="mr-1.5 h-3.5 w-3.5" /> Enroll</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New enrollment</DialogTitle></DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Plan</Label>
            <Select value={planId} onValueChange={setPlanId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {plans.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {benefitTypeLabel(p.type)} · {p.name} ({p.carrierName})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {status !== "WAIVED" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Tier</Label>
                <Select value={tier} onValueChange={(v) => setTier(v as typeof tier)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIERS.map((t) => <SelectItem key={t} value={t}>{tierLabel(t)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Effective date</Label>
              <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Member ID</Label>
              <Input value={memberId} onChange={(e) => setMemberId(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Employee cost override</Label>
              <Input type="number" step="0.01" min="0" placeholder="Standard tier rate" value={employeeCostOverride} onChange={(e) => setEmployeeCostOverride(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Employer cost override</Label>
              <Input type="number" step="0.01" min="0" placeholder="Standard tier rate" value={employerCostOverride} onChange={(e) => setEmployerCostOverride(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending || !planId || !effectiveDate}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ChangeTierDialog({ enrollment, plans }: { enrollment: EnrollmentRow; plans: PlanOption[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [newTier, setNewTier] = useState<(typeof TIERS)[number]>(enrollment.tier ?? "EMPLOYEE_ONLY");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [memberId, setMemberId] = useState(enrollment.memberId ?? "");
  const plan = plans.find((p) => p.id === enrollment.plan.id);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await changeEnrollmentTier({
          enrollmentId: enrollment.id,
          newTier,
          effectiveDate,
          memberId: memberId || undefined,
        });
        toast.success("Tier changed — old row ended, new row created");
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Repeat className="mr-1.5 h-3.5 w-3.5" /> Change tier</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Change tier — {enrollment.plan.name}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">
          Ends the current row on the new effective date and creates a new row at the new tier — the old
          rate stays on record under Past coverage.
        </p>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">New tier</Label>
            <Select value={newTier} onValueChange={(v) => setNewTier(v as typeof newTier)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(plan?.tiers.map((t) => t.tier) ?? TIERS).map((t) => (
                  <SelectItem key={t} value={t}>{tierLabel(t)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Effective date</Label>
              <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Member ID</Label>
              <Input value={memberId} onChange={(e) => setMemberId(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending || !effectiveDate}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Change tier
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EndEnrollmentDialog({ enrollmentId }: { enrollmentId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await endEnrollment({ enrollmentId, endDate, notes: notes || undefined });
        toast.success("Enrollment ended");
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Square className="mr-1.5 h-3.5 w-3.5" /> End</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>End enrollment</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">
          For termination, COBRA, or a life event — this system never computes COBRA deadlines; check the
          plan document or carrier for the correct end date (end-of-month vs. date-of-event).
        </p>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">End date</Label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={pending || !endDate}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              End enrollment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ElectionDialog({ employeeId, plans }: { employeeId: string; plans: PlanOption[] }) {
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
      try {
        await upsertRetirementElection({
          employeeId,
          planId,
          status,
          preTaxPercent: mode === "percent" && preTaxPercent ? Number(preTaxPercent) : null,
          rothPercent: mode === "percent" && rothPercent ? Number(rothPercent) : null,
          flatAmountPerPay: mode === "flat" && flatAmountPerPay ? Number(flatAmountPerPay) : null,
          effectiveDate,
          notes: notes || undefined,
        });
        toast.success("Election saved");
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed");
      }
    });
  }

  if (plans.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Plus className="mr-1.5 h-3.5 w-3.5" /> 401(k) election</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New 401(k) election</DialogTitle></DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Plan</Label>
            <Select value={planId} onValueChange={setPlanId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {plans.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} ({p.carrierName})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Effective date</Label>
              <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} required />
            </div>
          </div>
          {status !== "WAIVED" && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Deferral type</Label>
                <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Percentage of pay</SelectItem>
                    <SelectItem value="flat">Flat amount per paycheck</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {mode === "percent" ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Pre-tax %</Label>
                    <Input type="number" step="0.01" min="0" max="100" value={preTaxPercent} onChange={(e) => setPreTaxPercent(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Roth %</Label>
                    <Input type="number" step="0.01" min="0" max="100" value={rothPercent} onChange={(e) => setRothPercent(e.target.value)} />
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label className="text-xs">Flat amount per paycheck</Label>
                  <Input type="number" step="0.01" min="0" value={flatAmountPerPay} onChange={(e) => setFlatAmountPerPay(e.target.value)} />
                </div>
              )}
            </>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending || !planId || !effectiveDate}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EndElectionDialog({ electionId }: { electionId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [endDate, setEndDate] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await endRetirementElection({ electionId, endDate });
        toast.success("Election ended");
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Square className="mr-1.5 h-3.5 w-3.5" /> End</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>End 401(k) election</DialogTitle></DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Stop deferral date</Label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={pending || !endDate}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              End election
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
