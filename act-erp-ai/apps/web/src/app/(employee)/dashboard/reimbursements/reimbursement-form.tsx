"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Plus, Loader2, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { runAction } from "@/lib/toast-action";
import { usePortalLanguage } from "@/components/portal-language";
import { MAX_RECEIPTS, MAX_REIMBURSEMENT_AMOUNT } from "@/lib/reimbursement";
import { businessDateString } from "@/lib/business-time";

const RECEIPT_MAX_BYTES = 8 * 1024 * 1024;
const RECEIPT_EXTS = ["pdf", "png", "jpg", "jpeg"];

const CATEGORIES = [
  "TRAVEL",
  "MEALS",
  "OFFICE_SUPPLIES",
  "TRAINING",
  "EQUIPMENT",
  "MEDICAL",
  "FUEL",
  "ACCOMMODATION",
  "OTHER",
] as const;

export function ReimbursementForm() {
  const { t, enumLabel, toastAction } = usePortalLanguage();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const formId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  useEffect(() => {
    if (!open && !pending && restoreFocus.current) {
      restoreFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [open, pending]);

  function closeForm() {
    restoreFocus.current = true;
    setOpen(false);
  }
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("TRAVEL");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(() => businessDateString());
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const today = businessDateString();

  function onOpenChange(nextOpen: boolean) {
    if (nextOpen && !title && !amount && !description && files.length === 0) {
      setExpenseDate(businessDateString());
    }
    setOpen(nextOpen);
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      if (!RECEIPT_EXTS.includes(ext)) {
        toast.error(t("workspace.reimbursements.invalidReceiptType", { name: f.name }));
        continue;
      }
      if (f.size > RECEIPT_MAX_BYTES) {
        toast.error(t("workspace.reimbursements.receiptTooLarge", { name: f.name }));
        continue;
      }
      if (next.length >= MAX_RECEIPTS) {
        toast.error(t("workspace.reimbursements.maxReceipts", { count: MAX_RECEIPTS }));
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
      toast.error(t("workspace.reimbursements.amountPositive"));
      return;
    }
    if (amt > MAX_REIMBURSEMENT_AMOUNT) {
      toast.error(
        t("workspace.reimbursements.amountOverLimit", {
          amount: MAX_REIMBURSEMENT_AMOUNT.toLocaleString("en-US"),
        }),
      );
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
      const res = await runAction(() =>
        submitReimbursement(
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
        ),
      );
      if (!toastAction(res)) return;
      toast.success(t("workspace.reimbursements.submittedToast"));
      closeForm();
      setTitle("");
      setAmount("");
      setDescription("");
      setFiles([]);
    });
  }

  return (
    <Collapsible
      className="mb-6 min-w-0 space-y-3"
      open={open}
      onOpenChange={onOpenChange}
    >
      <CollapsibleTrigger asChild disabled={pending}>
        <Button ref={triggerRef} className="min-h-11 w-full sm:w-auto md:min-h-9">
          <Plus className="mr-2 h-4 w-4" /> {t("workspace.reimbursements.newClaim")}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent asChild>
        <section
          aria-labelledby={`${formId}-heading`}
          className="min-w-0 space-y-4 rounded-lg border bg-card p-4 sm:p-6"
        >
          <div className="space-y-1.5">
            <h2 id={`${formId}-heading`} className="text-lg font-semibold">
              {t("workspace.reimbursements.newClaim")}
            </h2>
          </div>
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-title`} className="text-xs">
                {t("workspace.reimbursements.titleLabel")}
              </Label>
              <Input
                id={`${formId}-title`}
                aria-label={t("workspace.reimbursements.titleLabel")}
                placeholder={t("workspace.reimbursements.titlePlaceholder")}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={100}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-category`} className="text-xs">
                  {t("workspace.reimbursements.category")}
                </Label>
                <Select
                  value={category}
                  onValueChange={(v) => setCategory(v as (typeof CATEGORIES)[number])}
                >
                  <SelectTrigger
                    id={`${formId}-category`}
                    aria-label={t("workspace.reimbursements.category")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c === "OTHER" ? t("workspace.other") : enumLabel(c)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-amount`} className="text-xs">
                  {t("workspace.reimbursements.amountUsd")}
                </Label>
                <Input
                  id={`${formId}-amount`}
                  aria-label={t("workspace.reimbursements.amountUsd")}
                  placeholder={t("workspace.reimbursements.amountPlaceholder")}
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0.01"
                  max={MAX_REIMBURSEMENT_AMOUNT}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                  className="font-mono"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-date`} className="text-xs">
                {t("workspace.reimbursements.expenseDate")}
              </Label>
              <Input
                id={`${formId}-date`}
                aria-label={t("workspace.reimbursements.expenseDate")}
                type="date"
                value={expenseDate}
                max={today}
                onChange={(e) => setExpenseDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-description`} className="text-xs">
                {t("workspace.reimbursements.descriptionLabel")}
              </Label>
              <Textarea
                id={`${formId}-description`}
                aria-label={t("workspace.reimbursements.descriptionLabel")}
                placeholder={t("workspace.reimbursements.descriptionPlaceholder")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                required
                maxLength={500}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-receipts`} className="text-xs">
                {t("workspace.reimbursements.receiptsLabel", { count: MAX_RECEIPTS })}
              </Label>
              <Input
                id={`${formId}-receipts`}
                type="file"
                aria-label={t("workspace.reimbursements.receiptsLabel", {
                  count: MAX_RECEIPTS,
                })}
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
                    <li
                      key={`${f.name}-${i}`}
                      className="flex items-center justify-between rounded-md border px-2 py-1 text-xs"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <Paperclip className="h-3 w-3 shrink-0" />
                        <span className="truncate">{f.name}</span>
                        <span className="shrink-0 text-muted-foreground">
                          {(f.size / 1024 / 1024).toFixed(1)} MB
                        </span>
                      </span>
                      <button
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        type="button"
                        aria-label={t("workspace.reimbursements.removeReceipt", {
                          name: f.name,
                        })}
                        onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end [&_button]:min-h-11">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={closeForm}
              >
                {t("workspace.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={pending || !title || !amount || !description}
              >
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t("workspace.submit")}
              </Button>
            </div>
          </form>
        </section>
      </CollapsibleContent>
    </Collapsible>
  );
}
