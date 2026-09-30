"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { writable } from "@/lib/auth/writable";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { audit } from "@/lib/audit";
import { uploadFile } from "@/lib/storage";
import { validateUpload } from "@/lib/upload-validation";
import { notifyEmployees } from "@/lib/notify";
import { ok, fail, failFromUnknown, type ActionResult } from "@/lib/action-result";
import { resolveEmailHireMode, generateEmployeeId } from "@/lib/employee-create";
import {
  normalizeEmail,
  nullableNormalizedEmail,
  optionalNormalizedEmail,
  optionalNormalizedUsername,
} from "@/lib/identity";
import {
  auditDiff,
  checkDateOfBirth,
  checkDateOfHire,
  checkTerminationDate,
  createsSupervisorCycle,
  readOnlyUntil,
  todayDateString,
} from "@/lib/employee-validation";
import { TERMINATION_GRACE_DAYS } from "@/lib/access";
import { env } from "@/lib/env";
import { DEFAULT_KIOSK_PIN } from "@/lib/kiosk-pin";

/* -------------------------------------------------------------------------- */
/* Create                                                                     */
/* -------------------------------------------------------------------------- */

const employeeSchema = z
  .object({
    name: z.string().trim().min(2),
    email: optionalNormalizedEmail,
    // Only for employees with no company email — they log in with this instead.
    username: optionalNormalizedUsername,
    // Where 2FA sign-in codes go — deliberately separate from the login email
    // above, since some employees have no company email at all.
    personalEmail: optionalNormalizedEmail,
    // Last 4 digits only — we deliberately never collect the full SSN.
    ssnLast4: z
      .string()
      .regex(/^\d{4}$/, "Enter the last 4 digits of the SSN")
      .optional(),
    gender: z.enum(["MALE", "FEMALE", "OTHER"]),
    departmentId: z.string().optional().nullable(),
    jobTitle: z.string().trim().optional().nullable(),
    phoneNumber: z.string().trim().optional().nullable(),
    employmentType: z.enum(["FULL_PART_TIME", "CONTRACT_HOURLY"]),
    compensationType: z.enum(["MONTHLY_SALARY", "HOURLY_RATE", "TOTAL_COMPENSATION"]),
    compensationValue: z.coerce.number().min(0, "Pay can't be negative").optional().nullable(),
    password: z.string().min(8, "Password must be at least 8 characters"),
  })
  .refine((value) => value.email || value.username, {
    message: "Provide either a work email or a username",
    path: ["username"],
  });

