"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Plus, Loader2 } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { submitLeaveRequest } from "@/server/actions/leave";
import { runAction } from "@/lib/toast-action";
import { usePortalLanguage } from "@/components/portal-language";
import {
  LEAVE_TYPES,
  leaveDaysForRange,
  parseDateOnly,
  splitDaysByYear,
} from "@/lib/leave-balance";

const TYPES = LEAVE_TYPES;

export type LeaveBalances = Record<number, Record<string, { available: number | null }>>;

type Preview = { days?: number; error?: string } | null;

export function LeaveRequestForm({
  balances,
  today,
}: {
  /** year -> leave type -> available days after pending/approved (null = unlimited). */
  balances: LeaveBalances;
  /** Business-timezone "today" as YYYY-MM-DD; earlier dates are disabled. */
  today: string;
}) {
  const { t, locale, toastAction } = usePortalLanguage();
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
  const [type, setType] = useState<(typeof TYPES)[number]>("ANNUAL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startHalf, setStartHalf] = useState(false);
  const [endHalf, setEndHalf] = useState(false);
  const [description, setDescription] = useState("");
  const leaveTypeLabel = (leaveType: string) => t(`time.leave.type.${leaveType}`);
  const formatDays = (n: number) => {
    const rounded = Math.round(n * 10) / 10;
    return t(rounded === 1 ? "time.leave.days.one" : "time.leave.days.many", {
      count: rounded,
    });
  };

  const single = !!startDate && startDate === endDate;

  // Same math as the server (shared pure lib) so the preview always matches.
  const preview = ((): Preview => {
    const s = parseDateOnly(startDate);
    const e = parseDateOnly(endDate);
    if (!s || !e) return null;
    if (e < s) return { error: t("time.leave.endBeforeStart") };
    const range = {
      startDate: s,
      endDate: e,
      startHalfDay: startHalf,
      endHalfDay: single ? false : endHalf,
    };
    const days = leaveDaysForRange(range);
    if (days <= 0) return { error: t("time.leave.noWorkingDays") };
    for (const [year, d] of splitDaysByYear(range)) {
      const avail = balances[year]?.[type]?.available;
      if (avail !== undefined && avail !== null && d > avail + 1e-9) {
        return {
          days,
          error: t("time.leave.insufficient", {
            type: leaveTypeLabel(type).toLocaleLowerCase(),
            year,
            available: formatDays(Math.max(0, avail)),
            needed: formatDays(d),
          }),
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
      const res = await runAction(() =>
        submitLeaveRequest({
          leaveType: type,
          startDate,
          endDate,
          startHalfDay: startHalf,
          endHalfDay: single ? false : endHalf,
          description: description || undefined,
        }),
      );
      if (!toastAction(res)) return;
      toast.success(
        t("time.leave.requestSubmitted", { days: formatDays(res.totalDays) }),
      );
      closeForm();
      setStartDate("");
      setEndDate("");
      setDescription("");
      setStartHalf(false);
      setEndHalf(false);
    });
  }

  return (
    <Collapsible className="mb-6 min-w-0 space-y-3" open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild disabled={pending}>
        <Button ref={triggerRef} className="min-h-11 w-full sm:w-auto md:min-h-9">
          <Plus className="mr-2 h-4 w-4" /> {t("time.leave.request")}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent asChild>
        <section
          aria-labelledby={`${formId}-heading`}
          className="min-w-0 space-y-4 rounded-lg border bg-card p-4 sm:p-6"
        >
          <div className="space-y-1.5">
            <h2 id={`${formId}-heading`} className="text-lg font-semibold">
              {t("time.leave.request")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {curBal === null || curBal === undefined
                ? t("time.leave.balanceUnlimited", {
                    type: leaveTypeLabel(type).toLocaleLowerCase(),
                  })
                : t("time.leave.balanceAvailable", {
                    available: formatDays(curBal),
                    type: leaveTypeLabel(type).toLocaleLowerCase(),
                    year: yearNow,
                  })}
            </p>
          </div>
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-type`} className="text-xs">
                {t("time.leave.field.type")}
              </Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as (typeof TYPES)[number])}
              >
                <SelectTrigger id={`${formId}-type`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((leaveType) => {
                    const a = balances[yearNow]?.[leaveType]?.available;
                    return (
                      <SelectItem key={leaveType} value={leaveType}>
                        {leaveTypeLabel(leaveType)}{" "}
                        {a === null || a === undefined
                          ? `(${t("time.leave.unlimited")})`
                          : `(${t("time.leave.left", { count: a })})`}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-start`} className="text-xs">
                  {t("time.leave.field.startDate")}
                </Label>
                <Input
                  id={`${formId}-start`}
                  type="date"
                  lang={locale}
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
                <Label htmlFor={`${formId}-end`} className="text-xs">
                  {t("time.leave.field.endDate")}
                </Label>
                <Input
                  id={`${formId}-end`}
                  type="date"
                  lang={locale}
                  min={startDate || today}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={startHalf}
                  onCheckedChange={(v) => setStartHalf(v === true)}
                />
                {single ? t("time.leave.halfDayOnly") : t("time.leave.startHalfDay")}
              </label>
              {!single && (
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={endHalf}
                    onCheckedChange={(v) => setEndHalf(v === true)}
                  />
                  {t("time.leave.endHalfDay")}
                </label>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-reason`} className="text-xs">
                {t("time.leave.reasonOptional")}
              </Label>
              <Textarea
                id={`${formId}-reason`}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                maxLength={500}
              />
            </div>
            {preview && (
              <p
                className={
                  preview.error
                    ? "text-xs text-destructive"
                    : "text-xs text-muted-foreground"
                }
                role="status"
              >
                {preview.days !== undefined && (
                  <span className="font-medium">
                    {t("time.leave.willBeCharged", {
                      days: formatDays(preview.days),
                    })}{" "}
                  </span>
                )}
                {preview.error}
              </p>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end [&_button]:min-h-11">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={closeForm}
              >
                {t("time.leave.cancel")}
              </Button>
              <Button type="submit" disabled={pending || blocked}>
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t("time.leave.submit")}
              </Button>
            </div>
          </form>
        </section>
      </CollapsibleContent>
    </Collapsible>
  );
}
