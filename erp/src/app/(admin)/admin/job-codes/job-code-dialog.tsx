"use client";

import { useState, useTransition } from "react";
import { Plus, Loader2 } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createJobCode, updateJobCode } from "@/server/actions/job-codes";

type DepartmentOption = { id: string; name: string };

type Existing = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  rate: string;
  isActive: boolean;
  isDefault: boolean;
  departmentId: string | null;
};

type Props = {
  departments: DepartmentOption[];
  existing?: Existing;
  /** Controlled-mode props. If `open` is provided, the dialog is controlled. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

const NONE = "__none__";

export function JobCodeDialog({ departments, existing, open: controlledOpen, onOpenChange }: Props) {
  const editing = Boolean(existing);
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (o: boolean) => {
    if (isControlled) onOpenChange?.(o);
    else setInternalOpen(o);
  };

  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState(existing?.code ?? "");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [rate, setRate] = useState(existing?.rate ?? "NA");
  const [isDefault, setIsDefault] = useState(existing?.isDefault ?? false);
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [departmentId, setDepartmentId] = useState<string>(existing?.departmentId ?? NONE);

  // Note: state is initialised from `existing` once on mount. Parent should
  // remount via `key={existing?.id}` when switching between rows.

  function resetCreate() {
    setCode(""); setTitle(""); setDescription("");
    setRate("NA"); setIsDefault(false); setIsActive(true);
    setDepartmentId(NONE);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const payload = {
          code,
          title,
          description: description || null,
          rate: rate || "NA",
          isActive,
          isDefault,
          departmentId: departmentId === NONE ? null : departmentId,
        };
        if (editing && existing) {
          await updateJobCode(existing.id, payload);
          toast.success(`Updated ${code.toUpperCase()}`);
        } else {
          await createJobCode(payload);
          toast.success(`Created ${code.toUpperCase()}`);
          resetCreate();
        }
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <DialogTrigger asChild>
          <Button>
            <Plus className="mr-2 h-4 w-4" /> New job code
          </Button>
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit job code" : "New job code"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Code</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ACT001" maxLength={20} required className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Rate</Label>
              <Input value={rate} onChange={(e) => setRate(e.target.value)} placeholder="$22.00 / NA" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Department (optional)</Label>
            <Select value={departmentId} onValueChange={setDepartmentId}>
              <SelectTrigger>
                <SelectValue placeholder="No department" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No department</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label className="text-sm">Default code</Label>
              <p className="text-xs text-muted-foreground">Used as fallback when no other code applies.</p>
            </div>
            <Switch checked={isDefault} onCheckedChange={setIsDefault} />
          </div>
          {editing && (
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label className="text-sm">Active</Label>
                <p className="text-xs text-muted-foreground">Inactive codes are hidden from new assignments.</p>
              </div>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending || code.length < 2 || title.length < 2}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
