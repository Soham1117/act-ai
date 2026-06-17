import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OnboardingActions, RowActions } from "./actions";

export const metadata = { title: "Onboarding" };

export default async function OnboardingPage() {
  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch { return fallback; }
  };

  const invites = await safe(
    db.onboardingInvite.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    [],
  );

  const pending = invites.filter((i) => i.status === "PENDING" && i.expiresAt > new Date());
  const completed = invites.filter((i) => i.status === "COMPLETED");
  const expired = invites.filter(
    (i) => i.status === "EXPIRED" || (i.status === "PENDING" && i.expiresAt <= new Date()),
  );

  return (
    <>
      <PageHeader
        title="Onboarding"
        description={`${pending.length} pending · ${completed.length} completed · ${expired.length} expired`}
        actions={<OnboardingActions />}
      />

      <Card>
        <CardContent className="p-0">
          {invites.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No invites yet. Generate one with the button above.
            </p>
          ) : (
            <ul className="divide-y">
              {invites.map((i) => {
                const isPending = i.status === "PENDING" && i.expiresAt > new Date();
                const isExpired = i.status === "EXPIRED" || (i.status === "PENDING" && i.expiresAt <= new Date());
                const variant = i.status === "COMPLETED" ? "success" : isExpired ? "destructive" : "warning";
                return (
                  <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium">{i.email ?? "(no email)"}</p>
                        <Badge variant={variant} className="text-[10px]">
                          {i.status === "COMPLETED"
                            ? "Completed"
                            : isExpired
                            ? "Expired"
                            : "Pending"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Created {i.createdAt.toLocaleDateString()} · expires{" "}
                        {i.expiresAt.toLocaleDateString()}
                      </p>
                    </div>
                    {isPending && <RowActions inviteId={i.id} token={i.token} />}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
