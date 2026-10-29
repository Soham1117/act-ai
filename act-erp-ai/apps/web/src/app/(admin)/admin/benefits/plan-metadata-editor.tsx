"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { runAction, toastAction } from "@/lib/toast-action";
import { saveBenefitPlanMetadata } from "@/server/actions/benefit-eligibility";

type Metadata = {
  id: string;
  type: string;
  planCode: string | null;
  planDesignation: string | null;
  resourceVersionId: string | null;
  updatedAt: string;
};

export function PlanMetadataEditor({
  plan,
  resources,
}: {
  plan: Metadata;
  resources: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [code, setCode] = useState(plan.planCode ?? "");
  const [designation, setDesignation] = useState(plan.planDesignation ?? "");
  const [resource, setResource] = useState(plan.resourceVersionId ?? "");
  function submit(event: FormEvent) {
    event.preventDefault();
    start(async () => {
      const result = await runAction(() =>
        saveBenefitPlanMetadata({
          id: plan.id,
          planCode: code || undefined,
          planDesignation: designation ? (designation as "BASE" | "BUY_UP") : undefined,
          resourceVersionId: resource || undefined,
          expectedUpdatedAt: plan.updatedAt,
        }),
      );
      if (!toastAction(result)) return;
      toast.success("Plan information saved; coverage and prices unchanged");
      setOpen(false);
      router.refresh();
    });
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Plan information
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Plan code and documents</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor={`plan-code-${plan.id}`}>Plan code</Label>
            <Input
              id={`plan-code-${plan.id}`}
              value={code}
              maxLength={60}
              onChange={(e) => setCode(e.target.value)}
              placeholder="For example S9J7ADT"
            />
          </div>
          {plan.type === "MEDICAL" && (
            <div className="space-y-1">
              <Label htmlFor={`plan-designation-${plan.id}`}>
                Medical plan designation
              </Label>
              <select
                id={`plan-designation-${plan.id}`}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
              >
                <option value="">Not specified</option>
                <option value="BASE">Base plan</option>
                <option value="BUY_UP">Buy-up plan</option>
              </select>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor={`plan-resource-${plan.id}`}>Approved benefits resource</Label>
            <select
              id={`plan-resource-${plan.id}`}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={resource}
              onChange={(e) => setResource(e.target.value)}
            >
              <option value="">No linked resource</option>
              {resources.map((r) => (
                <option value={r.id} key={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Only HR-approved benefits documents appear. Linking a file does not send it
              to employees or replace the existing consent-aware document delivery.
            </p>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save information"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
