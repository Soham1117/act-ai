"use client";

import { useEffect, useState, useTransition } from "react";
import { Download, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/simple-select";
import {
  listPayrollNotes,
  savePayrollNote,
  type PayrollNoteRow,
} from "@/server/actions/payroll-notes";

type Option = { id: string; label: string };

/** Download the workbook HR sends to the accountants, and keep per-period notes for it. */
export function PayrollWorkbookCard({
  periods,
  employees,
  defaultPeriodId,
}: {
  periods: Option[];
  employees: Option[];
  defaultPeriodId: string;
}) {
  const [periodId, setPeriodId] = useState(defaultPeriodId);
  const [count, setCount] = useState("3");
  const [notes, setNotes] = useState<PayrollNoteRow[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [text, setText] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    listPayrollNotes(periodId)
      .then((rows) => live && setNotes(rows))
      .catch(() => live && setNotes([]));
    return () => {
      live = false;
    };
  }, [periodId]);

  function save(id: string, note: string, done?: () => void) {
    start(async () => {
      const res = await savePayrollNote({ periodId, employeeId: id, note });
      if (!res.ok) return void toast.error(res.error);
      setNotes(await listPayrollNotes(periodId));
      done?.();
    });
  }

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Payroll workbook for the accountants</CardTitle>
        <p className="text-xs text-muted-foreground">
          One Excel file, one sheet per pay period, in the same layout as the TCP Period (Detail)
          sheets. Salaried staff are listed at the bottom.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[14rem] space-y-1">
            <Label className="text-xs text-muted-foreground">Latest pay period</Label>
            <SimpleSelect
              value={periodId}
              onValueChange={setPeriodId}
              options={periods.map((p) => ({ value: p.id, label: p.label }))}
              aria-label="Latest pay period"
            />
          </div>
          <div className="w-44 space-y-1">
            <Label className="text-xs text-muted-foreground">Sheets</Label>
            <SimpleSelect
              value={count}
              onValueChange={setCount}
              options={[
                { value: "1", label: "This period only" },
                { value: "2", label: "This + 1 earlier" },
                { value: "3", label: "This + 2 earlier" },
              ]}
              aria-label="Number of sheets"
            />
          </div>
          <Button asChild className="h-9">
            <a href={`/api/payroll/workbook?period=${encodeURIComponent(periodId)}&count=${count}`}>
              <Download className="mr-2 h-4 w-4" /> Download Excel
            </a>
          </Button>
        </div>

        <div className="space-y-2 border-t pt-3">
          <p className="text-sm font-medium">Notes for this pay period</p>
          <p className="text-xs text-muted-foreground">
            Shown in the Notes column next to the employee, for example an extra deduction.
          </p>
          {notes.length > 0 && (
            <ul className="divide-y rounded-md border text-sm">
              {notes.map((n) => (
                <li key={n.employeeId} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0">
                    <span className="font-medium">{n.employeeName}</span>
                    <span className="text-muted-foreground"> — {n.note}</span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    aria-label={`Remove note for ${n.employeeName}`}
                    disabled={pending}
                    onClick={() => save(n.employeeId, "")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[14rem] space-y-1">
              <Label className="text-xs text-muted-foreground">Employee</Label>
              <SimpleSelect
                value={employeeId}
                onValueChange={setEmployeeId}
                options={employees.map((e) => ({ value: e.id, label: e.label }))}
                placeholder="Choose employee"
                emptyValue="__none"
                aria-label="Employee"
              />
            </div>
            <div className="min-w-[16rem] flex-1 space-y-1">
              <Label className="text-xs text-muted-foreground" htmlFor="pw-note">
                Note
              </Label>
              <Input
                id="pw-note"
                value={text}
                maxLength={500}
                onChange={(e) => setText(e.target.value)}
                placeholder="Additional 114.39 for 2nd 401K loan"
                className="h-9"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-9"
              disabled={pending || !employeeId || !text.trim()}
              onClick={() =>
                save(employeeId, text, () => {
                  setText("");
                  setEmployeeId("");
                })
              }
            >
              Save note
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
