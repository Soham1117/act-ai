import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { PaystubImportClient } from "./import-client";

export const metadata = { title: "Import pay stubs" };

export default async function PaystubImportPage() {
  await requireAdmin();
  const people = await db.employee.findMany({
    where: { employmentStatus: { not: "PENDING_REVIEW" } },
    select: { id: true, name: true, employmentStatus: true },
    orderBy: { name: "asc" },
  });
  const employees = people.map((person) => ({
    id: person.id,
    name: person.name,
    inactive: person.employmentStatus === "INACTIVE" || person.employmentStatus === "TERMINATED",
  }));

  return (
    <>
      <PageHeader
        back={{ href: "/admin/payroll", label: "Payroll" }}
        title="Import pay stubs"
        description="Upload the PDF. Pay periods come from the dates on each stub, and pages that match cleanly are preselected. Only exceptions need your attention."
      />
      <PaystubImportClient employees={employees} />
    </>
  );
}
