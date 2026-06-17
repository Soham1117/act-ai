import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RequestDialog } from "./request-dialog";
import { formatDistanceToNow } from "date-fns";

export const metadata = { title: "Requests" };

export default async function EmployeeRequestsPage() {
  const user = await requireUser();
  if (!user.employeeId) return <p className="text-sm text-muted-foreground">No employee record.</p>;

  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch { return fallback; }
  };

  const requests = await safe(
    db.request.findMany({
      where: { employeeId: user.employeeId },
      orderBy: { createdAt: "desc" },
      include: { history: { orderBy: { updatedAt: "desc" }, take: 1 } },
    }),
    [],
  );

  return (
    <>
      <PageHeader
        title="Requests"
        description="Submit requests for documents, equipment, training, schedule changes, etc."
        actions={<RequestDialog />}
      />
      <Card>
        <CardHeader><CardTitle className="text-base">My requests ({requests.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y">
            {requests.length === 0 && (
              <li className="grid h-32 place-items-center text-xs text-muted-foreground">
                No requests yet.
              </li>
            )}
            {requests.map((r) => {
              const variant =
                r.status === "COMPLETED" ? "success" :
                r.status === "REJECTED" ? "destructive" :
                r.status === "PROCESSING" ? "warning" :
                r.status === "PENDING" ? "warning" : "outline";
              return (
                <li key={r.id} className="space-y-1 p-3">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{r.title}</p>
                    <Badge variant="outline" className="text-[10px]">{r.type.replace(/_/g, " ")}</Badge>
                    <Badge variant={variant} className="ml-auto text-[10px]">{r.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{r.description}</p>
                  <p className="text-[10px] text-muted-foreground">
                    Submitted {formatDistanceToNow(r.createdAt, { addSuffix: true })}
                    {r.history[0] && ` · last update: ${r.history[0].note ?? r.history[0].status}`}
                  </p>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
