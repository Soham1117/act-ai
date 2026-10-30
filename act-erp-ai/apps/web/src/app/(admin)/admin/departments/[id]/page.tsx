import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import Image from "next/image";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAvatarUrl } from "@/lib/format";

export default async function DepartmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const dept = await db.department
    .findUnique({
      where: { id },
      include: { employees: { orderBy: { name: "asc" } } },
    })
    .catch(() => null);

  if (!dept) notFound();

  return (
    <>
      <PageHeader
        back={{ href: "/admin/departments", label: "Departments" }}
        title={dept.name}
        description={dept.description ?? "No description"}
        actions={
          dept.code ? (
            <Badge variant="outline" className="font-mono">
              {dept.code}
            </Badge>
          ) : undefined
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Members ({dept.employees.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {dept.employees.length === 0 && (
            <p className="text-xs text-muted-foreground">No one assigned yet.</p>
          )}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {dept.employees.map((e) => (
              <Link
                key={e.id}
                href={`/admin/employees/${e.id}`}
                className="flex min-w-0 flex-wrap items-center gap-3 rounded-md border p-3 transition-colors hover:border-primary/50"
              >
                <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-muted">
                  <Image
                    src={e.profilePic ?? getAvatarUrl(e.email)}
                    alt={e.name}
                    fill
                    sizes="36px"
                    className="object-cover"
                    unoptimized
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{e.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {e.jobTitle ?? "—"}
                  </p>
                </div>
                <Badge
                  variant={
                    e.employmentStatus === "ACTIVE"
                      ? "success"
                      : e.employmentStatus === "INACTIVE"
                        ? "secondary"
                        : e.employmentStatus === "ON_LEAVE"
                          ? "warning"
                          : "destructive"
                  }
                  className="shrink-0 text-[10px]"
                >
                  {e.employmentStatus.replace("_", " ")}
                </Badge>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