export async function createEmployee(
  input: z.input<typeof employeeSchema>,
): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  try {
    const data = employeeSchema.parse(input);

    // Email and username are each unique across ALL users (and login matches
    // either column), so check both up front for a readable error.
    const clashes = await db.user.findMany({
      where: {
        OR: [
          ...(data.email ? [{ email: data.email }] : []),
          ...(data.username ? [{ username: data.username }] : []),
        ],
      },
      select: { id: true, email: true, username: true, employee: { select: { id: true } } },
    });
    const emailUser = data.email ? clashes.find((u) => u.email === data.email) : undefined;
    const nameUser = data.username ? clashes.find((u) => u.username === data.username) : undefined;
    if (nameUser) {
      return fail("That username is already taken. Pick another.");
    }
    const mode = resolveEmailHireMode(
      emailUser ? { employeeId: emailUser.employee?.id ?? null } : null,
    );
    if (mode === "conflict") {
      return fail(
        "That company email already belongs to an employee. Use a different login email.",
      );
    }
    if (data.email) {
      const empClash = await db.employee.findUnique({
        where: { email: data.email },
        select: { id: true },
      });
      if (empClash) {
        return fail("That company email is already on an employee record. Use a different email.");
      }
    }
    if (data.departmentId) {
      const dept = await db.department.findUnique({
        where: { id: data.departmentId },
        select: { id: true },
      });
      if (!dept) return fail("That department no longer exists. Refresh and pick another.");
    }

    const [passwordHash, kioskPinHash] = await Promise.all([
      hashPassword(data.password),
      hashPassword(DEFAULT_KIOSK_PIN),
    ]);

    const employee = await db.$transaction(async (tx) => {
      const employeeId = await generateEmployeeId(tx);
      let userId: string;
      if (mode === "link" && emailUser) {
        // Bootstrap admin (or any auth-only user) becoming an employee —
        // keep their role (do not demote ADMIN → EMPLOYEE) and refresh
        // password/name/username from the form.
        await tx.user.update({
          where: { id: emailUser.id },
          data: {
            name: data.name,
            username: data.username ?? undefined,
            passwordHash,
            mustChangePassword: true,
            tokenVersion: { increment: 1 },
          },
        });
        userId = emailUser.id;
      } else {
        const user = await tx.user.create({
          data: {
            email: data.email ?? null,
            username: data.username ?? null,
            name: data.name,
            role: "EMPLOYEE",
            passwordHash,
            // Admin chose this password, so the employee must replace it.
            mustChangePassword: true,
          },
        });
        userId = user.id;
      }
      return tx.employee.create({
        data: {
          employeeId,
          userId,
          name: data.name,
          email: data.email ?? null,
          personalEmail: data.personalEmail ?? null,
          ssnLast4: data.ssnLast4 ?? null,
          gender: data.gender,
          departmentId: data.departmentId || null,
          jobTitle: data.jobTitle || null,
          phoneNumber: data.phoneNumber || null,
          employmentType: data.employmentType,
          compensationType: data.compensationType,
          compensationValue: data.compensationValue ?? null,
          kioskPinHash,
        },
      });
    });

    await audit({
      action: "employee.create",
      resource: `Employee:${employee.id}`,
      diff: {
        employeeId: employee.employeeId,
        email: data.email,
        username: data.username,
        linkedExistingUser: mode === "link",
        createdBy: admin.id,
      },
    });
    revalidatePath("/admin/employees");
    return ok({ id: employee.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

/* -------------------------------------------------------------------------- */
/* Update (admin)                                                             */
/* -------------------------------------------------------------------------- */

/** "" / undefined-safe text: trims, blank -> null, undefined stays undefined. */
const text = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .nullable()
  .transform((v) => (v === undefined ? undefined : v === "" ? null : v));

/** FK ids: "" -> null so an empty select never violates a foreign key. */
const idField = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v === undefined ? undefined : v ? v : null));

const updateSchema = z.object({
  name: z.string().trim().min(2).optional(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
  maritalStatus: z
    .enum(["SINGLE", "MARRIED", "DIVORCED", "WIDOWED", "SEPARATED", "OTHER"])
    .optional()
    .nullable(),
  phoneNumber: text,
  dateOfBirth: text,
  // Personal
  address: text,
  city: text,
  state: text,
  zipCode: text,
  nationality: text,
  educationLevel: text,
  emergencyName: text,
  emergencyPhone: text,
  personalEmail: nullableNormalizedEmail,
  ssnLast4: z
    .string()
    .regex(/^\d{4}$/, "SSN must be exactly the last 4 digits")
    .optional()
    .nullable(),
  // Work
  departmentId: idField,
  jobTitle: text,
  position: text,
  jobDescription: text,
  dateOfHire: text,
  supervisorId: idField,
  employmentType: z.enum(["FULL_PART_TIME", "CONTRACT_HOURLY"]).optional(),
  workEmail: nullableNormalizedEmail,
  workPhoneNumber: text,
  // Compensation
  compensationType: z.enum(["MONTHLY_SALARY", "HOURLY_RATE", "TOTAL_COMPENSATION"]).optional(),
  compensationValue: z.coerce.number().min(0, "Pay can't be negative").optional().nullable(),
  defaultHourlyRate: z.coerce.number().min(0, "Hourly rate can't be negative").optional(),
  primaryJobCodeId: idField,
});

export async function updateEmployee(
  employeeId: string,
  input: z.input<typeof updateSchema>,
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  try {
    const parsed = updateSchema.parse(input);
    const existing = await db.employee.findUnique({ where: { id: employeeId } });
    if (!existing) {
      return fail("That employee was not found. Refresh the page and try again.");
    }

    // Everything except the dates is copied through as-is (undefined = leave).
    const { dateOfBirth, dateOfHire, primaryJobCodeId, ...rest } = parsed;
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) data[k] = v;

    if (dateOfBirth !== undefined) {
      if (dateOfBirth === null) data.dateOfBirth = null;
      else {
        const c = checkDateOfBirth(dateOfBirth);
        if (!c.ok) return fail(c.error);
        data.dateOfBirth = c.date;
      }
    }
    if (dateOfHire !== undefined) {
      if (dateOfHire === null) data.dateOfHire = null;
      else {
        const c = checkDateOfHire(dateOfHire);
        if (!c.ok) return fail(c.error);
        data.dateOfHire = c.date;
      }
    }

    if (data.departmentId) {
      const dept = await db.department.findUnique({
        where: { id: data.departmentId as string },
        select: { id: true },
      });
      if (!dept) return fail("That department no longer exists. Refresh and pick another.");
    }

    if (data.supervisorId) {
      const supervisorId = data.supervisorId as string;
      const all = await db.employee.findMany({ select: { id: true, supervisorId: true } });
      if (!all.some((e) => e.id === supervisorId)) {
        return fail("That supervisor no longer exists. Refresh and pick another.");
      }
      const map = new Map(all.map((e) => [e.id, e.supervisorId]));
      if (createsSupervisorCycle(employeeId, supervisorId, map)) {
        return fail(
          supervisorId === employeeId
            ? "An employee can't supervise themselves."
            : "That would create a reporting loop (the chosen supervisor already reports to this employee).",
        );
      }
    }

    if (primaryJobCodeId) {
      const jc = await db.jobCode.findUnique({
        where: { id: primaryJobCodeId },
        select: { id: true },
      });
      if (!jc) return fail("That job code no longer exists. Refresh and pick another.");
    }
    if (primaryJobCodeId !== undefined) data.primaryJobCodeId = primaryJobCodeId;

    const nameChanged = typeof data.name === "string" && data.name !== existing.name;

    const updated = await db.$transaction(async (tx) => {
      const row = await tx.employee.update({
        where: { id: employeeId },
        data: data as Prisma.EmployeeUncheckedUpdateInput,
      });
      // The User row's name is what the session/topbar shows — keep in sync.
      if (nameChanged) {
        await tx.user.update({ where: { id: existing.userId }, data: { name: row.name } });
      }
      // Keep JobCodeAssignment.isPrimary consistent with primaryJobCodeId.
      if (primaryJobCodeId !== undefined) {
        await tx.jobCodeAssignment.updateMany({
          where: { employeeId, ...(primaryJobCodeId ? { NOT: { jobCodeId: primaryJobCodeId } } : {}) },
          data: { isPrimary: false },
        });
        if (primaryJobCodeId) {
          await tx.jobCodeAssignment.upsert({
            where: { jobCodeId_employeeId: { jobCodeId: primaryJobCodeId, employeeId } },
            create: { jobCodeId: primaryJobCodeId, employeeId, isPrimary: true },
            update: { isPrimary: true },
          });
        }
      }
      return row;
    });

    const diff = auditDiff(existing as unknown as Record<string, unknown>, data);
    if (Object.keys(diff).length > 0) {
      await audit({
        action: "employee.update",
        resource: `Employee:${employeeId}`,
        diff,
      });
    }
    revalidatePath("/admin/employees");
    revalidatePath(`/admin/employees/${employeeId}`);
    return ok({ id: updated.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

/* -------------------------------------------------------------------------- */
/* Passwords                                                                  */
/* -------------------------------------------------------------------------- */

const passwordSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters"),
  /** Default true: an admin-chosen password is temporary. */
  mustChange: z.boolean().optional(),
});

/**
 * Admin sets/resets a user's password. Sessions are revoked and (by default)
 * the user is forced to choose their own at next sign-in.
 */
export async function changeEmployeePassword(
  employeeId: string,
  input: z.infer<typeof passwordSchema>,
): Promise<ActionResult> {
  await requireAdmin();
  try {
    const { password, mustChange } = passwordSchema.parse(input);
    const employee = await db.employee.findUnique({
      where: { id: employeeId },
      select: { userId: true, name: true },
    });
    if (!employee) {
      return fail("That employee was not found. Refresh the page and try again.");
    }
    await db.user.update({
      where: { id: employee.userId },
      data: {
        passwordHash: await hashPassword(password),
        mustChangePassword: mustChange ?? true,
        tokenVersion: { increment: 1 },
      },
    });
    await audit({
      action: "employee.password_change",
      resource: `Employee:${employeeId}`,
      diff: { name: employee.name, mustChangePassword: mustChange ?? true },
    });
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}

/* -------------------------------------------------------------------------- */
/* Employment status / termination / approval                                 */
/* -------------------------------------------------------------------------- */

function accessEndText(terminationDate: Date): string {
  return readOnlyUntil(terminationDate).toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * ACTIVE / ON_LEAVE / TERMINATED. Terminating requires a termination date
 * (defaults to today; can be backdated, not future). The account stays
 * read-only for TERMINATION_GRACE_DAYS after that date, then sign-in stops;
 * the employee record and documents are kept. Re-activating clears it.
 * PENDING_REVIEW hires are approved with approveEmployee(), not here.
 */
export async function setEmploymentStatus(
  employeeId: string,
  status: "ACTIVE" | "ON_LEAVE" | "TERMINATED",
  opts: { reason?: string; terminationDate?: string } = {},
): Promise<ActionResult<{ id: string }>> {
  const admin = await requireAdmin();
  try {
    const emp = await db.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        userId: true,
        name: true,
        employmentStatus: true,
        terminationDate: true,
        user: { select: { role: true } },
      },
    });
    if (!emp) return fail("That employee was not found. Refresh the page and try again.");

    if (emp.employmentStatus === "PENDING_REVIEW" && status !== "TERMINATED") {
      return fail("This hire is awaiting review. Use Approve to activate the account.");
    }
    if (emp.employmentStatus === status && status !== "TERMINATED") {
      return ok({ id: emp.id });
    }

    const data: Prisma.EmployeeUncheckedUpdateInput = { employmentStatus: status };
    let terminationDate: Date | null = null;
    const reason = opts.reason?.trim() || null;

    if (status === "TERMINATED") {
      if (emp.userId === admin.id) return fail("You can't terminate your own account.");
      if (emp.user.role === "ADMIN") {
        return fail(
          "This person is an admin. Remove their admin role first (Employee page > Access), then terminate.",
        );
      }
      const c = checkTerminationDate(opts.terminationDate || todayDateString());
      if (!c.ok) return fail(c.error);
      terminationDate = c.date;
      data.terminationDate = terminationDate;
      data.terminationReason = reason;
    } else {
      data.terminationDate = null;
      data.terminationReason = null;
    }

    const updated = await db.employee.update({ where: { id: employeeId }, data });

    await audit({
      action: "employee.status_change",
      resource: `Employee:${employeeId}`,
      diff: {
        name: emp.name,
        from: emp.employmentStatus,
        to: status,
        terminationDate: terminationDate?.toISOString().slice(0, 10) ?? null,
        reason,
      },
    });

    if (status === "TERMINATED" && terminationDate) {
      await notifyEmployees([employeeId], {
        type: "SYSTEM",
        title: "Your employment has ended",
        message: `Your account is read-only until ${accessEndText(terminationDate)} so you can still view your pay stubs and documents. After that you will no longer be able to sign in.`,
        priority: "HIGH",
      });
    } else if (emp.employmentStatus === "TERMINATED") {
      await notifyEmployees([employeeId], {
        type: "SYSTEM",
        title: "Your account was reactivated",
        message: "Your account has full access again.",
      });
    }

    revalidatePath("/admin/employees");
    revalidatePath(`/admin/employees/${employeeId}`);
    return ok({ id: updated.id });
  } catch (err) {
    return failFromUnknown(err);
  }
}

/** Admin approves a self-onboarded hire: PENDING_REVIEW -> ACTIVE. */
export async function approveEmployee(employeeId: string): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  try {
    // Atomic claim so two admins can't both approve / a stale page can't
    // resurrect a terminated hire.
    const res = await db.employee.updateMany({
      where: { id: employeeId, employmentStatus: "PENDING_REVIEW" },
      data: { employmentStatus: "ACTIVE" },
    });
    if (res.count === 0) {
      return fail("This hire is no longer awaiting review. Refresh the page.");
    }
    const emp = await db.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, name: true, employeeId: true },
    });
    await audit({
      action: "employee.approve",
      resource: `Employee:${employeeId}`,
      diff: { name: emp?.name, employeeId: emp?.employeeId },
    });
    await notifyEmployees([employeeId], {
      type: "SYSTEM",
      title: "Your account was approved",
      message: "Welcome aboard. Your account is now fully active.",
      link: "/dashboard",
    });
    revalidatePath("/admin/employees");
    revalidatePath("/admin/onboarding");
    revalidatePath(`/admin/employees/${employeeId}`);
    return ok({ id: employeeId });
  } catch (err) {
    return failFromUnknown(err);
  }
}

