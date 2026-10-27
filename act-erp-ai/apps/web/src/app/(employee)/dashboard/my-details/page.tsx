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
import { LeaveBalanceSummary } from "@/components/leave-balance-summary";
import { loadLeaveBalances } from "@/lib/leave-balance-db";
import { requireUser } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { formatPhone, formatHours, getAvatarUrl, formatSSNLast4 } from "@/lib/format";
import type { TimeEntrySource } from "@prisma/client";
import { getDepartmentConfig } from "@/lib/departments";
import { getPortalLanguage } from "@/lib/portal-i18n/server";

export async function generateMetadata() {
  const { t } = await getPortalLanguage();
  return { title: t("account.details.title") };
}

export default async function MyDetailsPage() {
  const user = await requireUser();
  const { t, enumLabel, formatCurrency, formatDateOnly, formatTime } =
    await getPortalLanguage();
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

  const leaveBalances = await loadLeaveBalances(employee.id).catch(() => null);

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
                : employee.employmentStatus === "INACTIVE"
                  ? "secondary"
                : employee.employmentStatus === "ON_LEAVE"
                  ? "warning"
                  : "destructive"
            }
          >
            {enumLabel(employee.employmentStatus)}
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
          <TabsTrigger value="basic">{t("account.details.tab.basic")}</TabsTrigger>
          <TabsTrigger value="work">{t("account.details.tab.work")}</TabsTrigger>
          <TabsTrigger value="time-clock">
            {t("account.details.tab.timeClock")}
          </TabsTrigger>
          <TabsTrigger value="leave">{t("account.details.tab.leave")}</TabsTrigger>
          <TabsTrigger value="payroll">{t("account.details.tab.payroll")}</TabsTrigger>
          <TabsTrigger value="documents">
            {t("account.details.tab.documents")}
          </TabsTrigger>
          <TabsTrigger value="benefits">{t("account.details.tab.benefits")}</TabsTrigger>
          <TabsTrigger value="training">{t("account.details.tab.training")}</TabsTrigger>
        </TabsList>

        <TabsContent value="basic" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("account.details.personal")}</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <Field
                label={t("account.details.gender")}
                value={enumLabel(employee.gender)}
              />
              <Field
                label={t("account.details.maritalStatus")}
                value={
                  employee.maritalStatus ? enumLabel(employee.maritalStatus) : undefined
                }
              />
              <Field
                label={t("account.details.dateOfBirth")}
                value={formatDateOnly(employee.dateOfBirth)}
              />
              <Field
                label={t("account.details.nationality")}
                value={employee.nationality}
              />
              <Field
                label={t("account.details.education")}
                value={employee.educationLevel}
              />
              <Field
                label={t("account.details.ssn")}
                value={formatSSNLast4(employee.ssnLast4)}
              />
              <Field
                label={t("account.details.phone")}
                value={formatPhone(employee.phoneNumber)}
              />
              <Field
                label={t("account.details.address")}
                value={
                  [employee.address, employee.city, employee.state, employee.zipCode]
                    .filter(Boolean)
                    .join(", ") || "—"
                }
              />
              <Field
                label={t("account.details.emergencyContact")}
                value={employee.emergencyName}
              />
              <Field
                label={t("account.details.emergencyPhone")}
                value={formatPhone(employee.emergencyPhone)}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="work" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("account.details.employment")}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <Field label={t("account.details.jobTitle")} value={employee.jobTitle} />
              <Field label={t("account.details.position")} value={employee.position} />
              <Field
                label={t("account.details.department")}
                value={employee.department?.name}
              />
              <Field
                label={t("account.details.supervisor")}
                value={employee.supervisor?.name}
              />
              <Field
                label={t("account.details.dateOfHire")}
                value={formatDateOnly(employee.dateOfHire)}
              />
              <Field
                label={t("account.details.employmentType")}
                value={enumLabel(employee.employmentType)}
              />
              <Field label={t("account.details.workEmail")} value={employee.workEmail} />
              <Field
                label={t("account.details.workPhone")}
                value={formatPhone(employee.workPhoneNumber)}
              />
              {employee.terminationDate && (
                <>
                  <Field
                    label={t("account.details.terminationDate")}
                    value={formatDateOnly(employee.terminationDate)}
                  />
                  <Field
                    label={t("account.details.terminationReason")}
                    value={employee.terminationReason}
                  />
                </>
              )}
              {employee.jobDescription && (
                <div className="sm:col-span-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {t("account.details.jobDescription")}
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
              <CardTitle className="text-base">
                {t("account.details.compensation")}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <Field
                label={t("account.details.compensationType")}
                value={enumLabel(employee.compensationType)}
              />
              <Field
                label={t("account.details.compensationValue")}
                value={
                  employee.compensationValue
                    ? formatCurrency(Number(employee.compensationValue.toString()))
                    : "—"
                }
              />
              <Field
                label={t("account.details.defaultHourlyRate")}
                value={t("account.details.hourlyRate", {
                  amount: formatCurrency(Number(employee.defaultHourlyRate.toString())),
                })}
              />
              <Field
                label={t("account.details.primaryJobCode")}
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
                {t("account.details.jobCodeAssignments", {
                  count: employee.jobCodes.length,
                })}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {employee.jobCodes.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("account.details.noJobCodes")}
                </p>
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
                          {t("account.details.primary")}
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
                {t("account.details.recentTimeEntries", {
                  count: employee.timeEntries.length,
                })}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {employee.timeEntries.length === 0 ? (
                <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                  {t("account.details.noTimeEntries")}
                </p>
              ) : (
                <ul className="divide-y">
                  {employee.timeEntries.map((entry) => (
                    <li
                      key={entry.id}
                      className="grid grid-cols-[100px_1fr_auto_auto_auto] items-center gap-3 px-4 py-2.5 text-sm"
                    >
                      <span className="text-xs text-muted-foreground">
                        {formatDateOnly(entry.date)}
                      </span>
                      <span className="font-mono text-xs">
                        {formatTime(entry.clockIn)}
                        {" → "}
                        {formatTime(entry.clockOut)}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {entry.jobCode}
                      </span>
                      <SourceBadge
                        source={entry.source}
                        kioskLabel={entry.kioskLabel}
                        sourceLabel={enumLabel(entry.source)}
                        kioskTitle={
                          entry.kioskLabel
                            ? t("account.details.kioskTitle", { name: entry.kioskLabel })
                            : undefined
                        }
                      />
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm tabular-nums">
                          {formatHours(entry.totalWorkMin)}
                        </span>
                        <Badge
                          variant={
                            entry.approvalStatus === "APPROVED"
                              ? "success"
                              : entry.approvalStatus === "REJECTED"
                                ? "destructive"
                                : "warning"
                          }
                          className="text-[10px]"
                        >
                          {enumLabel(entry.approvalStatus)}
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
                {t("account.details.leaveSummary", {
                  available: leaveBalances?.totals.available ?? "—",
                  allowed: leaveBalances?.totals.allowed ?? "—",
                })}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <LeaveBalanceSummary balances={leaveBalances} />
              {employee.leaveRequests.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("account.details.noLeaveRequests")}
                </p>
              ) : (
                <ul className="divide-y">
                  {employee.leaveRequests.map((l) => (
                    <li
                      key={l.id}
                      className="flex items-center justify-between py-2 text-sm"
                    >
                      <div>
                        <p className="font-medium">
                          {enumLabel(l.leaveType)} · {Number(l.totalDays)}
                          {t("account.details.daysShort")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDateOnly(l.startDate)} → {formatDateOnly(l.endDate)}
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
                        {enumLabel(l.status)}
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
                {t("account.details.payrollDocuments", {
                  count: employee.payrollDocs.length,
                })}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {employee.payrollDocs.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("account.details.noPayrollDocuments")}
                </p>
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
                          {formatDateOnly(p.payPeriodStart)} →{" "}
                          {formatDateOnly(p.payPeriodEnd)}
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
            emptyHint={t("account.details.noPersonalDocs")}
            title={t("account.details.tab.documents")}
            t={t}
            enumLabel={enumLabel}
            formatDateOnly={formatDateOnly}
          />
        </TabsContent>

        <TabsContent value="benefits">
          <Card>
            <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
              <HeartPulse className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {t("account.details.benefitsRedirect")}
              </p>
              <Button asChild size="sm">
                <Link href="/dashboard/benefits">
                  {t("account.details.goToBenefits")}
                </Link>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="training">
          <DocumentList
            docs={docsByType("TRAINING")}
            emptyHint={t("account.details.noTrainingRecords")}
            title={t("account.details.tab.training")}
            t={t}
            enumLabel={enumLabel}
            formatDateOnly={formatDateOnly}
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
  sourceLabel,
  kioskTitle,
}: {
  source: TimeEntrySource;
  kioskLabel: string | null;
  sourceLabel: string;
  kioskTitle?: string;
}) {
  const cfg: Record<TimeEntrySource, React.ReactNode> = {
    KIOSK: <MonitorSmartphone className="h-3 w-3" />,
    WEB: <Globe className="h-3 w-3" />,
    AUTO: <Sparkles className="h-3 w-3" />,
    MANUAL: <PenLine className="h-3 w-3" />,
  };
  const display = source === "KIOSK" && kioskLabel ? kioskLabel : sourceLabel;
  return (
    <span
      title={source === "KIOSK" && kioskLabel ? kioskTitle : undefined}
      className="inline-flex max-w-[160px] items-center gap-1 truncate rounded border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground"
    >
      {cfg[source]}
      <span className="truncate">{display}</span>
    </span>
  );
}

type DocType = "PERSONAL" | "COMPANY" | "ONBOARDING" | "BENEFITS" | "TRAINING";

function DocumentList({
  docs,
  emptyHint,
  title,
  t,
  enumLabel,
  formatDateOnly,
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
  t: (key: string, params?: Record<string, string | number>) => string;
  enumLabel: (code: string) => string;
  formatDateOnly: (value: Date | string | null | undefined) => string;
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
                    {enumLabel(d.documentType)} · {formatDateOnly(d.uploadedAt)}
                  </p>
                </div>
                <a
                  href={`/api/documents/${d.id}/file`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border px-2 py-1 text-primary hover:bg-muted"
                  title={t("account.details.openDocument")}
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
