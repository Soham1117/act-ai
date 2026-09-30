"use client";

import { useState, useTransition } from "react";
import { Plus, Loader2, Paperclip, X } from "lucide-react";
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
import { submitReimbursement } from "@/server/actions/reimbursements";
import { toastAction } from "@/lib/toast-action";
import { MAX_RECEIPTS, MAX_REIMBURSEMENT_AMOUNT } from "@/lib/reimbursement";

const RECEIPT_MAX_BYTES = 8 * 1024 * 1024;
const RECEIPT_EXTS = ["pdf", "png", "jpg", "jpeg"];

const CATEGORIES = [
  "TRAVEL", "MEALS", "OFFICE_SUPPLIES", "TRAINING", "EQUIPMENT",
  "MEDICAL", "FUEL", "ACCOMMODATION", "OTHER",
] as const;

export function ReimbursementDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("TRAVEL");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const today = new Date().toISOString().slice(0, 10);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      if (!RECEIPT_EXTS.includes(ext)) {
        toast.error(`${f.name}: receipts must be PDF, PNG or JPG.`);
        continue;
      }
      if (f.size > RECEIPT_MAX_BYTES) {
        toast.error(`${f.name} is larger than 8 MB.`);
        continue;
      }
      if (next.length >= MAX_RECEIPTS) {
        toast.error(`You can attach up to ${MAX_RECEIPTS} receipts.`);
        break;
      }
      next.push(f);
    }
    setFiles(next);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!(amt > 0)) {
      toast.error("Enter an amount greater than $0.00.");
      return;
    }
    if (amt > MAX_REIMBURSEMENT_AMOUNT) {
      toast.error(`Claims over $${MAX_REIMBURSEMENT_AMOUNT.toLocaleString("en-US")} need to go through HR.`);
      return;
    }
    startTransition(async () => {
      const receipts = await Promise.all(
        files.map(async (f) => ({
          name: f.name,
          type: f.type,
          size: f.size,
          bytes: await f.arrayBuffer(),
        })),
      );
      const res = await submitReimbursement(
        {
          title,
          category,
          amount: amt,
          currency: "USD",
          description,
          expenseDate,
          priority: "MEDIUM",
        },
        receipts,
      );
      if (!toastAction(res)) return;
      toast.success("Claim submitted");
      setOpen(false);
      setTitle(""); setAmount(""); setDescription(""); setFiles([]);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="mr-2 h-4 w-4" /> New claim</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New reimbursement claim</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={100} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Category</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as (typeof CATEGORIES)[number])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Amount (USD)</Label>
              <Input type="number" step="0.01" min="0.01" max={MAX_REIMBURSEMENT_AMOUNT} value={amount} onChange={(e) => setAmount(e.target.value)} required className="font-mono" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Expense date</Label>
            <Input type="date" value={expenseDate} max={today} onChange={(e) => setExpenseDate(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} required maxLength={500} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Receipts (optional, up to {MAX_RECEIPTS}; PDF/PNG/JPG, 8 MB each)</Label>
            <Input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
              multiple
              disabled={files.length >= MAX_RECEIPTS}
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            {files.length > 0 && (
              <ul className="space-y-1">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center justify-between rounded-md border px-2 py-1 text-xs">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Paperclip className="h-3 w-3 shrink-0" />
                      <span className="truncate">{f.name}</span>
                      <span className="shrink-0 text-muted-foreground">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending || !title || !amount || !description}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
