import Image from "next/image";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getAvatarUrl } from "@/lib/format";
import { getPortalLanguage } from "@/lib/portal-i18n/server";

export async function generateMetadata() {
  const { t } = await getPortalLanguage();
  return { title: t("records.team.title") };
}

const PEERS_PAGE_SIZE = 30;

export default async function MyTeamPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { t, locale } = await getPortalLanguage();
  const user = await requireUser();
  const sp = await searchParams;
  const requestedPage = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  if (!user.employeeId)
    return <p className="text-sm text-muted-foreground">{t("records.noEmployee")}</p>;

  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch {
      return fallback;
    }
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
  if (!me)
    return <p className="text-sm text-muted-foreground">{t("records.team.missing")}</p>;

  const peerWhere = me.departmentId
    ? {
        departmentId: me.departmentId,
        id: { not: me.id },
        employmentStatus: "ACTIVE" as const,
      }
    : null;
  const peerTotal = peerWhere
    ? await safe(db.employee.count({ where: peerWhere }), 0)
    : 0;
  const peerPages = Math.max(1, Math.ceil(peerTotal / PEERS_PAGE_SIZE));
  const page = Math.min(requestedPage, peerPages);

  const [reports, peers] = await Promise.all([
    safe(
      db.employee.findMany({
        where: { supervisorId: me.id, employmentStatus: "ACTIVE" },
        orderBy: { name: "asc" },
        include: { department: true },
      }),
      [],
    ),
    peerWhere
      ? safe(
          db.employee.findMany({
            where: peerWhere,
            orderBy: [{ name: "asc" }, { id: "asc" }],
            skip: (page - 1) * PEERS_PAGE_SIZE,
            take: PEERS_PAGE_SIZE,
          }),
          [],
        )
      : Promise.resolve([] as Awaited<ReturnType<typeof db.employee.findMany>>),
  ]);

  return (
    <>
      <PageHeader
        title={t("records.team.title")}
        description={`${me.department?.name ?? "—"} · ${t("records.team.people", { count: new Intl.NumberFormat(locale).format(peerTotal + 1) })}`}
      />

      {/* Org tree: supervisor → me → reports */}
      <div className="space-y-4">
        {me.supervisor && (
          <Section title={t("records.team.reportsTo")}>
            <PersonCard
              id={me.supervisor.id}
              anchor="supervisor"
              name={me.supervisor.name}
              email={me.supervisor.email}
              jobTitle={me.supervisor.jobTitle}
              department={me.supervisor.department?.name}
              profilePic={me.supervisor.profilePic}
              tone="primary"
            />
          </Section>
        )}

        <Section title={t("records.team.me")}>
          <PersonCard
            id={me.id}
            anchor="me"
            name={me.name}
            email={me.email}
            jobTitle={me.jobTitle}
            department={me.department?.name}
            profilePic={me.profilePic}
            tone="self"
          />
        </Section>

        {reports.length > 0 && (
          <Section
            title={t("records.team.directReports", {
              count: new Intl.NumberFormat(locale).format(reports.length),
            })}
          >
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {reports.map((r) => (
                <PersonCard
                  key={r.id}
                  id={r.id}
                  anchor="report"
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
              <CardTitle className="text-base">
                {t("records.team.departmentPeers", {
                  count: new Intl.NumberFormat(locale).format(peerTotal),
                })}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {peers.map((p) => (
                  <PersonCard
                    key={p.id}
                    id={p.id}
                    anchor="peer"
                    name={p.name}
                    email={p.email}
                    jobTitle={p.jobTitle}
                    profilePic={p.profilePic}
                  />
                ))}
              </div>
              {peerPages > 1 && (
                <nav
                  className="mt-4 flex items-center justify-between text-xs"
                  aria-label={t("records.team.pagination")}
                >
                  {page > 1 ? (
                    <Link href={`/dashboard/team?page=${page - 1}`} className="underline">
                      {t("records.team.previous")}
                    </Link>
                  ) : (
                    <span />
                  )}
                  <span className="text-muted-foreground">
                    {t("records.team.page", {
                      page: new Intl.NumberFormat(locale).format(page),
                      pages: new Intl.NumberFormat(locale).format(peerPages),
                    })}
                  </span>
                  {page < peerPages ? (
                    <Link href={`/dashboard/team?page=${page + 1}`} className="underline">
                      {t("records.team.next")}
                    </Link>
                  ) : (
                    <span />
                  )}
                </nav>
              )}
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
      <h2 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function PersonCard({
  id,
  anchor,
  name,
  email,
  jobTitle,
  department,
  profilePic,
  tone,
}: {
  id: string;
  /** Section prefix so the same person appearing in two sections never duplicates a DOM id. */
  anchor: string;
  name: string;
  email: string | null;
  jobTitle?: string | null;
  department?: string;
  profilePic?: string | null;
  tone?: "primary" | "self";
}) {
  const ring =
    tone === "self"
      ? "ring-2 ring-primary"
      : tone === "primary"
        ? "ring-1 ring-primary/30"
        : "";
  return (
    <Link
      id={`${anchor}-${id}`}
      href={`#${anchor}-${id}`}
      className={`flex items-center gap-3 rounded-md border p-3 transition-colors hover:bg-muted/50 ${ring}`}
    >
      <span className="relative h-10 w-10 overflow-hidden rounded-full bg-muted">
        <Image
          src={profilePic ?? getAvatarUrl(email)}
          alt={name}
          fill
          sizes="40px"
          className="object-cover"
          unoptimized
        />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="truncate text-[11px] text-muted-foreground">{jobTitle ?? "—"}</p>
      </div>
      {department && (
        <Badge variant="outline" className="text-[10px]">
          {department}
        </Badge>
      )}
    </Link>
  );
}
