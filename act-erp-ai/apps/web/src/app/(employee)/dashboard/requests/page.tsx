import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RequestDialog } from "./request-dialog";
import { CancelRequestButton } from "./cancel-request-button";
import { getPortalLanguage } from "@/lib/portal-i18n/server";

export async function generateMetadata() {
  const { t } = await getPortalLanguage();
  return { title: t("workspace.requests.title") };
}

export default async function EmployeeRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const user = await requireUser();
  const { t, enumLabel, formatRelative, formatDateOnly } = await getPortalLanguage();
  if (!user.employeeId)
    return <p className="text-sm text-muted-foreground">{t("workspace.noEmployee")}</p>;
  const sp = await searchParams;

  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch {
      return fallback;
    }
  };

  const requests = await safe(
    db.request.findMany({
      where: { employeeId: user.employeeId },
      orderBy: { createdAt: "desc" },
      include: { history: { orderBy: { updatedAt: "desc" } } },
    }),
    [],
  );

  return (
    <>
      <PageHeader
        title={t("workspace.requests.title")}
        description={t("workspace.requests.description")}
        actions={
          <RequestDialog
            initialType={sp.type === "BENEFITS_INQUIRY" ? "BENEFITS_INQUIRY" : undefined}
          />
        }
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("workspace.requests.mine", { count: requests.length })}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y">
            {requests.length === 0 && (
              <li className="grid h-32 place-items-center text-xs text-muted-foreground">
                {t("workspace.requests.empty")}
              </li>
            )}
            {requests.map((r) => {
              const variant =
                r.status === "COMPLETED"
                  ? "success"
                  : r.status === "REJECTED"
                    ? "destructive"
                    : r.status === "PROCESSING"
                      ? "warning"
                      : r.status === "PENDING"
                        ? "warning"
                        : "outline";
              return (
                <li key={r.id} className="space-y-1 p-3">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{r.title}</p>
                    <Badge variant="outline" className="text-[10px]">
                      {enumLabel(r.type)}
                    </Badge>
                    <Badge variant={variant} className="ml-auto text-[10px]">
                      {enumLabel(r.status)}
                    </Badge>
                  </div>
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {r.description}
                  </p>
                  {r.adminNotes && (
                    <p className="text-xs">
                      <span className="font-medium">
                        {t("workspace.requests.adminNote")}
                      </span>{" "}
                      <span className="text-muted-foreground">{r.adminNotes}</span>
                    </p>
                  )}
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>
                      {t("workspace.requests.submitted", {
                        time: formatRelative(r.createdAt),
                      })}
                    </span>
                    {r.status === "PENDING" && <CancelRequestButton id={r.id} />}
                  </div>
                  {r.history.length > 1 && (
                    <details className="text-[11px] text-muted-foreground">
                      <summary className="cursor-pointer">
                        {t("workspace.requests.history", { count: r.history.length })}
                      </summary>
                      <ul className="mt-1 space-y-0.5 pl-3">
                        {r.history.map((h) => (
                          <li key={h.id}>
                            {formatDateOnly(h.updatedAt)} · {enumLabel(h.status)}
                            {h.note ? ` — ${h.note}` : ""}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
