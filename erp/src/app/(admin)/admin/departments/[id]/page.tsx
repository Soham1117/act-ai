import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
      <Button variant="ghost" size="sm" asChild className="-ml-2 mb-4">
        <Link href="/admin/departments"><ArrowLeft className="mr-1 h-3.5 w-3.5" /> Departments</Link>
      </Button>

      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">{dept.name}</h1>
          <p className="text-sm text-muted-foreground">
            {dept.description ?? "No description"}
          </p>
        </div>
        {dept.code && <Badge variant="outline" className="font-mono">{dept.code}</Badge>}
      </div>

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
                className="flex items-center gap-3 rounded-md border p-3 transition-colors hover:border-primary/50"
              >
                <span className="relative h-9 w-9 overflow-hidden rounded-full bg-muted">
                  <Image src={e.profilePic ?? getAvatarUrl(e.email)} alt={e.name} fill sizes="36px" className="object-cover" unoptimized />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{e.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{e.jobTitle ?? "—"}</p>
                </div>
                <Badge variant={e.employmentStatus === "ACTIVE" ? "success" : e.employmentStatus === "ON_LEAVE" ? "warning" : "destructive"} className="text-[10px]">
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
