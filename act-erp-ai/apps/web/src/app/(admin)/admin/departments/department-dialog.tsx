"use client";

import { useId, useState, useTransition } from "react";
import { Plus, Loader2 } from "lucide-react";
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
import { runAction, toastAction } from "@/lib/toast-action";
import { createDepartment, updateDepartment } from "@/server/actions/departments";

export type DepartmentFormValues = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
};

/**
 * Create inline form (with its own "New department" button) or, when `existing` is
 * given, a controlled edit form for that department.
 */
export function DepartmentForm({
  existing,
  open: controlledOpen,
  onOpenChange,
}: {
  existing?: DepartmentFormValues;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  const formId = useId();
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlledOpen ?? innerOpen;
  const setOpen = (v: boolean) => {
    setInnerOpen(v);
    onOpenChange?.(v);
  };
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(existing?.name ?? "");
  const [code, setCode] = useState(existing?.code ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const input = { name, code: code || null, description: description || null };
      if (existing) {
        const res = await runAction(() => updateDepartment(existing.id, input));
        if (!toastAction(res)) return;
        toast.success(`Saved ${name.trim()}`);
        setOpen(false);
        return;
      }
      const res = await runAction(() => createDepartment(input));
      if (!toastAction(res)) return;
      toast.success(`Created ${name}`);
      setOpen(false);
      setName("");
      setCode("");
      setDescription("");
    });
  }

  return (
    <InlinePanel disabled={pending} open={open} onOpenChange={(nextOpen) => { if (!pending) setOpen(nextOpen); }}>
      {!existing && (
        <InlinePanelTrigger asChild disabled={pending}>
          <Button>
            <Plus className="mr-2 h-4 w-4" /> New department
          </Button>
        </InlinePanelTrigger>
      )}
      <InlinePanelContent>
        <InlinePanelHeader>
          <InlinePanelTitle>
            {existing ? "Edit department" : "New department"}
          </InlinePanelTitle>
        </InlinePanelHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-name`} className="text-xs">
              Name
            </Label>
            <Input
              id={`${formId}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-code`} className="text-xs">
              Short code (optional)
            </Label>
            <Input
              id={`${formId}-code`}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={8}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-description`} className="text-xs">
              Description
            </Label>
            <Textarea
              id={`${formId}-description`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <InlinePanelFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || name.length < 2}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {existing ? "Save" : "Create"}
            </Button>
          </InlinePanelFooter>
        </form>
      </InlinePanelContent>
    </InlinePanel>
  );
}
