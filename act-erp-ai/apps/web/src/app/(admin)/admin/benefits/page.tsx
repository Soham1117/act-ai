import { AlertTriangle } from "lucide-react";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDateOnly } from "@/lib/format";
import { benefitTypeLabel, tierLabel, costPeriodLabel } from "@/lib/benefits";
import { PlanDialog } from "./plan-dialog";
import { RollForwardDialog } from "./roll-forward-dialog";
import { DeactivatePlanButton } from "./deactivate-plan-button";
import { MarkVerifiedButton } from "./mark-verified-button";

export const metadata = { title: "Benefits" };

export default async function AdminBenefitsPage() {
  const [plans, openEnrollments] = await Promise.all([
    db.benefitPlan.findMany({
      include: {
        tiers: true,
        _count: { select: { enrollments: true, elections: true } },
      },
      orderBy: [{ type: "asc" }, { planYearStart: "desc" }],
    }),
    // Coverage conflicts: at write time, upsertEnrollment/changeEnrollmentTier
    // block a new overlapping row — this is a defensive integrity check over
    // whatever already exists (seeded data, or a race). At 35 employees a
    // page-load query beats standing up a nightly job for it.
    db.benefitEnrollment.findMany({
      where: { endDate: null },
      include: {
        plan: { select: { type: true, name: true } },
        employee: { select: { id: true, name: true, employeeId: true } },
      },
    }),
  ]);

  const conflictMap = new Map<string, typeof openEnrollments>();
  for (const en of openEnrollments) {
    const key = `${en.employeeId}:${en.plan.type}`;
    const list = conflictMap.get(key) ?? [];
    list.push(en);
    conflictMap.set(key, list);
  }
  const conflicts = [...conflictMap.values()].filter((rows) => rows.length > 1);

  const groups = new Map<string, typeof plans>();
  for (const p of plans) {
    const list = groups.get(p.type) ?? [];
    list.push(p);
    groups.set(p.type, list);
  }

  // Open-enrollment counts, batched once instead of per-plan-card.
  const rosterCounts = await db.benefitEnrollment.groupBy({
    by: ["planId", "tier"],
    where: { endDate: null },
    _count: true,
  });
  const rosterByPlan = new Map<string, { tier: string | null; count: number }[]>();
  for (const r of rosterCounts) {
    const list = rosterByPlan.get(r.planId) ?? [];
    list.push({ tier: r.tier, count: r._count });
    rosterByPlan.set(r.planId, list);
  }
  const openCountByPlan = new Map<string, number>();
  for (const en of openEnrollments) {
    openCountByPlan.set(en.planId, (openCountByPlan.get(en.planId) ?? 0) + 1);
  }
  const retirementPlans = plans.filter((p) => p.type === "RETIREMENT_401K");
  const retirementCounts = await Promise.all(
    retirementPlans.map((p) => db.retirementElection.count({ where: { planId: p.id, endDate: null } })),
  );
  const openRetirementByPlan = new Map<string, number>(
    retirementPlans.map((p, i) => [p.id, retirementCounts[i]]),
  );

  return (
    <>
      <PageHeader
        title="Benefits"
        description="Plan catalog for the medical/dental/vision/401(k) mirror. Per-employee enrollment happens on each employee's detail page."
        actions={
          <div className="flex gap-2">
            <MarkVerifiedButton />
            <PlanDialog />
          </div>
        }
      />

      {conflicts.length > 0 && (
        <Card className="mb-6 border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <AlertTriangle className="h-4 w-4" /> Coverage conflicts ({conflicts.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              These employees have more than one currently-open enrollment for the same benefit type. End
              one of each pair on the employee&apos;s Benefits card.
            </p>
            <ul className="divide-y text-sm">
              {conflicts.map((rows) => (
                <li key={`${rows[0].employeeId}:${rows[0].plan.type}`} className="py-2">
                  <span className="font-medium">{rows[0].employee.name}</span>{" "}
                  <span className="text-xs text-muted-foreground">({rows[0].employee.employeeId})</span>
                  {" — "}
                  {benefitTypeLabel(rows[0].plan.type)}: {rows.map((r) => r.plan.name).join(", ")}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="space-y-8">
        {[...groups.entries()].map(([type, typePlans]) => (
          <div key={type}>
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{benefitTypeLabel(type)}</h2>
            <div className="space-y-3">
              {typePlans.map((p) => {
                const roster = rosterByPlan.get(p.id) ?? [];
                const openCount =
                  p.type === "RETIREMENT_401K"
                    ? openRetirementByPlan.get(p.id) ?? 0
                    : openCountByPlan.get(p.id) ?? 0;
                return (
                  <Card key={p.id} className={p.isActive ? undefined : "opacity-60"}>
                    <CardHeader className="flex flex-row items-start justify-between space-y-0">
                      <div>
                        <div className="mb-1 flex items-center gap-2">
                          <CardTitle className="text-base">{p.name}</CardTitle>
                          {!p.isActive && <Badge variant="outline" className="text-[10px]">Inactive</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {p.carrierName} · Plan year {formatDateOnly(p.planYearStart)} → {formatDateOnly(p.planYearEnd)} ·{" "}
                          {costPeriodLabel(p.costPeriod)}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <PlanDialog
                          plan={{
                            id: p.id,
                            type: p.type,
                            name: p.name,
                            carrierName: p.carrierName,
                            groupNumber: p.groupNumber,
                            carrierPhone: p.carrierPhone,
                            carrierPortalUrl: p.carrierPortalUrl,
                            planYearStart: p.planYearStart.toISOString().slice(0, 10),
                            planYearEnd: p.planYearEnd.toISOString().slice(0, 10),
                            costPeriod: p.costPeriod,
                            matchDescription: p.matchDescription,
                            vestingDescription: p.vestingDescription,
                            notes: p.notes,
                            tiers: p.tiers.map((t) => ({
                              tier: t.tier,
                              employeeCost: Number(t.employeeCost),
                              employerCost: Number(t.employerCost),
                            })),
                          }}
                        />
                        <RollForwardDialog
                          plan={{
                            id: p.id,
                            name: p.name,
                            type: p.type,
                            planYearEnd: p.planYearEnd.toISOString().slice(0, 10),
                            openEnrollmentCount: openCount,
                            tiers: p.tiers.map((t) => ({
                              tier: t.tier,
                              employeeCost: Number(t.employeeCost),
                              employerCost: Number(t.employerCost),
                            })),
                          }}
                        />
                        {p.isActive && <DeactivatePlanButton planId={p.id} planName={p.name} />}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      {p.type !== "RETIREMENT_401K" && p.tiers.length > 0 && (
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {p.tiers.map((t) => {
                            const count = roster.find((r) => r.tier === t.tier)?.count ?? 0;
                            return (
                              <div key={t.tier} className="rounded-md border p-2 text-xs">
                                <div className="flex items-center justify-between">
                                  <span className="font-medium">{tierLabel(t.tier)}</span>
                                  <Badge variant="secondary" className="text-[10px]">{count}</Badge>
                                </div>
                                <p className="mt-1 text-muted-foreground">
                                  {formatCurrency(Number(t.employeeCost))} employee ·{" "}
                                  {formatCurrency(Number(t.employerCost))} employer
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {p.type === "RETIREMENT_401K" && p.matchDescription && (
                        <p className="rounded-md border bg-muted/40 p-3 text-xs">
                          <span className="font-medium">Match: </span>
                          {p.matchDescription}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {openCount} currently enrolled · {p._count.enrollments + p._count.elections} total
                        {p._count.enrollments + p._count.elections === 1 ? " row" : " rows"} on this plan
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        ))}
        {plans.length === 0 && (
          <p className="text-sm text-muted-foreground">No benefit plans yet. Create one to get started.</p>
        )}
      </div>
    </>
  );
}