/**
 * Admin rejects a pending hire. A pending hire has no history, so the
 * account and record are removed (the invite stays COMPLETED for the trail).
 */
export async function rejectPendingHire(employeeId: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    const emp = await db.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, userId: true, name: true, employeeId: true, employmentStatus: true, email: true },
    });
    if (!emp) return fail("That employee was not found. Refresh the page and try again.");
    if (emp.employmentStatus !== "PENDING_REVIEW") {
      return fail("Only hires awaiting review can be rejected. Use Terminate for anyone else.");
    }
    await db.$transaction(async (tx) => {
      const r = await tx.employee.deleteMany({
        where: { id: employeeId, employmentStatus: "PENDING_REVIEW" },
      });
      if (r.count !== 1) throw new Error("This hire is no longer awaiting review.");
      await tx.user.delete({ where: { id: emp.userId } });
    });
    await audit({
      action: "employee.reject_pending",
      resource: `Employee:${employeeId}`,
      diff: { name: emp.name, employeeId: emp.employeeId, email: emp.email },
    });
    revalidatePath("/admin/employees");
    revalidatePath("/admin/onboarding");
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}

/* -------------------------------------------------------------------------- */
/* Roles                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Promote / demote an admin. Never yourself, never the last admin. Sessions
 * are revoked so the new role takes effect on next sign-in.
 */
