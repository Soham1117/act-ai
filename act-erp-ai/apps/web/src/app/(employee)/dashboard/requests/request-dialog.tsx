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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { submitRequest } from "@/server/actions/requests";
import { toastAction } from "@/lib/toast-action";

const TYPES = [
  "DOCUMENT_REQUEST", "DETAILS_CHANGE", "PAYROLL_INQUIRY", "SCHEDULE_CHANGE",
  "ACCESS_REQUEST", "TRAINING_REQUEST", "EQUIPMENT_REQUEST", "LOCATION_CHANGE",
  "TEAM_REQUEST", "PROJECT_REQUEST", "LEAVE_REQUEST", "BENEFITS_INQUIRY", "OTHER",
] as const;

export function RequestDialog({
  initialType,
}: {
  /** Pre-selects the type and opens the dialog on mount — used by the
   * "Something look wrong?" link from the Benefits page. */
  initialType?: (typeof TYPES)[number];
}) {
  // Both initialized straight from the prop — it's only ever set once, from
  // the searchParams-derived value the server passed in on this page load,
  // so there's no need for an effect to sync it after mount.
  const [open, setOpen] = useState(!!initialType);
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState<(typeof TYPES)[number]>(initialType ?? "DOCUMENT_REQUEST");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await submitRequest({ type, title, description });
      if (!toastAction(res)) return;
      toast.success("Request submitted");
      setOpen(false);
      setTitle(""); setDescription("");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="mr-2 h-4 w-4" /> New request</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New request</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as (typeof TYPES)[number])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Subject</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Details</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} required />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending || title.length < 2 || description.length < 2}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
