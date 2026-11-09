import { Fragment } from "react";
import Link from "next/link";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getDepartmentConfig } from "@/lib/departments";
import { DepartmentForm } from "./department-dialog";
import { DepartmentActions } from "./department-actions";
import { PanelSlot } from "@/components/inline-panel";

export const metadata = { title: "Departments" };

export default async function DepartmentsPage() {
  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch {
      return fallback;
    }
  };

  const departments = await safe(
    db.department.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { employees: true } } },
    }),
    [],
  );

  return (
    <>
      <PageHeader
        title="Departments"
        description={`${departments.length} departments`}
        actions={<DepartmentForm panelSlot="add-department" />}
      />
      <PanelSlot id="add-department" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {departments.map((d) => {
          const cfg = getDepartmentConfig(d.name);
          const Icon = cfg.icon;
          return (
            <Fragment key={d.id}>
            <Card className="relative transition-colors hover:border-primary/50">
              <Link href={`/admin/departments/${d.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-md ${cfg.bgColor} ${cfg.color}`}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    {d.code && (
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {d.code}
                      </Badge>
                    )}
                  </div>
                  <h3 className="mt-3 font-semibold">{cfg.label}</h3>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {d.description ?? "No description"}
                  </p>
                  <p className="mt-3 text-xs">
                    <span className="font-medium tabular-nums">{d._count.employees}</span>
                    <span className="text-muted-foreground"> employees</span>
                  </p>
                </CardContent>
              </Link>
              <div className="border-t px-4 py-2">
                <DepartmentActions
                  department={{
                    id: d.id,
                    name: d.name,
                    code: d.code,
                    description: d.description,
                  }}
                />
              </div>
            </Card>
            <PanelSlot id={`dept-${d.id}`} />
            </Fragment>
          );
        })}
      </div>
      {departments.length === 0 && (
        <p className="mt-12 text-center text-sm text-muted-foreground">
          No departments yet. Create one with the button above.
        </p>
      )}
    </>
  );
}