export async function setUserRole(
  employeeId: string,
  role: "ADMIN" | "EMPLOYEE",
): Promise<ActionResult> {
  const admin = await requireAdmin();
  try {
    const emp = await db.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        name: true,
        employmentStatus: true,
        userId: true,
        user: { select: { role: true } },
      },
    });
    if (!emp) return fail("That employee was not found. Refresh the page and try again.");
    if (emp.userId === admin.id) {
      return fail("You can't change your own role. Ask another admin.");
    }
    if (emp.user.role === role) return ok();

    if (role === "ADMIN") {
      if (emp.employmentStatus !== "ACTIVE" && emp.employmentStatus !== "ON_LEAVE") {
        return fail("Only active employees can be made admins.");
      }
    } else {
      const admins = await db.user.count({ where: { role: "ADMIN" } });
      if (admins <= 1) return fail("You can't remove the last admin.");
    }

    await db.user.update({
      where: { id: emp.userId },
      data: { role, tokenVersion: { increment: 1 } },
    });
    await audit({
      action: "employee.role_change",
      resource: `Employee:${employeeId}`,
      diff: { name: emp.name, from: emp.user.role, to: role },
    });
    await notifyEmployees([employeeId], {
      type: "SYSTEM",
      title: role === "ADMIN" ? "You are now an admin" : "Your admin access was removed",
      message: "Sign in again for the change to take effect.",
    });
    revalidatePath(`/admin/employees/${employeeId}`);
    revalidatePath("/admin/employees");
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}

