import Link from "next/link";
import { db } from "@/lib/db";
import { PageHeader, StatCard } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { MobileTabsList } from "@/components/mobile";
import { Download, Eye, FileText } from "lucide-react";
import { UploadDocumentBulkDialog } from "@/components/upload-document-bulk-dialog";
import { DeleteDocumentButton } from "@/components/delete-document-button";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Documents" };

const TYPES = ["PERSONAL", "COMPANY", "ONBOARDING", "BENEFITS", "TRAINING"] as const;

export default async function AdminDocumentsPage() {
  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch { return fallback; }
  };

  const [docs, typeCounts, employees] = await Promise.all([
    safe(
      db.document.findMany({
        orderBy: { uploadedAt: "desc" },
        take: 300,
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
      db.document.groupBy({ by: ["documentType"], _count: { _all: true } }),
      [] as Array<{ documentType: string; _count: { _all: number } }>,
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
    acc[t] = typeCounts.find((c) => c.documentType === t)?._count._all ?? 0;
    return acc;
  }, {});
  const totalDocs = Object.values(counts).reduce((s, n) => s + n, 0);

  return (
    <>
      <PageHeader
        title="Documents"
        description="Upload and manage employee files."
        actions={<div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link href="/admin/documents/company">Company library</Link></Button></div>}
      />
      <div className="mb-6"><UploadDocumentBulkDialog employees={employees} /></div>
      <div className="grid gap-3 sm:grid-cols-5">
        {TYPES.map((t) => (
          <StatCard key={t} label={t} value={counts[t] ?? 0} icon={<FileText className="h-4 w-4" />} />
        ))}
      </div>

      <Tabs defaultValue="ALL" className="mt-6 space-y-4">
        <MobileTabsList>
          <TabsTrigger value="ALL">All ({totalDocs})</TabsTrigger>
          {TYPES.map((t) => (
            <TabsTrigger key={t} value={t}>{t} ({counts[t] ?? 0})</TabsTrigger>
          ))}
        </MobileTabsList>
        <TabsContent value="ALL">
          {totalDocs > docs.length && (
            <p className="mb-2 text-[11px] text-muted-foreground">
              Showing the latest {docs.length} of {totalDocs} documents. Open an employee profile to see all of theirs.
            </p>
          )}
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
            <li key={d.id} className="flex flex-col gap-2 p-3 sm:grid sm:grid-cols-[auto_1fr_auto_auto_auto_auto] sm:items-center sm:gap-3">
              <div className="flex min-w-0 items-start gap-2 sm:contents">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{d.title}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {d.employee.name} · {d.uploadedAt.toLocaleDateString()}
                  </p>
                  <Badge variant="outline" className="mt-1 text-[10px] sm:hidden">{d.documentType}</Badge>
                </div>
              </div>
              <Badge variant="outline" className="hidden text-[10px] sm:inline-flex">{d.documentType}</Badge>
              <div className="flex flex-wrap items-center gap-2 sm:contents">
                <Link
                  href={`/api/documents/${d.id}/file`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border px-2 py-1 text-xs hover:bg-muted md:min-h-9 md:min-w-9"
                >
                  <Eye className="inline h-3 w-3" />
                </Link>
                <a
                  href={`/api/documents/${d.id}/file?download=1`}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border px-2 py-1 text-xs hover:bg-muted md:min-h-9 md:min-w-9"
                  title="Download"
                >
                  <Download className="inline h-3 w-3" />
                </a>
                <DeleteDocumentButton id={d.id} title={d.title} />
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
