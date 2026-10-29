import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { readEmployeePrivateDetails } from "@/server/employee-private-data";
import { safeHirePacketError } from "@/server/hire-packet-sensitive-data";
import { Button } from "@/components/ui/button";
import { HireImportReviewForm } from "./review-form";

export default async function HireImportReviewPage({
  params,
}: {
  params: Promise<{ id: string; jobId: string }>;
}) {
  await requireAdmin();
  const { id: employeeId, jobId } = await params;

  const [storedEmployee, job] = await Promise.all([
    db.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        privateDetails: true,
        name: true,
        phoneNumber: true,
        dateOfBirth: true,
        address: true,
        city: true,
        state: true,
        zipCode: true,
        emergencyName: true,
        emergencyPhone: true,
        nationality: true,
        ssnLast4: true,
        maritalStatus: true,
        personalEmail: true,
        jobTitle: true,
        dateOfHire: true,
        workEmail: true,
      },
    }),
    db.hirePacketImport.findUnique({ where: { id: jobId } }),
  ]);

  if (!storedEmployee || !job || job.employeeId !== employeeId) notFound();
  const employee = await readEmployeePrivateDetails(storedEmployee);

  const currentValues: Record<string, string | null> = {
    name: employee.name,
    phoneNumber: employee.phoneNumber,
    dateOfBirth: employee.dateOfBirth?.toISOString().slice(0, 10) ?? null,
    address: employee.address,
    city: employee.city,
    state: employee.state,
    zipCode: employee.zipCode,
    emergencyName: employee.emergencyName,
    emergencyPhone: employee.emergencyPhone,
    nationality: employee.nationality,
    ssnLast4: employee.ssnLast4,
    maritalStatus: employee.maritalStatus,
    personalEmail: employee.personalEmail,
    jobTitle: employee.jobTitle,
    dateOfHire: employee.dateOfHire?.toISOString().slice(0, 10) ?? null,
    workEmail: employee.workEmail,
  };

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href={`/admin/employees/${employeeId}`}>
            <ArrowLeft className="mr-1 h-3.5 w-3.5" /> {employee.name}
          </Link>
        </Button>
      </div>

      <div className="mb-6">
        <h1 className="text-xl font-semibold">Review hire packet import</h1>
        <p className="text-sm text-muted-foreground">
          {job.zipFileName} · Check each field before applying to the employee profile.
        </p>
      </div>

      <HireImportReviewForm
        jobId={jobId}
        employeeId={employeeId}
        employeeName={employee.name}
        initialStatus={job.status}
        initialError={safeHirePacketError(job.errorMessage)}
        currentValues={currentValues}
      />
    </>
  );
}
