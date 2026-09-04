import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Mail,
  Phone,
  MapPin,
  FileText,
  Globe,
  HeartPulse,
  MonitorSmartphone,
  Sparkles,
  PenLine,
} from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  formatPhone,
  formatHours,
  formatCurrency,
  getAvatarUrl,
  formatSSNLast4,
  formatBusinessTime,
  formatDateOnly,
} from "@/lib/format";
import type { TimeEntrySource } from "@prisma/client";
import { getDepartmentConfig } from "@/lib/departments";

export const metadata = { title: "My details" };

export default async function MyDetailsPage() {
  const user = await requireUser();
  if (!user.employeeId) notFound();

  const employee = await db.employee
    .findUnique({
      where: { id: user.employeeId },
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

  const avatar = employee.profilePic ?? getAvatarUrl(employee.email);
  const deptCfg = employee.department
    ? getDepartmentConfig(employee.department.name)
    : null;
  const DeptIcon = deptCfg?.icon;

  const docsByType = (type: (typeof employee.documents)[number]["documentType"]) =>
    employee.documents.filter((d) => d.documentType === type);

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
          <div className="relative h-24 w-24 overflow-hidden rounded-full border bg-muted">
            <Image
              src={avatar}
              alt={employee.name}
              fill
              sizes="96px"
              className="object-cover"
              unoptimized
            />
          </div>
          <div className="w-full">
            <p className="truncate text-base font-semibold">{employee.name}</p>
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
            <span
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs ${deptCfg.bgColor} ${deptCfg.color}`}
            >
              <DeptIcon className="h-3 w-3" />
              {deptCfg.label}
            </span>
          )}
          <Separator className="my-1" />
          <div className="w-full space-y-1.5 text-left text-xs">
            <Row icon={<Mail className="h-3 w-3" />} value={employee.email} />
            <Row
              icon={<Phone className="h-3 w-3" />}
              value={formatPhone(employee.phoneNumber)}
            />
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
          <TabsTrigger value="training">Training</TabsTrigger>
        </TabsList>

        <TabsContent value="basic" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Personal</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <Field label="Gender" value={employee.gender} />
              <Field label="Marital status" value={employee.maritalStatus} />
              <Field
                label="Date of birth"
                value={employee.dateOfBirth?.toLocaleDateString()}
              />
              <Field label="Nationality" value={employee.nationality} />
              <Field label="Education" value={employee.educationLevel} />
              <Field label="SSN" value={formatSSNLast4(employee.ssnLast4)} />
              <Field label="Phone" value={formatPhone(employee.phoneNumber)} />
              <Field
                label="Address"
                value={
                  [employee.address, employee.city, employee.state, employee.zipCode]
                    .filter(Boolean)
                    .join(", ") || "—"
                }
              />
              <Field label="Emergency contact" value={employee.emergencyName} />
              <Field
                label="Emergency phone"
                value={formatPhone(employee.emergencyPhone)}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="work" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Employment</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <Field label="Job title" value={employee.jobTitle} />
              <Field label="Position" value={employee.position} />
              <Field label="Department" value={employee.department?.name} />
              <Field label="Supervisor" value={employee.supervisor?.name} />
              <Field
                label="Date of hire"
                value={employee.dateOfHire?.toLocaleDateString()}
              />
              <Field
                label="Employment type"
                value={employee.employmentType.replace(/_/g, " ")}
              />
              <Field label="Work email" value={employee.workEmail} />
              <Field label="Work phone" value={formatPhone(employee.workPhoneNumber)} />
              {employee.terminationDate && (
                <>
                  <Field
                    label="Termination date"
                    value={employee.terminationDate.toLocaleDateString()}
                  />
                  <Field label="Termination reason" value={employee.terminationReason} />
                </>
              )}
              {employee.jobDescription && (
                <div className="sm:col-span-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Job description
                  </p>
                  <p className="mt-1 whitespace-pre-line text-sm">
                    {employee.jobDescription}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Compensation</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <Field
                label="Compensation type"
                value={employee.compensationType.replace(/_/g, " ")}
              />
              <Field
                label="Compensation value"
                value={
                  employee.compensationValue
                    ? formatCurrency(Number(employee.compensationValue.toString()))
                    : "—"
                }
              />
              <Field
                label="Default hourly rate"
                value={`${formatCurrency(Number(employee.defaultHourlyRate.toString()))}/hr`}
              />
              <Field
                label="Primary job code"
                value={
                  employee.primaryJobCode
                    ? `${employee.primaryJobCode.code} · ${employee.primaryJobCode.title}`
                    : "—"
                }
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Job code assignments ({employee.jobCodes.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {employee.jobCodes.length === 0 && (
                <p className="text-xs text-muted-foreground">No job codes assigned.</p>
              )}
              {employee.jobCodes.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">{a.jobCode.code}</span>
                      {a.isPrimary && (
                        <Badge variant="secondary" className="text-[10px]">
                          Primary
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{a.jobCode.title}</p>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">
                    {a.assignedRate}
                  </span>
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
                        {formatDateOnly(t.date)}
                      </span>
                      <span className="font-mono text-xs">
                        {formatBusinessTime(t.clockIn)}
                        {" → "}
                        {formatBusinessTime(t.clockOut)}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {t.jobCode}
                      </span>
                      <SourceBadge source={t.source} kioskLabel={t.kioskLabel} />
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
                Leave summary · {employee.leavesRemaining}/{employee.totalLeaves}{" "}
                remaining
              </CardTitle>
            </CardHeader>
            <CardContent>
              {employee.leaveRequests.length === 0 ? (
                <p className="text-xs text-muted-foreground">No leave requests yet.</p>
              ) : (
                <ul className="divide-y">
                  {employee.leaveRequests.map((l) => (
                    <li
                      key={l.id}
                      className="flex items-center justify-between py-2 text-sm"
                    >
                      <div>
                        <p className="font-medium">
                          {l.leaveType.replace(/_/g, " ")} · {l.totalDays}d
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {l.startDate.toLocaleDateString()} →{" "}
                          {l.endDate.toLocaleDateString()}
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
            <CardHeader>
              <CardTitle className="text-base">
                Payroll documents ({employee.payrollDocs.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {employee.payrollDocs.length === 0 ? (
                <p className="text-xs text-muted-foreground">No payroll documents yet.</p>
              ) : (
                <ul className="divide-y">
                  {employee.payrollDocs.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center justify-between gap-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{p.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {p.payPeriodStart.toLocaleDateString()} →{" "}
                          {p.payPeriodEnd.toLocaleDateString()}
                        </p>
                      </div>
                      <a
                        href={`/api/payroll/${p.id}/file`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
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
          <DocumentList
            docs={docsByType("PERSONAL").concat(docsByType("ONBOARDING"))}
            emptyHint="No personal or onboarding documents yet."
            title="Documents"
          />
        </TabsContent>

        <TabsContent value="benefits">
          <Card>
            <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
              <HeartPulse className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Your medical, dental, vision, and 401(k) info now lives on a dedicated
                page.
              </p>
              <Button asChild size="sm">
                <Link href="/dashboard/benefits">Go to Benefits</Link>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="training">
          <DocumentList
            docs={docsByType("TRAINING")}
            emptyHint="No training records yet."
            title="Training"
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-sm">{value ?? "—"}</p>
    </div>
  );
}

function Row({
  icon,
  value,
}: {
  icon: React.ReactNode;
  value: string | null | undefined;
}) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <span className="opacity-60">{icon}</span>
      <span className="truncate">{value ?? "—"}</span>
    </div>
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

function DocumentList({
  docs,
  emptyHint,
  title,
}: {
  docs: Array<{
    id: string;
    title: string;
    fileName: string;
    fileUrl: string;
    uploadedAt: Date;
    documentType: DocType;
  }>;
  emptyHint: string;
  title: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {title} ({docs.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {docs.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">{emptyHint}</p>
        ) : (
          <ul className="divide-y">
            {docs.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{d.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.documentType} · {d.uploadedAt.toLocaleDateString()}
                  </p>
                </div>
                <a
                  href={`/api/documents/${d.id}/file`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border px-2 py-1 text-primary hover:bg-muted"
                  title="Open"
                >
                  <FileText className="h-3.5 w-3.5" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
