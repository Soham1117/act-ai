import { requireAdmin } from "@/lib/auth";
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
import { KnowledgeUploadDialog } from "@/components/knowledge/upload-dialog";

export const metadata = { title: "Knowledge base" };

export default async function KnowledgePage() {
  await requireAdmin();
  const docs = await db.knowledgeDocument.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, fileKind: true, visibility: true, status: true, createdAt: true },
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Knowledge base</h1>
          <p className="text-sm text-muted-foreground">
            Tool records, BOMs, and operational documents the assistant can search.
          </p>
        </div>
        <KnowledgeUploadDialog />
      </div>

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
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
