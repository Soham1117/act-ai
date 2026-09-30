"use client";

import { useState, useTransition } from "react";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { submitLeaveRequest } from "@/server/actions/leave";
import { toastAction } from "@/lib/toast-action";
import {
  LEAVE_TYPES,
  fmtDays,
  leaveDaysForRange,
  parseDateOnly,
  splitDaysByYear,
} from "@/lib/leave-balance";

const TYPES = LEAVE_TYPES;

export type DialogBalances = Record<number, Record<string, { available: number | null }>>;

type Preview = { days?: number; error?: string } | null;

export function LeaveRequestDialog({
  balances,
  today,
}: {
  /** year -> leave type -> available days after pending/approved (null = unlimited). */
  balances: DialogBalances;
  /** Business-timezone "today" as YYYY-MM-DD; earlier dates are disabled. */
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState<(typeof TYPES)[number]>("ANNUAL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startHalf, setStartHalf] = useState(false);
  const [endHalf, setEndHalf] = useState(false);
  const [description, setDescription] = useState("");

  const single = !!startDate && startDate === endDate;

  // Same math as the server (shared pure lib) so the preview always matches.
  const preview = ((): Preview => {
    const s = parseDateOnly(startDate);
    const e = parseDateOnly(endDate);
    if (!s || !e) return null;
    if (e < s) return { error: "End date must be on or after the start date." };
    const range = {
      startDate: s,
      endDate: e,
      startHalfDay: startHalf,
      endHalfDay: single ? false : endHalf,
    };
    const days = leaveDaysForRange(range);
    if (days <= 0) return { error: "No working days in that range (weekends are not counted)." };
    for (const [year, d] of splitDaysByYear(range)) {
      const avail = balances[year]?.[type]?.available;
      if (avail !== undefined && avail !== null && d > avail + 1e-9) {
        return {
          days,
          error: `Not enough ${type.toLowerCase()} leave for ${year}: ${fmtDays(Math.max(0, avail))} available, ${fmtDays(d)} needed.`,
        };
      }
    }
    return { days };
  })();

  const yearNow = Number(today.slice(0, 4));
  const curBal = balances[yearNow]?.[type]?.available;
  const blocked = !preview || !!preview.error;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await submitLeaveRequest({
        leaveType: type,
        startDate,
        endDate,
        startHalfDay: startHalf,
        endHalfDay: single ? false : endHalf,
        description: description || undefined,
      });
      if (!toastAction(res)) return;
      toast.success(`Leave request submitted (${fmtDays(res.totalDays)})`);
      setOpen(false);
      setStartDate(""); setEndDate(""); setDescription("");
      setStartHalf(false); setEndHalf(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="mr-2 h-4 w-4" /> Request leave</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request leave</DialogTitle>
          <DialogDescription>
            {curBal === null || curBal === undefined
              ? `${type.toLowerCase()} leave is not balance-limited.`
              : `${fmtDays(curBal)} of ${type.toLowerCase()} leave available in ${yearNow} (pending requests included).`}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as (typeof TYPES)[number])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => {
                  const a = balances[yearNow]?.[t]?.available;
                  return (
                    <SelectItem key={t} value={t}>
                      {t} {a === null || a === undefined ? "(unlimited)" : `(${a} left)`}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Start date</Label>
              <Input
                type="date"
                min={today}
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (!endDate || endDate < e.target.value) setEndDate(e.target.value);
                }}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">End date</Label>
              <Input
                type="date"
                min={startDate || today}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={startHalf} onCheckedChange={(v) => setStartHalf(v === true)} />
              {single ? "Half day only" : "Start date is a half day"}
            </label>
            {!single && (
              <label className="flex items-center gap-2 text-xs">
                <Checkbox checked={endHalf} onCheckedChange={(v) => setEndHalf(v === true)} />
                End date is a half day
              </label>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Reason (optional)</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={500} />
          </div>
          {preview && (
            <p
              className={preview.error ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
              role="status"
            >
              {preview.days !== undefined && (
                <span className="font-medium">{fmtDays(preview.days)} will be charged. </span>
              )}
              {preview.error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending || blocked}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
