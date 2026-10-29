"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { benefitTypeLabel } from "@/lib/benefits";
import {
  ELIGIBILITY_TYPES,
  eligibilityStateLabel,
  type EligibilityClassification,
  type EligibilityType,
} from "@/lib/benefit-eligibility";
import { formatDateOnly } from "@/lib/format";
import { runAction, toastAction } from "@/lib/toast-action";
import {
  saveBenefitEligibilityAssessment,
  saveBenefitEligibilityPolicy,
  endBenefitEligibilityPolicy,
} from "@/server/actions/benefit-eligibility";
import type { adminBenefitEligibilityData } from "@/server/queries/benefit-eligibility";

type Data = Awaited<ReturnType<typeof adminBenefitEligibilityData>>;
const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

export function EligibilityWorkspace({ data }: { data: Data }) {
  const [filter, setFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [limit, setLimit] = useState(50);
  const nextWeek = new Date(`${data.today}T00:00:00Z`);
  nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
  const end = nextWeek.toISOString().slice(0, 10);
  const query = search.trim().toLowerCase();
  const visible = data.rows.filter(
    (row) =>
      (!filter || row.benefitType === filter) &&
      (!stateFilter || row.state === stateFilter) &&
      (!query ||
        row.employeeName.toLowerCase().includes(query) ||
        row.employeeCode.toLowerCase().includes(query)),
  );
  const displayed = visible.slice(0, limit);
  const upcoming = visible.filter(
    (row) =>
      row.proposedDate &&
      row.proposedDate >= data.today &&
      row.proposedDate <= end &&
      row.state !== "REVIEW_REQUIRED",
  );
  return (
    <div className="space-y-8">
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <PolicyForm data={data} />
        <AssessmentForm data={data} />
      </div>
      <section className="space-y-3" aria-labelledby="policy-history-heading">
        <h2 id="policy-history-heading" className="text-lg font-semibold">
          Policy versions
        </h2>
        <p className="text-sm text-muted-foreground">
          Dental and all other rules start unconfirmed. Confirm only after checking the
          applicable plan and boundary convention. Dates are exclusive at the end.
        </p>
        {data.policies.length === 0 && (
          <p className="rounded-md border p-4 text-sm text-muted-foreground">
            No policy versions yet. Proposed dates stay in HR review until a policy is
            confirmed.
          </p>
        )}
        <div className="space-y-3">
          {data.policies.map((policy) => (
            <PolicyRow key={policy.id} policy={policy} />
          ))}
        </div>
      </section>
      <section className="space-y-3" aria-labelledby="eligibility-list-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="eligibility-list-heading" className="text-lg font-semibold">
              Upcoming and review list
            </h2>
            <p className="text-sm text-muted-foreground">
              {upcoming.length} proposed entry dates in the next seven days (
              {formatDateOnly(data.today)}–{formatDateOnly(end)}).
            </p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="eligibility-employee-search">Employee name or ID</Label>
            <Input
              id="eligibility-employee-search"
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setLimit(50);
              }}
              placeholder="Search employees"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="eligibility-benefit-filter">Benefit</Label>
            <select
              id="eligibility-benefit-filter"
              className={selectClass}
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setLimit(50);
              }}
            >
              <option value="">All benefits</option>
              {ELIGIBILITY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {benefitTypeLabel(type)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="eligibility-state-filter">Review state</Label>
            <select
              id="eligibility-state-filter"
              className={selectClass}
              value={stateFilter}
              onChange={(e) => {
                setStateFilter(e.target.value);
                setLimit(50);
              }}
            >
              <option value="">All states</option>
              {Object.entries(eligibilityStateLabel).map(([state, label]) => (
                <option key={state} value={state}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p role="status" className="text-sm text-muted-foreground">
          Showing {displayed.length} of {visible.length} matching records.
        </p>
        <div className="max-h-[36rem] overflow-auto rounded-md border">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-3">Employee</th>
                <th className="p-3">Benefit</th>
                <th className="p-3">Status</th>
                <th className="p-3">Proposed date</th>
                <th className="p-3">Review</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((row) => (
                <tr
                  key={`${row.employeeId}-${row.benefitType}`}
                  data-employee-id={row.employeeId}
                  data-benefit-type={row.benefitType}
                  className="border-b last:border-0"
                >
                  <td className="p-3 font-medium">
                    {row.employeeName}
                    <div className="font-mono text-xs font-normal text-muted-foreground">
                      {row.employeeCode}
                    </div>
                  </td>
                  <td className="p-3">{benefitTypeLabel(row.benefitType)}</td>
                  <td className="p-3">{eligibilityStateLabel[row.state]}</td>
                  <td className="whitespace-nowrap p-3">
                    {row.proposedDate ? formatDateOnly(row.proposedDate) : "—"}
                  </td>
                  <td className="max-w-sm p-3 text-xs text-muted-foreground">
                    {row.reason}
                  </td>
                </tr>
              ))}
              {displayed.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-muted-foreground">
                    No employees match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {displayed.length < visible.length && (
          <Button
            variant="outline"
            type="button"
            onClick={() => setLimit((current) => current + 50)}
          >
            Show 50 more records
          </Button>
        )}
      </section>
    </div>
  );
}

function PolicyForm({ data }: { data: Data }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [type, setType] = useState<EligibilityType>("MEDICAL");
  const [from, setFrom] = useState(data.today);
  const [to, setTo] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const draft = data.policies.find(
    (p) => p.benefitType === type && p.effectiveFrom === from,
  );
  function submit(event: FormEvent) {
    event.preventDefault();
    start(async () => {
      const result = await runAction(() =>
        saveBenefitEligibilityPolicy({
          benefitType: type,
          effectiveFrom: from,
          effectiveTo: to || undefined,
          confirmed,
          reason,
          expectedUpdatedAt: draft?.updatedAt,
        }),
      );
      if (!toastAction(result)) return;
      toast.success("Policy version saved");
      setReason("");
      setConfirmed(false);
      router.refresh();
    });
  }
  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border p-4">
      <h2 className="font-semibold">Add or confirm a policy version</h2>
      <div className="space-y-1">
        <Label htmlFor="policy-benefit">Benefit</Label>
        <select
          id="policy-benefit"
          className={selectClass}
          value={type}
          onChange={(e) => setType(e.target.value as EligibilityType)}
        >
          {ELIGIBILITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {benefitTypeLabel(t)}
            </option>
          ))}
        </select>
      </div>
      <p className="text-sm text-muted-foreground">
        {type === "RETIREMENT_401K"
          ? "One year of confirmed service, then April 1 or October 1. Boundary anniversaries require individual HR review."
          : "First of the month after 60 calendar days. A milestone on the first requires individual HR review."}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="policy-from">Effective from</Label>
          <Input
            id="policy-from"
            type="date"
            required
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="policy-to">End date (optional)</Label>
          <Input
            id="policy-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-1"
        />
        I checked the current plan terms, eligible groups and boundary convention.
      </label>
      <div className="space-y-1">
        <Label htmlFor="policy-reason">Source or reason</Label>
        <Textarea
          id="policy-reason"
          required
          minLength={3}
          maxLength={1000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Plan version or HR decision; no sensitive identifiers"
        />
      </div>
      <Button disabled={pending || !!draft?.confirmed} type="submit">
        {pending ? "Saving…" : "Save policy version"}
      </Button>
      {draft?.confirmed && (
        <p className="text-xs text-muted-foreground">
          This date has a confirmed policy. End it and use a new effective date to replace
          it.
        </p>
      )}
    </form>
  );
}

function AssessmentForm({ data }: { data: Data }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [employeeId, setEmployeeId] = useState(data.employees[0]?.id ?? "");
  const [type, setType] = useState<EligibilityType>("MEDICAL");
  const initial = data.assessments.find(
    (assessment) =>
      assessment.employeeId === data.employees[0]?.id &&
      assessment.benefitType === "MEDICAL",
  );
  const [classification, setClassification] = useState<EligibilityClassification>(
    (initial?.classification ?? "REVIEW_REQUIRED") as EligibilityClassification,
  );
  const [serviceDate, setServiceDate] = useState(initial?.serviceDate ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const existing = data.assessments.find(
    (a) => a.employeeId === employeeId && a.benefitType === type,
  );
  const employee = data.employees.find((e) => e.id === employeeId);
  function select(employeeValue: string, benefitValue: EligibilityType) {
    const record = data.assessments.find(
      (a) => a.employeeId === employeeValue && a.benefitType === benefitValue,
    );
    setEmployeeId(employeeValue);
    setType(benefitValue);
    setClassification(
      (record?.classification ?? "REVIEW_REQUIRED") as EligibilityClassification,
    );
    setServiceDate(record?.serviceDate ?? "");
    setNotes(record?.notes ?? "");
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    start(async () => {
      const result = await runAction(() =>
        saveBenefitEligibilityAssessment({
          employeeId,
          benefitType: type,
          classification,
          serviceDate: serviceDate || undefined,
          notes,
          expectedUpdatedAt: existing?.updatedAt,
        }),
      );
      if (!toastAction(result)) return;
      toast.success("HR assessment saved; enrollments unchanged");
      router.refresh();
    });
  }
  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border p-4">
      <h2 className="font-semibold">Review employee eligibility</h2>
      <p className="text-sm text-muted-foreground">
        Confirm the eligible group and service credit, including any rehire or leave
        rules. This never enrolls the employee.
      </p>
      <div className="space-y-1">
        <Label htmlFor="assessment-employee">Employee</Label>
        <select
          id="assessment-employee"
          className={selectClass}
          value={employeeId}
          onChange={(e) => select(e.target.value, type)}
        >
          {data.employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} · {e.employeeId}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="assessment-benefit">Benefit</Label>
          <select
            id="assessment-benefit"
            className={selectClass}
            value={type}
            onChange={(e) => select(employeeId, e.target.value as EligibilityType)}
          >
            {ELIGIBILITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {benefitTypeLabel(t)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="assessment-class">Classification</Label>
          <select
            id="assessment-class"
            className={selectClass}
            value={classification}
            onChange={(e) =>
              setClassification(e.target.value as EligibilityClassification)
            }
          >
            <option value="REVIEW_REQUIRED">Needs review</option>
            <option value="ELIGIBLE">Eligible group confirmed</option>
            <option value="INELIGIBLE">Outside eligible group</option>
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="assessment-service">Credited service date</Label>
        <Input
          id="assessment-service"
          type="date"
          value={serviceDate}
          onChange={(e) => setServiceDate(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Leave blank to confirm hire date:{" "}
          {employee?.dateOfHire ? formatDateOnly(employee.dateOfHire) : "not recorded"}.
        </p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="assessment-notes">HR decision and service-date reason</Label>
        <Textarea
          id="assessment-notes"
          required
          minLength={3}
          maxLength={1000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Service evidence or exception review; no SSNs or health details"
        />
      </div>
      <Button type="submit" disabled={pending || !employeeId}>
        {pending ? "Saving…" : "Save HR assessment"}
      </Button>
    </form>
  );
}

function PolicyRow({ policy }: { policy: Data["policies"][number] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    start(async () => {
      const result = await runAction(() =>
        endBenefitEligibilityPolicy({
          id: policy.id,
          effectiveTo: end,
          expectedUpdatedAt: policy.updatedAt,
          reason,
        }),
      );
      if (toastAction(result)) {
        toast.success("Policy end recorded");
        router.refresh();
      }
    });
  }
  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="text-sm">
        <span className="font-medium">{benefitTypeLabel(policy.benefitType)}</span> ·{" "}
        {policy.confirmed ? "Confirmed" : "Draft"} ·{" "}
        {formatDateOnly(policy.effectiveFrom)} to{" "}
        {policy.effectiveTo ? formatDateOnly(policy.effectiveTo) : "open"}
      </p>
      {!policy.effectiveTo && (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor={`policy-end-${policy.id}`}>End date</Label>
            <Input
              id={`policy-end-${policy.id}`}
              type="date"
              required
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
          <div className="min-w-48 flex-1 space-y-1">
            <Label htmlFor={`policy-end-reason-${policy.id}`}>Reason</Label>
            <Input
              id={`policy-end-reason-${policy.id}`}
              required
              minLength={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? "Saving…" : "End version"}
          </Button>
        </form>
      )}
    </div>
  );
}
