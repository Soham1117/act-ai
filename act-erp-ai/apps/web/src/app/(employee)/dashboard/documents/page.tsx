import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Download, FileText } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UploadDocumentDialog } from "@/components/upload-document-dialog";
import { DeleteDocumentButton } from "@/components/delete-document-button";
import { getPortalLanguage } from "@/lib/portal-i18n/server";

export async function generateMetadata() {
  const { t } = await getPortalLanguage();
  return { title: t("records.documents.title") };
}

const TYPES = ["PERSONAL", "COMPANY", "ONBOARDING", "BENEFITS", "TRAINING"] as const;
const tType = (type: (typeof TYPES)[number]) => `records.documents.type.${type}`;

export default async function MyDocumentsPage() {
  const { t, formatDateTime, locale } = await getPortalLanguage();
  const user = await requireUser();
  if (!user.employeeId)
    return <p className="text-sm text-muted-foreground">{t("records.noEmployee")}</p>;

  const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch {
      return fallback;
    }
  };

  const docs = await safe(
    db.document.findMany({
      where: { employeeId: user.employeeId },
      orderBy: { uploadedAt: "desc" },
    }),
    [],
  );

  const grouped = TYPES.reduce<Record<string, typeof docs>>((acc, t) => {
    acc[t] = docs.filter((d) => d.documentType === t);
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        title={t("records.documents.title")}
        description={t(
          docs.length === 1
            ? "records.documents.description.one"
            : "records.documents.description.other",
          { count: new Intl.NumberFormat(locale).format(docs.length) },
        )}
        actions={
          <UploadDocumentDialog
            allowedTypes={["PERSONAL", "ONBOARDING", "TRAINING"]}
            defaultType="PERSONAL"
          />
        }
      />

      <Tabs defaultValue="ALL" className="space-y-4">
        <TabsList>
          <TabsTrigger value="ALL">
            {t("records.documents.all", {
              count: new Intl.NumberFormat(locale).format(docs.length),
            })}
          </TabsTrigger>
          {TYPES.map((type) => (
            <TabsTrigger key={type} value={type}>
              {t(tType(type))} (
              {new Intl.NumberFormat(locale).format(grouped[type].length)})
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="ALL">
          <DocList
            docs={docs}
            currentUserId={user.id}
            t={t}
            formatDateTime={formatDateTime}
          />
        </TabsContent>
        {TYPES.map((type) => (
          <TabsContent key={type} value={type}>
            <DocList
              docs={grouped[type]}
              currentUserId={user.id}
              t={t}
              formatDateTime={formatDateTime}
            />
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}

type Doc = {
  id: string;
  title: string;
  description: string | null;
  fileType: string;
  fileUrl: string;
  documentType: "PERSONAL" | "COMPANY" | "ONBOARDING" | "BENEFITS" | "TRAINING";
  uploadedAt: Date;
  uploadedById: string | null;
};

function DocList({
  docs,
  currentUserId,
  t,
  formatDateTime,
}: {
  docs: Doc[];
  currentUserId: string;
  t: (key: string, params?: Record<string, string | number>) => string;
  formatDateTime: (value: Date | string | null | undefined) => string;
}) {
  if (docs.length === 0) {
    return (
      <Card>
        <CardContent className="grid h-32 place-items-center text-center text-xs text-muted-foreground">
          <div>
            <FileText className="mx-auto mb-2 h-5 w-5" />
            {t("records.documents.empty")}
          </div>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {docs.map((d) => (
        <Card key={d.id} className="transition-colors hover:border-primary/50">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <FileText className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{d.title}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {d.description ?? d.fileType}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    {t(tType(d.documentType))}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {formatDateTime(d.uploadedAt)}
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Link
                href={`/api/documents/${d.id}/file`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-8 flex-1 items-center justify-center rounded-md border text-xs hover:bg-muted"
              >
                <Download className="mr-1.5 h-3 w-3" /> {t("records.documents.download")}
              </Link>
              {d.uploadedById === currentUserId && (
                <DeleteDocumentButton
                  id={d.id}
                  title={d.title}
                  className="flex h-8 w-8 items-center justify-center rounded-md border text-destructive hover:bg-destructive/10"
                />
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
