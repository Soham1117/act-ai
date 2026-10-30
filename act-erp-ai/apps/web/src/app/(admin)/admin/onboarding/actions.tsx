"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { Plus, Loader2, X } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CopyButton } from "@/components/interior/copy-button";
import { runAction, toastAction } from "@/lib/toast-action";
import { formatMoneyInput, parseMoneyInput } from "@/lib/format";
import {
  createOnboardingInvite,
  revokeOnboardingInvite,
} from "@/server/actions/onboarding";

const NONE = "__none__";

type EmploymentType = "FULL_PART_TIME" | "CONTRACT_HOURLY";
type CompType = "MONTHLY_SALARY" | "HOURLY_RATE" | "TOTAL_COMPENSATION";

export function OnboardingActions({
  departments,
}: {
  departments: { id: string; name: string }[];
}) {
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [departmentId, setDepartmentId] = useState(NONE);
  const [jobTitle, setJobTitle] = useState("");
  const [employmentType, setEmploymentType] = useState<EmploymentType>("FULL_PART_TIME");
  const [compensationType, setCompensationType] = useState<CompType>("HOURLY_RATE");
  const [compensationValue, setCompensationValue] = useState("");
  const [dateOfHire, setDateOfHire] = useState("");
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const invite = await runAction(() =>
        createOnboardingInvite({
          email: email.trim() || undefined,
          departmentId: departmentId === NONE ? null : departmentId,
          jobTitle: jobTitle.trim() || null,
          employmentType,
          compensationType,
          compensationValue: parseMoneyInput(compensationValue),
          dateOfHire: dateOfHire || null,
        }),
      );
      if (!toastAction(invite)) return;
      const url = `${window.location.origin}/onboard/${invite.token}`;
      setGeneratedUrl(url);
    });
  }

  function close() {
    setOpen(false);
    setEmail("");
    setDepartmentId(NONE);
    setJobTitle("");
    setEmploymentType("FULL_PART_TIME");
    setCompensationType("HOURLY_RATE");
    setCompensationValue("");
    setDateOfHire("");
    setGeneratedUrl(null);
  }

  return (
    <InlinePanel
      open={open}
      onOpenChange={(o) => {
        if (!o) close();
        else setOpen(true);
      }}
    >
      <InlinePanelTrigger asChild disabled={pending}>
        <Button>
          <Plus className="mr-2 h-4 w-4" /> Generate invite
        </Button>
      </InlinePanelTrigger>
      <InlinePanelContent>
        <InlinePanelHeader>
          <InlinePanelTitle>Generate onboarding invite</InlinePanelTitle>
        </InlinePanelHeader>
        {generatedUrl ? (
          <div className="min-w-0 space-y-3">
            <p className="text-sm text-muted-foreground">
              Share this link with the new hire. It expires in 7 days and can only be used
              once. After they submit, you&apos;ll approve their account on the Employees
              page.
            </p>
            <div className="flex min-w-0 flex-wrap gap-2">
              <Input
                value={generatedUrl}
                readOnly
                aria-label="Generated onboarding invite link"
                className="min-w-0 font-mono text-base md:text-xs"
              />
              <CopyButton
                value={generatedUrl}
                label="Copy"
                copiedLabel="Copied"
                onCopy={() => toast.success("Link copied")}
                onError={() => toast.error("Copy failed")}
              />
            </div>
            <InlinePanelFooter>
              <Button onClick={close}>Done</Button>
            </InlinePanelFooter>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="min-w-0 space-y-3">
            <p className="text-xs text-muted-foreground">
              You set the hire&apos;s position and pay here. The new hire only fills in
              their personal details and can&apos;t change these. Their employee ID is
              generated automatically.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor={`${formId}-field-0`} className="text-xs">
                  Email (optional)
                </Label>
                <Input
                  id={`${formId}-field-0`}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="newhire@actools.com"
                />
                <p className="text-[10px] text-muted-foreground">
                  Pre-fills their work email on the form. They can change or clear it.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-field-1`} className="text-xs">
                  Department
                </Label>
                <Select value={departmentId} onValueChange={setDepartmentId}>
                  <SelectTrigger id={`${formId}-field-1`}>
                    <SelectValue placeholder="(none)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>(none)</SelectItem>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-field-2`} className="text-xs">
                  Job title
                </Label>
                <Input
                  id={`${formId}-field-2`}
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-field-3`} className="text-xs">
                  Employment type
                </Label>
                <Select
                  value={employmentType}
                  onValueChange={(v) => setEmploymentType(v as EmploymentType)}
                >
                  <SelectTrigger id={`${formId}-field-3`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FULL_PART_TIME">Full-time / Part-time</SelectItem>
                    <SelectItem value="CONTRACT_HOURLY">Contract / Hourly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-field-4`} className="text-xs">
                  Date of hire
                </Label>
                <Input
                  id={`${formId}-field-4`}
                  type="date"
                  value={dateOfHire}
                  onChange={(e) => setDateOfHire(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-field-5`} className="text-xs">
                  Compensation type
                </Label>
                <Select
                  value={compensationType}
                  onValueChange={(v) => setCompensationType(v as CompType)}
                >
                  <SelectTrigger id={`${formId}-field-5`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HOURLY_RATE">Hourly rate</SelectItem>
                    <SelectItem value="MONTHLY_SALARY">Monthly salary</SelectItem>
                    <SelectItem value="TOTAL_COMPENSATION">Total compensation</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-field-6`} className="text-xs">
                  Compensation value ($)
                </Label>
                <Input
                  id={`${formId}-field-6`}
                  type="text"
                  inputMode="decimal"
                  placeholder="60,000"
                  value={compensationValue}
                  onChange={(e) => setCompensationValue(formatMoneyInput(e.target.value))}
                />
              </div>
            </div>
            <InlinePanelFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Generate link
              </Button>
            </InlinePanelFooter>
          </form>
        )}
      </InlinePanelContent>
    </InlinePanel>
  );
}

export function RowActions({ inviteId, token }: { inviteId: string; token: string }) {
  const [pending, startTransition] = useTransition();
  const [inviteUrl, setInviteUrl] = useState(`/onboard/${token}`);
  useEffect(() => {
    setInviteUrl(`${window.location.origin}/onboard/${token}`);
  }, [token]);

  return (
    <div className="flex min-w-0 max-w-sm flex-wrap justify-end gap-1.5 [&_button]:min-h-11">
      <CopyButton
        value={inviteUrl}
        label="Copy link"
        copiedLabel="Copied"
        onCopy={() => toast.success("Link copied")}
        onError={() => toast.error("Copy failed")}
        className="h-11 md:h-9"
      />
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        aria-label="Revoke onboarding invite"
        onClick={() =>
          startTransition(async () => {
            const res = await runAction(() => revokeOnboardingInvite(inviteId));
            if (!toastAction(res)) return;
            toast.success("Invite revoked");
          })
        }
      >
        {pending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <X className="h-3 w-3" />
        )}
      </Button>
    </div>
  );
}
