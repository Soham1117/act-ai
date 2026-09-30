"use client";

import { useState, useTransition } from "react";
import { Plus, Loader2, Copy, X } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toastAction } from "@/lib/toast-action";
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
      const invite = await createOnboardingInvite({
        email: email.trim() || undefined,
        departmentId: departmentId === NONE ? null : departmentId,
        jobTitle: jobTitle.trim() || null,
        employmentType,
        compensationType,
        compensationValue: parseMoneyInput(compensationValue),
        dateOfHire: dateOfHire || null,
      });
      if (!toastAction(invite)) return;
      const url = `${window.location.origin}/onboard/${invite.token}`;
      setGeneratedUrl(url);
    });
  }

  function copy() {
    if (!generatedUrl) return;
    navigator.clipboard.writeText(generatedUrl);
    toast.success("Link copied");
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
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); else setOpen(true); }}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" /> Generate invite
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate onboarding invite</DialogTitle>
        </DialogHeader>
        {generatedUrl ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Share this link with the new hire. It expires in 7 days and can
              only be used once. After they submit, you&apos;ll approve their account
              on the Employees page.
            </p>
            <div className="flex gap-2">
              <Input value={generatedUrl} readOnly className="font-mono text-xs" />
              <Button type="button" variant="secondary" onClick={copy}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <p className="text-xs text-muted-foreground">
              You set the hire&apos;s position and pay here. The new hire only fills in
              their personal details and can&apos;t change these. Their employee ID is
              generated automatically.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs">Email (optional)</Label>
                <Input
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
                <Label className="text-xs">Department</Label>
                <Select value={departmentId} onValueChange={setDepartmentId}>
                  <SelectTrigger>
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
                <Label className="text-xs">Job title</Label>
                <Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Employment type</Label>
                <Select
                  value={employmentType}
                  onValueChange={(v) => setEmploymentType(v as EmploymentType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FULL_PART_TIME">Full-time / Part-time</SelectItem>
                    <SelectItem value="CONTRACT_HOURLY">Contract / Hourly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Date of hire</Label>
                <Input
                  type="date"
                  value={dateOfHire}
                  onChange={(e) => setDateOfHire(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Compensation type</Label>
                <Select
                  value={compensationType}
                  onValueChange={(v) => setCompensationType(v as CompType)}
                >
                  <SelectTrigger>
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
                <Label className="text-xs">Compensation value ($)</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="60,000"
                  value={compensationValue}
                  onChange={(e) => setCompensationValue(formatMoneyInput(e.target.value))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>Cancel</Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Generate link
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function RowActions({ inviteId, token }: { inviteId: string; token: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex gap-1.5">
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          const url = `${window.location.origin}/onboard/${token}`;
          navigator.clipboard.writeText(url);
          toast.success("Link copied");
        }}
      >
        <Copy className="mr-2 h-3 w-3" /> Copy link
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await revokeOnboardingInvite(inviteId);
            if (!toastAction(res)) return;
            toast.success("Invite revoked");
          })
        }
      >
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
      </Button>
    </div>
  );
}
