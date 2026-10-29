import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { COMPANY_CATEGORIES } from "@/lib/company-documents";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { CompanyLibrary } from "./company-library";

export const metadata = {title: "Company library"};

export default async function CompanyLibraryPage({searchParams}: {searchParams: Promise<Record<string, string | string[] | undefined>>}) {
  await requireAdmin();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 200) : "";
  const category = typeof sp.category === "string" && sp.category in COMPANY_CATEGORIES ? sp.category : "";
  const year = typeof sp.year === "string" && /^\d{4}$/.test(sp.year) ? Number(sp.year) : null;
  const quarter = typeof sp.quarter === "string" && /^[1-4]$/.test(sp.quarter) ? Number(sp.quarter) : null;
  const archived = sp.archived === "1";
  const documents = await db.companyDocument.findMany({
    where: {
      ...(archived ? {} : {isArchived: false}), ...(category ? {category} : {}),
      ...(q ? {OR: [{title: {contains: q, mode: "insensitive"}}, {issuer: {contains: q, mode: "insensitive"}}]} : {}),
      ...(year || quarter ? {versions: {some: {...(year ? {year} : {}), ...(quarter ? {quarter} : {})}}} : {}),
    }, orderBy: {updatedAt: "desc"}, take: 200,
    include: {versions: {orderBy: {version: "desc"}}},
  });
  return <>
    <PageHeader title="Company library" description="Private HR and compliance records. Uploads stay in HR until you approve a specific version for use." actions={<Button asChild variant="outline"><Link href="/admin/documents">Employee documents</Link></Button>} />
    <CompanyLibrary documents={documents.map((d) => ({...d, createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString(), versions: d.versions.map((v) => ({...v, createdAt: v.createdAt.toISOString(), approvedAt: v.approvedAt?.toISOString() ?? null, effectiveDate: v.effectiveDate?.toISOString().slice(0, 10) ?? null, periodStart: v.periodStart?.toISOString().slice(0, 10) ?? null, periodEnd: v.periodEnd?.toISOString().slice(0, 10) ?? null}))}))} filters={{q, category, year: year?.toString() ?? "", quarter: quarter?.toString() ?? "", archived}} />
  </>;
}
