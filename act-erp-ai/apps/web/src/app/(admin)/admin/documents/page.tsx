import Link from "next/link";
import { db } from "@/lib/db";
import { PageHeader, StatCard } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, FileText } from "lucide-react";
import { UploadDocumentBulkDialog } from "@/components/upload-document-bulk-dialog";
import { DeleteDocumentButton } from "@/components/delete-document-button";

export const metadata = { title: "Documents" };

const TYPES = ["PERSONAL", "COMPANY", "ONBOARDING", "BENEFITS", "TRAINING"] as const;

export default async function AdminDocumentsPage() {
  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch { return fallback; }
  };

  const [docs, employees] = await Promise.all([
    safe(
      db.document.findMany({
        orderBy: { uploadedAt: "desc" },
        take: 200,
        include: { employee: { select: { name: true, email: true } } },
      }),
      [] as Array<{
        id: string;
        title: string;
        description: string | null;
        fileName: string;
        fileType: string;
        fileUrl: string;
        documentType: string;
        employeeId: string;
        uploadedById: string | null;
        uploaderEmployeeId: string | null;
        uploadedAt: Date;
        employee: { name: string; email: string | null };
      }>,
    ),
    safe(
      db.employee.findMany({
        where: { employmentStatus: { not: "TERMINATED" } },
        orderBy: { name: "asc" },
        select: { id: true, name: true, email: true },
      }),
      [] as Array<{ id: string; name: string; email: string | null }>,
    ),
  ]);

  const counts = TYPES.reduce<Record<string, number>>((acc, t) => {
    acc[t] = docs.filter((d) => d.documentType === t).length;
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        title="Documents"
        description="Upload and manage employee files."
        actions={<UploadDocumentBulkDialog employees={employees} />}
      />
      <div className="grid gap-3 sm:grid-cols-5">
        {TYPES.map((t) => (
          <StatCard key={t} label={t} value={counts[t] ?? 0} icon={<FileText className="h-4 w-4" />} />
        ))}
      </div>

      <Tabs defaultValue="ALL" className="mt-6 space-y-4">
        <TabsList>
          <TabsTrigger value="ALL">All ({docs.length})</TabsTrigger>
          {TYPES.map((t) => (
            <TabsTrigger key={t} value={t}>{t} ({counts[t] ?? 0})</TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="ALL">
          <DocList docs={docs} />
        </TabsContent>
        {TYPES.map((t) => (
          <TabsContent key={t} value={t}>
            <DocList docs={docs.filter((d) => d.documentType === t)} />
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}

type Doc = {
  id: string;
  title: string;
  fileType: string;
  fileUrl: string;
  documentType: string;
  uploadedAt: Date;
  employee: { name: string; email: string | null };
};

function DocList({ docs }: { docs: Doc[] }) {
  if (docs.length === 0)
    return (
      <Card>
        <CardContent className="grid h-32 place-items-center text-xs text-muted-foreground">
          No documents yet.
        </CardContent>
      </Card>
    );
  return (
    <Card>
      <CardContent className="p-0">
        <ul className="divide-y">
          {docs.map((d) => (
            <li key={d.id} className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3 p-3">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{d.title}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {d.employee.name} · {d.fileType}
                </p>
              </div>
              <Badge variant="outline" className="text-[10px]">{d.documentType}</Badge>
              <Link
                href={`/api/documents/${d.id}/file`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border px-2 py-1 text-[10px] hover:bg-muted"
              >
                <Download className="inline h-3 w-3" />
              </Link>
              <DeleteDocumentButton id={d.id} title={d.title} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
