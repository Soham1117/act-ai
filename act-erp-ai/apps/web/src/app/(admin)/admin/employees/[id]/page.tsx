import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  FileText,
  Globe,
  MonitorSmartphone,
  Sparkles,
  PenLine,
} from "lucide-react";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { formatPhone, formatHours, getAvatarUrl, formatSSNLast4 } from "@/lib/format";
import type { TimeEntrySource } from "@prisma/client";
import { getDepartmentConfig } from "@/lib/departments";
import { ChangePasswordModal } from "./change-password-modal";
import { StatusToggle } from "./status-toggle";
import { ResetKioskPinButton } from "./reset-kiosk-pin-button";
import {
  ProfilePicEditor,
  NameEditor,
  PersonalEditableCard,
  EmploymentEditableCard,
  CompensationEditableCard,
} from "./inline-edit";
import { UploadDocumentDialog } from "@/components/upload-document-dialog";
import { DeleteDocumentButton } from "@/components/delete-document-button";
import { BenefitsCard } from "./benefits-card";
import { HirePacketImportButton } from "./hire-packet-import-button";

export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const employee = await db.employee
    .findUnique({
      where: { id },
      include: {
        department: true,
        supervisor: true,
        primaryJobCode: true,
        jobCodes: { include: { jobCode: true } },
        leaveRequests: { orderBy: { startDate: "desc" }, take: 20 },
        timeEntries: {
          orderBy: [{ date: "desc" }, { clockIn: "desc" }],
          take: 30,
        },
        payrollDocs: { orderBy: { payPeriodEnd: "desc" }, take: 20 },
        benefitEnrollments: {
          include: { plan: { select: { id: true, type: true, name: true, costPeriod: true } } },
          orderBy: { effectiveDate: "desc" },
        },
        retirementElections: {
          include: { plan: { select: { id: true, name: true } } },
          orderBy: { effectiveDate: "desc" },
        },
        documents: {
          orderBy: { uploadedAt: "desc" },
          select: {
            id: true,
            title: true,
            documentType: true,
            fileName: true,
            fileUrl: true,
            uploadedAt: true,
          },
        },
      },
    })
    .catch(() => null);

  if (!employee) notFound();

  const [departments, supervisors, jobCodes, activePlans] = await Promise.all([
    db.department.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.employee.findMany({
      where: { id: { not: id }, employmentStatus: { not: "TERMINATED" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.jobCode.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, title: true },
    }),
    db.benefitPlan.findMany({
      where: { isActive: true },
      include: { tiers: true },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    }),
  ]);

  const planOptions = activePlans.map((p) => ({
    id: p.id,
    type: p.type,
    name: p.name,
    carrierName: p.carrierName,
    costPeriod: p.costPeriod,
    tiers: p.tiers.map((t) => ({
      tier: t.tier,
      employeeCost: Number(t.employeeCost),
      employerCost: Number(t.employerCost),
    })),
  }));
  const enrollmentRows = employee.benefitEnrollments.map((e) => ({
    id: e.id,
    tier: e.tier,
    status: e.status,
    effectiveDate: e.effectiveDate.toISOString().slice(0, 10),
    endDate: e.endDate ? e.endDate.toISOString().slice(0, 10) : null,
    memberId: e.memberId,
    confirmedAsOf: e.confirmedAsOf.toISOString().slice(0, 10),
    plan: { id: e.plan.id, type: e.plan.type, name: e.plan.name, costPeriod: e.plan.costPeriod },
  }));
  const electionRows = employee.retirementElections.map((el) => ({
    id: el.id,
    status: el.status,
    effectiveDate: el.effectiveDate.toISOString().slice(0, 10),
    endDate: el.endDate ? el.endDate.toISOString().slice(0, 10) : null,
    preTaxPercent: el.preTaxPercent === null ? null : Number(el.preTaxPercent),
    rothPercent: el.rothPercent === null ? null : Number(el.rothPercent),
    flatAmountPerPay: el.flatAmountPerPay === null ? null : Number(el.flatAmountPerPay),
    plan: { id: el.plan.id, name: el.plan.name },
  }));

  const avatar = employee.profilePic ?? getAvatarUrl(employee.email);
  const deptCfg = employee.department ? getDepartmentConfig(employee.department.name) : null;
  const DeptIcon = deptCfg?.icon;

  const docsByType = (type: typeof employee.documents[number]["documentType"]) =>
    employee.documents.filter((d) => d.documentType === type);

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href="/admin/employees">
            <ArrowLeft className="mr-1 h-3.5 w-3.5" /> All employees
          </Link>
        </Button>
        <div className="flex flex-wrap gap-2">
          <HirePacketImportButton employeeId={employee.id} />
          <ChangePasswordModal employeeId={employee.id} employeeName={employee.name} />
          <ResetKioskPinButton employeeId={employee.id} />
          <StatusToggle employeeId={employee.id} status={employee.employmentStatus} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <ProfilePicEditor
              employeeId={employee.id}
              employeeName={employee.name}
              initialAvatar={avatar}
            />
            <div className="w-full">
              <NameEditor employeeId={employee.id} initialName={employee.name} />
              <p className="text-xs text-muted-foreground">{employee.employeeId}</p>
            </div>
            <Badge
              variant={
                employee.employmentStatus === "ACTIVE"
                  ? "success"
                  : employee.employmentStatus === "ON_LEAVE"
                  ? "warning"
                  : "destructive"
              }
            >
              {employee.employmentStatus.replace("_", " ")}
            </Badge>
            {deptCfg && DeptIcon && (
              <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs ${deptCfg.bgColor} ${deptCfg.color}`}>
                <DeptIcon className="h-3 w-3" />
                {deptCfg.label}
              </span>
            )}
            <Separator className="my-1" />
            <div className="w-full space-y-1.5 text-left text-xs">
              <Row icon={<Mail className="h-3 w-3" />} value={employee.email} />
              <Row icon={<Phone className="h-3 w-3" />} value={formatPhone(employee.phoneNumber)} />
              <Row
                icon={<MapPin className="h-3 w-3" />}
                value={[employee.city, employee.state].filter(Boolean).join(", ") || "—"}
              />
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="basic" className="space-y-4">
          <TabsList className="flex-wrap">
            <TabsTrigger value="basic">Basic info</TabsTrigger>
            <TabsTrigger value="work">Work</TabsTrigger>
            <TabsTrigger value="time-clock">Time clock</TabsTrigger>
            <TabsTrigger value="leave">Leave</TabsTrigger>
            <TabsTrigger value="payroll">Payroll</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
            <TabsTrigger value="benefits">Benefits</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
            <TabsTrigger value="training">Training</TabsTrigger>
          </TabsList>

          <TabsContent value="basic">
            <PersonalEditableCard
              employeeId={employee.id}
              ssnMasked={formatSSNLast4(employee.ssnLast4)}
              initial={{
                gender: employee.gender,
                maritalStatus: employee.maritalStatus ?? "",
                dateOfBirth: employee.dateOfBirth?.toISOString() ?? "",
                nationality: employee.nationality ?? "",
                educationLevel: employee.educationLevel ?? "",
                address: employee.address ?? "",
                city: employee.city ?? "",
                state: employee.state ?? "",
                zipCode: employee.zipCode ?? "",
                phoneNumber: employee.phoneNumber ?? "",
                emergencyName: employee.emergencyName ?? "",
                emergencyPhone: employee.emergencyPhone ?? "",
              }}
            />
          </TabsContent>

          <TabsContent value="work" className="space-y-4">
            <EmploymentEditableCard
              employeeId={employee.id}
              initialDepartmentName={employee.department?.name ?? null}
              initialSupervisorName={employee.supervisor?.name ?? null}
              departments={departments}
              supervisors={supervisors}
              terminationInfo={{
                date: employee.terminationDate?.toISOString() ?? null,
                reason: employee.terminationReason,
              }}
              initial={{
                jobTitle: employee.jobTitle ?? "",
                position: employee.position ?? "",
                jobDescription: employee.jobDescription ?? "",
                dateOfHire: employee.dateOfHire?.toISOString() ?? "",
                employmentType: employee.employmentType,
                workEmail: employee.workEmail ?? "",
                workPhoneNumber: employee.workPhoneNumber ?? "",
                departmentId: employee.departmentId ?? "",
                supervisorId: employee.supervisorId ?? "",
              }}
            />
            <CompensationEditableCard
              employeeId={employee.id}
              jobCodes={jobCodes}
              initial={{
                compensationType: employee.compensationType,
                compensationValue: employee.compensationValue?.toString() ?? "",
                defaultHourlyRate: employee.defaultHourlyRate.toString(),
                primaryJobCodeId: employee.primaryJobCodeId ?? "",
              }}
            />
            <Card>
              <CardHeader><CardTitle className="text-base">Job code assignments ({employee.jobCodes.length})</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {employee.jobCodes.length === 0 && (
                  <p className="text-xs text-muted-foreground">No job codes assigned.</p>
                )}
                {employee.jobCodes.map((a) => (
                  <div key={a.id} className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm">{a.jobCode.code}</span>
                        {a.isPrimary && <Badge variant="secondary" className="text-[10px]">Primary</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">{a.jobCode.title}</p>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground">{a.assignedRate}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="time-clock">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Recent time entries ({employee.timeEntries.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {employee.timeEntries.length === 0 ? (
                  <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                    No time entries yet.
                  </p>
                ) : (
                  <ul className="divide-y">
                    {employee.timeEntries.map((t) => (
                      <li
                        key={t.id}
                        className="grid grid-cols-[100px_1fr_auto_auto_auto] items-center gap-3 px-4 py-2.5 text-sm"
                      >
                        <span className="text-xs text-muted-foreground">
                          {t.date.toLocaleDateString([], {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                        <span className="font-mono text-xs">
                          {t.clockIn.toLocaleTimeString([], {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                          {" → "}
                          {t.clockOut?.toLocaleTimeString([], {
                            hour: "numeric",
                            minute: "2-digit",
                          }) ?? "—"}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {t.jobCode}
                        </span>
                        <SourceBadge
                          source={t.source}
                          kioskLabel={t.kioskLabel}
                        />
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm tabular-nums">
                            {formatHours(t.totalWorkMin)}
                          </span>
                          <Badge
                            variant={
                              t.approvalStatus === "APPROVED"
                                ? "success"
                                : t.approvalStatus === "REJECTED"
                                ? "destructive"
                                : "warning"
                            }
                            className="text-[10px]"
                          >
                            {t.approvalStatus}
                          </Badge>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="leave">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Leave summary · {employee.leavesRemaining}/{employee.totalLeaves} remaining
                </CardTitle>
              </CardHeader>
              <CardContent>
                {employee.leaveRequests.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No leave requests yet.</p>
                ) : (
                  <ul className="divide-y">
                    {employee.leaveRequests.map((l) => (
                      <li key={l.id} className="flex items-center justify-between py-2 text-sm">
                        <div>
                          <p className="font-medium">
                            {l.leaveType.replace(/_/g, " ")} · {l.totalDays}d
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {l.startDate.toLocaleDateString()} → {l.endDate.toLocaleDateString()}
                          </p>
                        </div>
                        <Badge
                          variant={
                            l.status === "APPROVED"
                              ? "success"
                              : l.status === "PENDING"
                              ? "warning"
                              : "destructive"
                          }
                          className="text-[10px]"
                        >
                          {l.status}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="payroll">
            <Card>
              <CardHeader><CardTitle className="text-base">Payroll documents ({employee.payrollDocs.length})</CardTitle></CardHeader>
              <CardContent>
                {employee.payrollDocs.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No payroll documents yet.</p>
                ) : (
                  <ul className="divide-y">
                    {employee.payrollDocs.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{p.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {p.payPeriodStart.toLocaleDateString()} → {p.payPeriodEnd.toLocaleDateString()}
                          </p>
                        </div>
                        <a href={`/api/payroll/${p.id}/file`} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                          <FileText className="h-4 w-4" />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="documents">
            <DocumentSection
              employeeId={employee.id}
              docs={docsByType("PERSONAL").concat(docsByType("ONBOARDING"))}
              emptyHint="No personal or onboarding documents yet."
              allowedTypes={["PERSONAL", "ONBOARDING"]}
              defaultType="PERSONAL"
            />
          </TabsContent>

          <TabsContent value="benefits" className="space-y-4">
            <BenefitsCard
              employeeId={employee.id}
              plans={planOptions}
              enrollments={enrollmentRows}
              elections={electionRows}
            />
            <DocumentSection
              employeeId={employee.id}
              docs={docsByType("BENEFITS")}
              emptyHint="No benefits documents yet."
              allowedTypes={["BENEFITS"]}
              defaultType="BENEFITS"
            />
          </TabsContent>

          <TabsContent value="performance">
            <Card>
              <CardContent className="grid h-32 place-items-center text-center text-xs text-muted-foreground">
                Performance reviews — coming soon.
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="training">
            <DocumentSection
              employeeId={employee.id}
              docs={docsByType("TRAINING")}
              emptyHint="No training records yet."
              allowedTypes={["TRAINING"]}
              defaultType="TRAINING"
            />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

function SourceBadge({
  source,
  kioskLabel,
}: {
  source: TimeEntrySource;
  kioskLabel: string | null;
}) {
  const cfg: Record<TimeEntrySource, { label: string; icon: React.ReactNode }> = {
    KIOSK: { label: "Kiosk", icon: <MonitorSmartphone className="h-3 w-3" /> },
    WEB: { label: "Web", icon: <Globe className="h-3 w-3" /> },
    AUTO: { label: "Auto", icon: <Sparkles className="h-3 w-3" /> },
    MANUAL: { label: "Manual", icon: <PenLine className="h-3 w-3" /> },
  };
  const { label, icon } = cfg[source];
  const display = source === "KIOSK" && kioskLabel ? kioskLabel : label;
  return (
    <span
      title={source === "KIOSK" && kioskLabel ? `Kiosk: ${kioskLabel}` : undefined}
      className="inline-flex max-w-[160px] items-center gap-1 truncate rounded border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground"
    >
      {icon}
      <span className="truncate">{display}</span>
    </span>
  );
}

type DocType = "PERSONAL" | "COMPANY" | "ONBOARDING" | "BENEFITS" | "TRAINING";

function DocumentSection({
  employeeId,
  docs,
  emptyHint,
  allowedTypes,
  defaultType,
}: {
  employeeId: string;
  docs: Array<{ id: string; title: string; fileName: string; fileUrl: string; uploadedAt: Date; documentType: DocType }>;
  emptyHint: string;
  allowedTypes: readonly DocType[];
  defaultType: DocType;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Documents ({docs.length})</CardTitle>
        <UploadDocumentDialog
          employeeId={employeeId}
          allowedTypes={allowedTypes}
          defaultType={defaultType}
        />
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {docs.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">{emptyHint}</p>
        ) : (
          <ul className="divide-y">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{d.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.documentType} · {d.uploadedAt.toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={`/api/documents/${d.id}/file`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border px-2 py-1 text-primary hover:bg-muted"
                    title="Open"
                  >
                    <FileText className="h-3.5 w-3.5" />
                  </a>
                  <DeleteDocumentButton id={d.id} title={d.title} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ icon, value }: { icon: React.ReactNode; value: string | null | undefined }) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <span className="opacity-60">{icon}</span>
      <span className="truncate">{value ?? "—"}</span>
    </div>
  );
}
