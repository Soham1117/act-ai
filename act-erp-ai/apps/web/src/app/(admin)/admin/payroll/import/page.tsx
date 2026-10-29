import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { PaystubImportClient } from "./import-client";

export const metadata = { title: "Import pay stubs" };

export default async function PaystubImportPage() {
  await requireAdmin();
  const [calendarPeriods, employees] = await Promise.all([
    db.payrollCalendar.findMany({ orderBy: { payDate: "desc" } }),
    db.employee.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Import pay stubs"
        description="Analyze PDFs, verify Name/SSN matches in the table, then save selected pages."
        actions={
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/payroll">
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              Payroll
            </Link>
          </Button>
        }
      />
      <PaystubImportClient calendarPeriods={calendarPeriods} employees={employees} />
    </>
  );
}
