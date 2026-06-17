"use client";

import { useMemo, useState, useTransition } from "react";
import {
  CalendarIcon,
  Check,
  Loader2,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { format, eachDayOfInterval, getDay, parseISO } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  createSchedule,
  createSchedulesBulk,
  deleteSchedule,
  updateSchedule,
} from "@/server/actions/schedules";

type Employee = { id: string; name: string; email: string };

export type EditTarget = {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  jobCode: string;
  notes: string | null;
};

const WEEKDAYS = [
  { idx: 1, label: "M" },
  { idx: 2, label: "T" },
  { idx: 3, label: "W" },
  { idx: 4, label: "T" },
  { idx: 5, label: "F" },
  { idx: 6, label: "S" },
  { idx: 0, label: "S" },
] as const;

export function ShiftDialog({
  open,
  onOpenChange,
  employees,
  initialDate,
  edit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  employees: Employee[];
  initialDate?: string;
  edit?: EditTarget | null;
}) {
  const isEdit = Boolean(edit);
  const formKey = edit ? `edit:${edit.id}` : `new:${initialDate ?? ""}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit shift" : "New shift"}</DialogTitle>
        </DialogHeader>
        <ShiftForm
          key={formKey}
          employees={employees}
          initialDate={initialDate}
          edit={edit ?? null}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function todayISO() {
  return format(new Date(), "yyyy-MM-dd");
}

function ShiftForm({
  employees,
  initialDate,
  edit,
  onClose,
}: {
  employees: Employee[];
  initialDate?: string;
  edit: EditTarget | null;
  onClose: () => void;
}) {
  const isEdit = Boolean(edit);
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [mode, setMode] = useState<"single" | "range">("single");
  const [selected, setSelected] = useState<string[]>(() =>
    edit ? [edit.employeeId] : [],
  );
  const [date, setDate] = useState(() => edit?.date ?? initialDate ?? todayISO());
  const [rangeStart, setRangeStart] = useState(() => initialDate ?? todayISO());
  const [rangeEnd, setRangeEnd] = useState(() => initialDate ?? todayISO());
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startTime, setStartTime] = useState(() => edit?.startTime ?? "08:00");
  const [endTime, setEndTime] = useState(() => edit?.endTime ?? "17:00");
  const [jobCode, setJobCode] = useState(() => edit?.jobCode ?? "ACT001");
  const [notes, setNotes] = useState(() => edit?.notes ?? "");
  const [search, setSearch] = useState("");

  const employeesById = useMemo(
    () => Object.fromEntries(employees.map((e) => [e.id, e])),
    [employees],
  );

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q),
    );
  }, [employees, search]);

  const expandedDates = useMemo(() => {
    if (mode === "single") return [date];
    if (!rangeStart || !rangeEnd) return [];
    try {
      const start = parseISO(rangeStart);
      const end = parseISO(rangeEnd);
      if (end < start) return [];
      return eachDayOfInterval({ start, end })
        .filter((d) => weekdays.includes(getDay(d)))
        .map((d) => format(d, "yyyy-MM-dd"));
    } catch {
      return [];
    }
  }, [mode, date, rangeStart, rangeEnd, weekdays]);

  const totalShifts = expandedDates.length * Math.max(selected.length, 1);

  function toggleEmployee(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function toggleWeekday(idx: number) {
    setWeekdays((prev) =>
      prev.includes(idx) ? prev.filter((x) => x !== idx) : [...prev, idx],
    );
  }

  function selectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      filteredEmployees.forEach((e) => next.add(e.id));
      return Array.from(next);
    });
  }

  function clearSelection() {
    setSelected([]);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (endTime <= startTime) {
      toast.error("End time must be after start time.");
      return;
    }

    startTransition(async () => {
      try {
        if (isEdit && edit) {
          await updateSchedule({
            id: edit.id,
            date,
            jobCode,
            startTime,
            endTime,
            notes: notes || null,
          });
          toast.success("Shift updated");
          onClose();
          return;
        }

        if (selected.length === 0) {
          toast.error("Pick at least one employee.");
          return;
        }

        if (mode === "single" && selected.length === 1) {
          await createSchedule({
            employeeId: selected[0],
            date,
            jobCode,
            startTime,
            endTime,
            notes: notes || undefined,
          });
          toast.success("Shift created");
          onClose();
          return;
        }

        if (expandedDates.length === 0) {
          toast.error("No dates match the selected days of the week.");
          return;
        }

        const result = await createSchedulesBulk({
          employeeIds: selected,
          dates: expandedDates,
          jobCode,
          startTime,
          endTime,
          notes: notes || undefined,
        });
        toast.success(
          `Created ${result.created} shift${result.created === 1 ? "" : "s"}` +
            (result.skipped ? ` · ${result.skipped} skipped (conflicts)` : ""),
        );
        onClose();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed");
      }
    });
  }

  function onDelete() {
    if (!edit) return;
    startTransition(async () => {
      try {
        await deleteSchedule(edit.id);
        toast.success("Shift deleted");
        setConfirmDelete(false);
        onClose();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed");
      }
    });
  }

  return (
    <>
      <form onSubmit={onSubmit} className="space-y-5">
        {/* Employees */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">
              {isEdit ? "Employee" : `Employees${selected.length ? ` · ${selected.length} selected` : ""}`}
            </Label>
            {!isEdit && selected.length > 0 && (
              <button
                type="button"
                onClick={clearSelection}
                className="text-[11px] text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>

          {isEdit && edit ? (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              {edit.employeeName}
            </div>
          ) : (
            <div className="rounded-md border bg-background">
              {/* Search bar */}
              <div className="relative border-b">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search employees…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-9 border-0 pl-8 shadow-none focus-visible:ring-0"
                />
                <button
                  type="button"
                  onClick={selectAllVisible}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Select all{search ? " (filtered)" : ""}
                </button>
              </div>

              {/* Scrollable list */}
              <ul className="max-h-44 overflow-y-auto py-1">
                {filteredEmployees.length === 0 ? (
                  <li className="py-6 text-center text-xs text-muted-foreground">
                    No matches.
                  </li>
                ) : (
                  filteredEmployees.map((e) => {
                    const on = selected.includes(e.id);
                    return (
                      <li key={e.id}>
                        <button
                          type="button"
                          onClick={() => toggleEmployee(e.id)}
                          className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted ${
                            on ? "bg-muted/60" : ""
                          }`}
                        >
                          <span
                            className={`grid h-4 w-4 place-items-center rounded border ${
                              on
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-input"
                            }`}
                          >
                            {on && <Check className="h-3 w-3" />}
                          </span>
                          <span className="flex-1 min-w-0 truncate">{e.name}</span>
                          <span className="truncate text-[10px] text-muted-foreground">
                            {e.email}
                          </span>
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>

              {/* Selected chips */}
              {selected.length > 0 && (
                <div className="flex flex-wrap gap-1.5 border-t bg-muted/30 p-2">
                  {selected.map((id) => {
                    const emp = employeesById[id];
                    if (!emp) return null;
                    return (
                      <Badge key={id} variant="secondary" className="gap-1">
                        {emp.name}
                        <button
                          type="button"
                          onClick={() => toggleEmployee(id)}
                          aria-label={`Remove ${emp.name}`}
                          className="rounded hover:bg-background/60"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Date mode toggle */}
        {!isEdit && (
          <div className="inline-flex rounded-md border p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setMode("single")}
              className={`rounded-sm px-3 py-1 transition-colors ${
                mode === "single"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Single date
            </button>
            <button
              type="button"
              onClick={() => setMode("range")}
              className={`rounded-sm px-3 py-1 transition-colors ${
                mode === "range"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Date range
            </button>
          </div>
        )}

        {(isEdit || mode === "single") && (
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Date</Label>
              <DatePickerField value={date} onChange={setDate} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Start</Label>
              <Input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">End</Label>
              <Input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>
        )}

        {!isEdit && mode === "range" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">From</Label>
                <DatePickerField value={rangeStart} onChange={setRangeStart} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">To</Label>
                <DatePickerField value={rangeEnd} onChange={setRangeEnd} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Days of the week</Label>
              <div className="flex gap-1">
                {WEEKDAYS.map((d) => {
                  const on = weekdays.includes(d.idx);
                  return (
                    <button
                      type="button"
                      key={d.idx}
                      onClick={() => toggleWeekday(d.idx)}
                      className={`h-8 w-8 rounded border text-xs font-medium transition ${
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "bg-background text-muted-foreground hover:bg-muted"
                      }`}
                      aria-pressed={on}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Start</Label>
                <Input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">End</Label>
                <Input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>
            <p className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">{totalShifts}</span>{" "}
              shift{totalShifts === 1 ? "" : "s"} will be created
              {expandedDates.length > 0 && selected.length > 0 ? (
                <>
                  {" "}
                  · {selected.length} employee
                  {selected.length === 1 ? "" : "s"} ×{" "}
                  {expandedDates.length} day
                  {expandedDates.length === 1 ? "" : "s"}
                </>
              ) : null}
              .
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Job code</Label>
            <Input
              value={jobCode}
              onChange={(e) => setJobCode(e.target.value.toUpperCase())}
              className="font-mono"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Notes (optional)</Label>
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {isEdit ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={pending}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                pending ||
                (!isEdit && selected.length === 0) ||
                (!isEdit && mode === "range" && expandedDates.length === 0)
              }
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEdit ? "Save" : "Create"}
            </Button>
          </div>
        </DialogFooter>
      </form>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this shift?</AlertDialogTitle>
            <AlertDialogDescription>
              Only this shift will be deleted. The employee will no longer see
              it on their schedule.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                onDelete();
              }}
              disabled={pending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function DatePickerField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const date = useMemo(() => {
    try {
      return parseISO(value);
    } catch {
      return new Date();
    }
  }, [value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start gap-2 font-normal"
        >
          <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{format(date, "MMM d, yyyy")}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={(d) => {
            if (d) {
              onChange(format(d, "yyyy-MM-dd"));
              setOpen(false);
            }
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
