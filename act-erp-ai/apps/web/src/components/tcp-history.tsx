import Link from "next/link";
import { History } from "lucide-react";
import { db } from "@/lib/db";
import { formatDateOnly } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const num = (v: { toString(): string } | null | undefined) => Number(v?.toString() ?? 0);
const fmt = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

/** Old Timeclock Plus identifiers, so HR can find a person by the number they know. */
export function TcpIdentityCard({
  tcpNumber,
  tcpExportCode,
  workLocation,
}: {
  tcpNumber: string | null;
  tcpExportCode: string | null;
  workLocation: string | null;
}) {
  if (!tcpNumber && !tcpExportCode && !workLocation) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4 text-muted-foreground" /> Timeclock Plus
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">TCP number</dt>
            <dd className="font-mono">{tcpNumber ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">TCP export code</dt>
            <dd className="font-mono">{tcpExportCode ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Location</dt>
            <dd>{workLocation ?? "—"}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

/** PTO history imported from TCP: rule, this year's activity, and the ledger. */
export async function PtoLedgerCard({ employeeId }: { employeeId: string }) {
  const [rules, ledger] = await Promise.all([
    db.employeeAccrualRule.findMany({ where: { employeeId }, orderBy: { ruleId: "asc" } }),
    db.accrualLedgerEntry.findMany({
      where: { employeeId },
      orderBy: [{ date: "desc" }],
    }),
  ]);
  if (rules.length === 0 && ledger.length === 0) return null;

  const year = new Date().getFullYear();
  const thisYear = ledger.filter((l) => l.date && l.date.getUTCFullYear() === year);
  const sum = (k: "accrued" | "taken" | "expired" | "adjustments") =>
    thisYear.reduce((t, l) => t + num(l[k]), 0);
  const lastReported = ledger.find((l) => l.remaining !== null);

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">PTO history (from Timeclock Plus)</CardTitle>
        {rules.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Accrual rule: {rules.map((r) => r.ruleDescription).join(" → ")}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {[
            [`Accrued ${year}`, sum("accrued")],
            [`Taken ${year}`, sum("taken")],
            [`Expired ${year}`, sum("expired")],
            [`Adjusted ${year}`, sum("adjustments")],
          ].map(([label, v]) => (
            <div key={label as string} className="rounded-md border px-3 py-2">
              <dt className="text-xs text-muted-foreground">{label as string}</dt>
              <dd className="font-mono tabular-nums">{fmt(v as number)} h</dd>
            </div>
          ))}
        </dl>
        {lastReported?.date && (
          <p className="text-xs text-muted-foreground">
            Last balance TCP printed: {fmt(num(lastReported.remaining))} h on{" "}
            {formatDateOnly(lastReported.date)}. TCP only prints a balance on some rows, so check
            Persona&apos;s leave summary for what is available now.
          </p>
        )}
        <div className="max-h-72 overflow-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/60 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 font-medium">Date</th>
                <th className="px-3 py-1.5 text-right font-medium">Accrued</th>
                <th className="px-3 py-1.5 text-right font-medium">Taken</th>
                <th className="px-3 py-1.5 text-right font-medium">Expired</th>
                <th className="px-3 py-1.5 text-right font-medium">Adjust</th>
                <th className="px-3 py-1.5 text-right font-medium">Balance (TCP)</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {ledger
                .filter((l) => l.date)
                .slice(0, 150)
                .map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-1.5">{formatDateOnly(l.date!)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(num(l.accrued))}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(num(l.taken))}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(num(l.expired))}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(num(l.adjustments))}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {l.remaining === null ? "" : fmt(num(l.remaining))}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/** Link to the whole imported punch history in the Hours workspace. */
export function FullHistoryLink({ employeeId, count }: { employeeId: string; count: number }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
      <span className="flex items-center gap-2">
        {count.toLocaleString()} punches on record
        <Badge variant="outline" className="text-[10px]">includes Timeclock Plus history</Badge>
      </span>
      <Button asChild size="sm" variant="outline">
        <Link href={`/admin/hours?employee=${employeeId}&from=2021-01-01&to=2026-12-31`}>
          Open full history in Hours
        </Link>
      </Button>
    </div>
  );
}
