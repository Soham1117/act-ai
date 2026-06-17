"use client";

import { useState, useTransition } from "react";
import { Pencil, UserPlus, Loader2, X } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { JobCodeDialog } from "../job-code-dialog";
import { assignJobCode, unassignJobCode } from "@/server/actions/job-codes";

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

type Employee = { id: string; employeeId: string; name: string; email: string };

export function JobCodeDetailActions({
  jobCode,
  departments,
  assignableEmployees,
}: {
  jobCode: Existing;
  departments: Array<{ id: string; name: string }>;
  assignableEmployees: Employee[];
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [employeeId, setEmployeeId] = useState("");
  const [rate, setRate] = useState(jobCode.rate);
  const [isPrimary, setIsPrimary] = useState(false);

  function onAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId) return;
    startTransition(async () => {
      try {
        await assignJobCode(jobCode.id, employeeId, isPrimary, rate || "NA");
        toast.success("Assigned");
        setAssignOpen(false);
        setEmployeeId(""); setRate(jobCode.rate); setIsPrimary(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed");
      }
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
        <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
      </Button>

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogTrigger asChild>
          <Button size="sm" disabled={assignableEmployees.length === 0}>
            <UserPlus className="mr-2 h-3.5 w-3.5" /> Assign employee
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign employee to {jobCode.code}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onAssign} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Employee</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an employee" />
                </SelectTrigger>
                <SelectContent>
                  {assignableEmployees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name} <span className="text-xs text-muted-foreground">· {e.employeeId}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Assigned rate</Label>
              <Input value={rate} onChange={(e) => setRate(e.target.value)} placeholder="$22.00 / NA" />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label className="text-sm">Set as primary</Label>
                <p className="text-xs text-muted-foreground">
                  This becomes the employee&apos;s primary code.
                </p>
              </div>
              <Switch checked={isPrimary} onCheckedChange={setIsPrimary} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAssignOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !employeeId}>
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Assign
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <JobCodeDialog
        departments={departments}
        existing={jobCode}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </div>
  );
}

export function UnassignButton({ jobCodeId, employeeId }: { jobCodeId: string; employeeId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            await unassignJobCode(jobCodeId, employeeId);
            toast.success("Unassigned");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed");
          }
        })
      }
    >
      <X className="h-3.5 w-3.5" />
    </Button>
  );
}
