import Image from "next/image";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getAvatarUrl } from "@/lib/format";

export const metadata = { title: "My team" };

export default async function MyTeamPage() {
  const user = await requireUser();
  if (!user.employeeId) return <p className="text-sm text-muted-foreground">No employee record.</p>;

  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch { return fallback; }
  };

  const me = await safe(
    db.employee.findUnique({
      where: { id: user.employeeId },
      include: {
        department: true,
        supervisor: { include: { department: true } },
      },
    }),
    null,
  );
  if (!me) return <p className="text-sm text-muted-foreground">Employee record missing.</p>;

  const [reports, peers] = await Promise.all([
    safe(
      db.employee.findMany({
        where: { supervisorId: me.id, employmentStatus: "ACTIVE" },
        orderBy: { name: "asc" },
        include: { department: true },
      }),
      [],
    ),
    me.departmentId
      ? safe(
          db.employee.findMany({
            where: {
              departmentId: me.departmentId,
              id: { not: me.id },
              employmentStatus: "ACTIVE",
            },
            orderBy: { name: "asc" },
            take: 25,
          }),
          [],
        )
      : Promise.resolve([] as Awaited<ReturnType<typeof db.employee.findMany>>),
  ]);

  return (
    <>
      <PageHeader
        title="My team"
        description={`${me.department?.name ?? "—"} · ${peers.length + 1} people`}
      />

      {/* Org tree: supervisor → me → reports */}
      <div className="space-y-4">
        {me.supervisor && (
          <Section title="Reports to">
            <PersonCard
              id={me.supervisor.id}
              name={me.supervisor.name}
              email={me.supervisor.email}
              jobTitle={me.supervisor.jobTitle}
              department={me.supervisor.department?.name}
              profilePic={me.supervisor.profilePic}
              tone="primary"
            />
          </Section>
        )}

        <Section title="Me">
          <PersonCard
            id={me.id}
            name={me.name}
            email={me.email}
            jobTitle={me.jobTitle}
            department={me.department?.name}
            profilePic={me.profilePic}
            tone="self"
          />
        </Section>

        {reports.length > 0 && (
          <Section title={`Direct reports (${reports.length})`}>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {reports.map((r) => (
                <PersonCard
                  key={r.id}
                  id={r.id}
                  name={r.name}
                  email={r.email}
                  jobTitle={r.jobTitle}
                  department={r.department?.name}
                  profilePic={r.profilePic}
                />
              ))}
            </div>
          </Section>
        )}

        {peers.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Department peers ({peers.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {peers.map((p) => (
                  <PersonCard
                    key={p.id}
                    id={p.id}
                    name={p.name}
                    email={p.email}
                    jobTitle={p.jobTitle}
                    profilePic={p.profilePic}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function PersonCard({
  id,
  name,
  email,
  jobTitle,
  department,
  profilePic,
  tone,
}: {
  id: string;
  name: string;
  email: string | null;
  jobTitle?: string | null;
  department?: string;
  profilePic?: string | null;
  tone?: "primary" | "self";
}) {
  const ring =
    tone === "self"  ? "ring-2 ring-primary"  :
    tone === "primary" ? "ring-1 ring-primary/30" :
    "";
  return (
    <Link
      href={`/dashboard/team#${id}`}
      className={`flex items-center gap-3 rounded-md border p-3 transition-colors hover:bg-muted/50 ${ring}`}
    >
      <span className="relative h-10 w-10 overflow-hidden rounded-full bg-muted">
        <Image src={profilePic ?? getAvatarUrl(email)} alt={name} fill sizes="40px" className="object-cover" unoptimized />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="truncate text-[11px] text-muted-foreground">{jobTitle ?? "—"}</p>
      </div>
      {department && (
        <Badge variant="outline" className="text-[10px]">{department}</Badge>
      )}
    </Link>
  );
}
