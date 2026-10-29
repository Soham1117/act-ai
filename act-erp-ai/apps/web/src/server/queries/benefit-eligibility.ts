import { db } from "@/lib/db";
import { requireAdmin, requireUser } from "@/lib/auth";
import { businessDateOnly } from "@/lib/format";
import {
  assessBenefitEligibility,
  effectiveEligibilityPolicy,
  ELIGIBILITY_TYPES,
} from "@/lib/benefit-eligibility";

export async function adminBenefitEligibilityData() {
  await requireAdmin();
  const [employees, policies, assessments] = await Promise.all([
    db.employee.findMany({
      select: {
        id: true,
        employeeId: true,
        name: true,
        dateOfHire: true,
        employmentStatus: true,
      },
      orderBy: { name: "asc" },
    }),
    db.benefitEligibilityPolicy.findMany({
      orderBy: [{ benefitType: "asc" }, { effectiveFrom: "desc" }],
    }),
    db.benefitEligibilityAssessment.findMany(),
  ]);
  const today = businessDateOnly();
  const rows = employees.flatMap((employee) =>
    ELIGIBILITY_TYPES.map((benefitType) => {
      const assessment =
        assessments.find(
          (a) => a.employeeId === employee.id && a.benefitType === benefitType,
        ) ?? null;
      const policy = effectiveEligibilityPolicy(policies, benefitType, today);
      return {
        employeeId: employee.id,
        employeeCode: employee.employeeId,
        employeeName: employee.name,
        benefitType,
        ...assessBenefitEligibility({
          benefitType,
          hireDate: employee.dateOfHire,
          employmentStatus: employee.employmentStatus,
          assessment,
          policy,
          today,
        }),
      };
    }),
  );
  return {
    today: today.toISOString().slice(0, 10),
    rows,
    employees: employees.map((e) => ({
      ...e,
      dateOfHire: e.dateOfHire?.toISOString().slice(0, 10) ?? null,
    })),
    policies: policies.map((p) => ({
      ...p,
      effectiveFrom: p.effectiveFrom.toISOString().slice(0, 10),
      effectiveTo: p.effectiveTo?.toISOString().slice(0, 10) ?? null,
      confirmedAt: p.confirmedAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    })),
    assessments: assessments.map((a) => ({
      ...a,
      serviceDate: a.serviceDate?.toISOString().slice(0, 10) ?? null,
      confirmedAt: a.confirmedAt?.toISOString() ?? null,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    })),
  };
}

/** Employee ID is always obtained from the current session, never caller input. */
export async function myBenefitEligibility() {
  const user = await requireUser();
  if (!user.employeeId) return [];
  const [employee, policies, assessments, enrollments, elections] = await Promise.all([
    db.employee.findUnique({
      where: { id: user.employeeId },
      select: { dateOfHire: true, employmentStatus: true },
    }),
    db.benefitEligibilityPolicy.findMany(),
    db.benefitEligibilityAssessment.findMany({ where: { employeeId: user.employeeId } }),
    db.benefitEnrollment.findMany({
      where: { employeeId: user.employeeId },
      select: {
        status: true,
        effectiveDate: true,
        endDate: true,
        plan: { select: { type: true, planYearEnd: true } },
      },
      orderBy: { effectiveDate: "desc" },
    }),
    db.retirementElection.findMany({
      where: { employeeId: user.employeeId },
      select: {
        status: true,
        effectiveDate: true,
        endDate: true,
        plan: { select: { type: true, planYearEnd: true } },
      },
      orderBy: { effectiveDate: "desc" },
    }),
  ]);
  if (!employee) return [];
  const today = businessDateOnly();
  return ELIGIBILITY_TYPES.map((benefitType) => {
    const result = assessBenefitEligibility({
      benefitType,
      hireDate: employee.dateOfHire,
      employmentStatus: employee.employmentStatus,
      today,
      assessment: assessments.find((a) => a.benefitType === benefitType) ?? null,
      policy: effectiveEligibilityPolicy(policies, benefitType, today),
    });
    const rows = [...enrollments, ...elections].filter(
      (row) =>
        row.plan.type === benefitType &&
        (!row.endDate || row.endDate > today) &&
        row.plan.planYearEnd >= today,
    );
    const current = rows.find(
      (row) => row.effectiveDate <= today && row.status === "ENROLLED",
    );
    const pending = rows.find(
      (row) =>
        row.status === "PENDING" ||
        (row.status === "ENROLLED" && row.effectiveDate > today),
    );
    const waived = rows.find(
      (row) => row.status === "WAIVED" && row.effectiveDate <= today,
    );
    return {
      benefitType,
      ...result,
      enrollmentLabel: current
        ? "Enrolled"
        : pending
          ? "Pending enrollment"
          : waived
            ? "Waived"
            : null,
    };
  });
}