/* -------------------------------------------------------------------------- */
/* Profile picture                                                            */
/* -------------------------------------------------------------------------- */

export async function updateEmployeeProfilePic(
  employeeId: string,
  file: { name: string; type: string; bytes: ArrayBuffer },
): Promise<ActionResult<{ url: string }>> {
  await requireAdmin();
  try {
    const exists = await db.employee.findUnique({
      where: { id: employeeId },
      select: { id: true },
    });
    if (!exists) return fail("That employee was not found. Refresh the page and try again.");

    const v = validateUpload("image", { name: file.name, bytes: file.bytes });
    if (!v.ok) return fail(v.error);

    const path = `${employeeId}/avatar`;
    // Server-chosen content type (never the client's file.type).
    await uploadFile("profile-pics", path, file.bytes, {
      contentType: v.contentType,
      upsert: true,
    });
    const url = `/api/employees/${employeeId}/profile-pic`;
    await db.employee.update({
      where: { id: employeeId },
      data: { profilePic: url },
    });
    await audit({
      action: "employee.profile_pic_update",
      resource: `Employee:${employeeId}`,
    });
    revalidatePath(`/admin/employees/${employeeId}`);
    revalidatePath("/admin/employees");
    // Cache-buster so the new image shows immediately (stored URL is stable).
    return ok({ url: `${url}?v=${Date.now()}` });
  } catch (err) {
    return failFromUnknown(
      err,
      "Could not upload the photo. Check the file and try again.",
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Self-service writes (blocked for READ_ONLY accounts)                       */
/* -------------------------------------------------------------------------- */

const NO_EMPLOYEE =
  "Your account has no employee profile yet. Ask an admin to create one before you can change this.";

/** Self-service: update the personal email 2FA codes are sent to. Requires
 *  the current password, same as changing it — this controls login access. */
export async function updateMyPersonalEmail(
  currentPassword: string,
  personalEmail: string,
): Promise<ActionResult> {
  const w = await writable();
  if (!w.ok) return w;
  const user = w.user;
  if (!user.employeeId) return fail(NO_EMPLOYEE);
  const normalized = (normalizeEmail(personalEmail) ?? "");
  const parsed = (
    env.LOGIN_2FA_ENABLED === "true"
      ? z.string().email()
      : z.string().email().or(z.literal(""))
  ).safeParse(normalized);
  if (!parsed.success) {
    return fail(
      "Enter a valid personal email address (codes are sent here for sign-in).",
    );
  }

  try {
    const row = await db.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    if (
      !row?.passwordHash ||
      !(await verifyPassword(currentPassword, row.passwordHash))
    ) {
      return fail("Current password is incorrect. Re-enter it and try again.");
    }
    await db.employee.update({
      where: { id: user.employeeId },
      data: { personalEmail: parsed.data || null },
    });
    await audit({
      action: "employee.personal_email_update",
      resource: `Employee:${user.employeeId}`,
    });
    revalidatePath("/dashboard/settings");
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}

async function setConsent(
  field: "w2ConsentAt" | "benefitsEConsentAt",
  value: Date | null,
  auditAction: string,
): Promise<ActionResult> {
  const w = await writable();
  if (!w.ok) return w;
  const user = w.user;
  if (!user.employeeId) return fail(NO_EMPLOYEE);
  try {
    await db.employee.update({
      where: { id: user.employeeId },
      data: { [field]: value },
    });
    await audit({ action: auditAction, resource: `Employee:${user.employeeId}` });
    revalidatePath("/dashboard/settings");
    return ok();
  } catch (err) {
    return failFromUnknown(err);
  }
}

/** IRS Treas. Reg. 31.6051-1 electronic W-2 consent — self-service. */
export async function consentToElectronicW2(): Promise<ActionResult> {
  return setConsent("w2ConsentAt", new Date(), "employee.w2_consent_given");
}

export async function withdrawW2Consent(): Promise<ActionResult> {
  return setConsent("w2ConsentAt", null, "employee.w2_consent_withdrawn");
}

/**
 * 29 CFR 2520.104b-1(c) electronic delivery consent for health & welfare
 * plan documents — see schema comment on Employee.benefitsEConsentAt.
 */
export async function consentToBenefitsEDelivery(): Promise<ActionResult> {
  return setConsent("benefitsEConsentAt", new Date(), "employee.benefits_econsent_given");
}

export async function withdrawBenefitsEConsent(): Promise<ActionResult> {
  return setConsent("benefitsEConsentAt", null, "employee.benefits_econsent_withdrawn");
}

/* -------------------------------------------------------------------------- */
/* Bulk actions                                                               */
/* -------------------------------------------------------------------------- */

const BULK_DELETE_CONFIRM_WORD = "DELETE";

/**
 * PERMANENTLY delete employees and their login. Guarded:
 *  - admin only, typed confirmation word required
 *  - never yourself, never an admin account
 *  - refuses anyone with time / payroll / reimbursement history unless
 *    `force` (Terminate keeps history and is the normal offboarding path)
 *  - one transaction (User row + cascaded employee data), each deletion audited
 * Files already stored in S3 are not removed.
 */
export async function bulkDeleteEmployees(
  ids: string[],
  opts: { confirm: string; force?: boolean },
): Promise<ActionResult<{ count: number }>> {
  const admin = await requireAdmin();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return fail("Select at least one employee to delete.");
  if (opts?.confirm !== BULK_DELETE_CONFIRM_WORD) {
    return fail(`Type ${BULK_DELETE_CONFIRM_WORD} to confirm permanent deletion.`);
  }
  try {
    const employees = await db.employee.findMany({
      where: { id: { in: unique } },
      select: {
        id: true,
        employeeId: true,
        name: true,
        email: true,
        userId: true,
        user: { select: { role: true } },
        _count: {
          select: { timeEntries: true, payrollDocs: true, reimbursements: true },
        },
      },
    });
    if (employees.length !== unique.length) {
      return fail("Some selected employees no longer exist. Refresh the page and try again.");
    }

    const self = employees.filter((e) => e.userId === admin.id);
    if (self.length) return fail("You can't delete your own account.");

    const admins = employees.filter((e) => e.user.role === "ADMIN");
    if (admins.length) {
      return fail(
        `Can't delete admin accounts (${admins.map((e) => e.name).join(", ")}). Remove their admin role first.`,
      );
    }

    const withHistory = employees.filter(
      (e) => e._count.timeEntries + e._count.payrollDocs + e._count.reimbursements > 0,
    );
    if (withHistory.length && !opts.force) {
      const list = withHistory
        .slice(0, 5)
        .map(
          (e) =>
            `${e.name} (${e._count.timeEntries} time entries, ${e._count.payrollDocs} payroll docs, ${e._count.reimbursements} reimbursements)`,
        )
        .join("; ");
      return fail(
        `These employees have records that would be destroyed: ${list}${withHistory.length > 5 ? "; …" : ""}. Terminate them instead (keeps their records), or tick "delete even with history".`,
      );
    }

    await db.$transaction(async (tx) => {
      const del = await tx.user.deleteMany({
        where: { id: { in: employees.map((e) => e.userId) } },
      });
      if (del.count !== employees.length) {
        throw new Error("Delete did not match the selection. Nothing was deleted; refresh and retry.");
      }
    });

    for (const e of employees) {
      await audit({
        action: "employee.delete",
        resource: `Employee:${e.id}`,
        diff: {
          employeeId: e.employeeId,
          name: e.name,
          email: e.email,
          forced: Boolean(opts.force),
          timeEntries: e._count.timeEntries,
          payrollDocs: e._count.payrollDocs,
          reimbursements: e._count.reimbursements,
        },
      });
    }
    revalidatePath("/admin/employees");
    return ok({ count: employees.length });
  } catch (err) {
    return failFromUnknown(err);
  }
}

/**
 * Bulk terminate (the preferred offboarding action). Skips yourself, admins
 * and anyone already terminated; reports how many were skipped.
 */
export async function bulkTerminateEmployees(
  ids: string[],
  opts: { terminationDate?: string; reason?: string } = {},
): Promise<ActionResult<{ count: number; skipped: number }>> {
  const admin = await requireAdmin();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return fail("Select at least one employee.");
  try {
    const c = checkTerminationDate(opts.terminationDate || todayDateString());
    if (!c.ok) return fail(c.error);
    const reason = opts.reason?.trim() || null;

    const employees = await db.employee.findMany({
      where: { id: { in: unique } },
      select: {
        id: true,
        name: true,
        userId: true,
        employmentStatus: true,
        user: { select: { role: true } },
      },
    });
    const eligible = employees.filter(
      (e) =>
        e.employmentStatus !== "TERMINATED" && e.userId !== admin.id && e.user.role !== "ADMIN",
    );
    if (eligible.length === 0) {
      return fail(
        "Nothing to terminate: the selection is already terminated, or contains admins or yourself.",
      );
    }

    await db.employee.updateMany({
      where: { id: { in: eligible.map((e) => e.id) } },
      data: {
        employmentStatus: "TERMINATED",
        terminationDate: c.date,
        terminationReason: reason,
      },
    });
    for (const e of eligible) {
      await audit({
        action: "employee.status_change",
        resource: `Employee:${e.id}`,
        diff: {
          name: e.name,
          from: e.employmentStatus,
          to: "TERMINATED",
          terminationDate: c.date.toISOString().slice(0, 10),
          reason,
          bulk: true,
        },
      });
    }
    await notifyEmployees(
      eligible.map((e) => e.id),
      {
        type: "SYSTEM",
        title: "Your employment has ended",
        message: `Your account is read-only until ${accessEndText(c.date)} (${TERMINATION_GRACE_DAYS} days) so you can still view your pay stubs and documents. After that you will no longer be able to sign in.`,
        priority: "HIGH",
      },
    );
    revalidatePath("/admin/employees");
    return ok({ count: eligible.length, skipped: employees.length - eligible.length });
  } catch (err) {
    return failFromUnknown(err);
  }
}
