import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { aiEnabled } from "@/lib/features";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { DataListCard, ResponsiveDataList } from "@/components/mobile";
import { KnowledgeUploadDialog } from "@/components/knowledge/upload-dialog";
import { KnowledgeRetryButton } from "@/components/knowledge/retry-button";

export const metadata = { title: "Knowledge base" };

export default async function KnowledgePage() {
  if (!aiEnabled) notFound();
  await requireAdmin();
  const docs = await db.knowledgeDocument.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, fileKind: true, visibility: true, status: true, failureReason: true, createdAt: true },
  });

  const table = (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Visibility</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {docs.length === 0 && (
          <TableRow>
            <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
              No documents yet. Upload one to get started.
            </TableCell>
          </TableRow>
        )}
        {docs.map((d) => (
          <TableRow key={d.id}>
            <TableCell className="font-medium">{d.title}</TableCell>
            <TableCell>{d.fileKind}</TableCell>
            <TableCell>{d.visibility === "ORG" ? "Everyone" : "Private"}</TableCell>
            <TableCell>
              <Badge variant={d.status === "READY" ? "default" : d.status === "FAILED" ? "destructive" : "outline"}>
                {d.status.toLowerCase()}
              </Badge>
              {d.status === "FAILED" && d.failureReason && (
                <p className="mt-1 max-w-xs text-xs text-muted-foreground">{d.failureReason}</p>
              )}
              {(d.status === "FAILED" || d.status === "QUEUED") && (
                <KnowledgeRetryButton documentId={d.id} />
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="Knowledge base"
        description="Tool records, BOMs, and operational documents the assistant can search."

      />
      <KnowledgeUploadDialog />

      <ResponsiveDataList
        mobile={
          <div className="space-y-2">
            {docs.length === 0 ? (
              <p className="rounded-md border p-8 text-center text-sm text-muted-foreground">
                No documents yet. Upload one to get started.
              </p>
            ) : (
              docs.map((d) => (
                <DataListCard key={d.id}>
                  <div className="space-y-2">
                    <p className="font-medium">{d.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.fileKind} · {d.visibility === "ORG" ? "Everyone" : "Private"}
                    </p>
                    <Badge variant={d.status === "READY" ? "default" : d.status === "FAILED" ? "destructive" : "outline"}>
                      {d.status.toLowerCase()}
                    </Badge>
                    {d.status === "FAILED" && d.failureReason && (
                      <p className="text-xs text-muted-foreground">{d.failureReason}</p>
                    )}
                    {(d.status === "FAILED" || d.status === "QUEUED") && (
                      <KnowledgeRetryButton documentId={d.id} />
                    )}
                  </div>
                </DataListCard>
              ))
            )}
          </div>
        }
        desktop={table}
      />
    </div>
  );
}
