import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ArrowLeft, Star } from "lucide-react";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAvatarUrl } from "@/lib/format";
import { getDepartmentConfig } from "@/lib/departments";
import { JobCodeDetailActions, UnassignButton } from "./detail-actions";

export default async function JobCodeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [jobCode, departments, allEmployees] = await Promise.all([
    db.jobCode
      .findUnique({
        where: { id },
        include: {
          department: { select: { id: true, name: true } },
          assignments: {
            include: {
              employee: {
                select: {
                  id: true,
                  employeeId: true,
                  name: true,
                  email: true,
                  jobTitle: true,
                  profilePic: true,
                  employmentStatus: true,
                  department: { select: { name: true } },
                },
              },
            },
            orderBy: [{ isPrimary: "desc" }, { assignedAt: "desc" }],
          },
        },
      })
      .catch(() => null),
    db.department.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.employee.findMany({
      where: { employmentStatus: { not: "TERMINATED" } },
      orderBy: { name: "asc" },
      select: { id: true, employeeId: true, name: true, email: true },
    }),
  ]);

  if (!jobCode) notFound();

  const cfg = jobCode.department ? getDepartmentConfig(jobCode.department.name) : null;
  const Icon = cfg?.icon;
  const assignedIds = new Set(jobCode.assignments.map((a) => a.employee.id));
  const assignableEmployees = allEmployees.filter((e) => !assignedIds.has(e.id));

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
        <Link href="/admin/job-codes"><ArrowLeft className="mr-1 h-3.5 w-3.5" /> Job codes</Link>
      </Button>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            {jobCode.isDefault && <Star className="h-5 w-5 fill-primary text-primary" />}
            <span className="font-mono">{jobCode.code}</span>
            <span className="text-muted-foreground">·</span>
            <span>{jobCode.title}</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {jobCode.description ?? "No description"}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge variant={jobCode.isActive ? "success" : "secondary"} className="text-[10px]">
              {jobCode.isActive ? "Active" : "Inactive"}
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px]">{jobCode.rate}</Badge>
            {cfg && Icon ? (
              <span className="inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px]">
                <span className={`flex h-4 w-4 items-center justify-center rounded ${cfg.bgColor} ${cfg.color}`}>
                  <Icon className="h-2.5 w-2.5" />
                </span>
                {cfg.label}
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">No department</span>
            )}
          </div>
        </div>
        <JobCodeDetailActions
          jobCode={{
            id: jobCode.id,
            code: jobCode.code,
            title: jobCode.title,
            description: jobCode.description,
            rate: jobCode.rate,
            isActive: jobCode.isActive,
            isDefault: jobCode.isDefault,
            departmentId: jobCode.departmentId,
          }}
          departments={departments}
          assignableEmployees={assignableEmployees}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Assigned employees ({jobCode.assignments.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {jobCode.assignments.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No employees assigned to this code yet.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {jobCode.assignments.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-3 rounded-md border p-3"
                >
                  <Link
                    href={`/admin/employees/${a.employee.id}`}
                    className="flex flex-1 items-center gap-3 hover:underline"
                  >
                    <span className="relative h-9 w-9 overflow-hidden rounded-full bg-muted">
                      <Image
                        src={a.employee.profilePic ?? getAvatarUrl(a.employee.email)}
                        alt={a.employee.name}
                        fill
                        sizes="36px"
                        className="object-cover"
                        unoptimized
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{a.employee.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {a.employee.jobTitle ?? a.employee.department?.name ?? "—"}
                      </p>
                    </div>
                  </Link>
                  <div className="flex flex-col items-end gap-1">
                    {a.isPrimary && (
                      <Badge variant="default" className="text-[9px]">Primary</Badge>
                    )}
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {a.assignedRate}
                    </span>
                  </div>
                  <UnassignButton jobCodeId={jobCode.id} employeeId={a.employee.id} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
