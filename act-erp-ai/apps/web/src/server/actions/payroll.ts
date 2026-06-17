"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { uploadFile, deleteFile } from "@/lib/storage";

const uploadSchema = z.object({
  employeeId: z.string(),
  title: z.string().min(2),
  description: z.string().optional(),
  category: z.string().default("Pay Stub"),
  payPeriodStart: z.string(),
  payPeriodEnd: z.string(),
});

export async function uploadPayrollDocument(
  input: z.infer<typeof uploadSchema>,
  file: { name: string; type: string; bytes: ArrayBuffer },
) {
  const admin = await requireAdmin();
  const data = uploadSchema.parse(input);
  const path = `${data.employeeId}/${data.payPeriodEnd}-${Date.now()}-${file.name}`;
  const { publicUrl } = await uploadFile("payroll", path, file.bytes, {
    contentType: file.type,
  });
  const doc = await db.payroll.create({
    data: {
      employeeId: data.employeeId,
      title: data.title,
      description: data.description ?? null,
      category: data.category,
      fileName: path,
      fileType: file.type,
      fileUrl: publicUrl,
      payPeriodStart: new Date(data.payPeriodStart),
      payPeriodEnd: new Date(data.payPeriodEnd),
      uploadedById: admin.id,
      uploaderEmployeeId: admin.employeeId ?? null,
    },
  });
  revalidatePath("/admin/payroll");
  revalidatePath("/dashboard/payroll");
  return doc;
}

export async function deletePayrollDocument(id: string) {
  await requireAdmin();
  const doc = await db.payroll.findUnique({ where: { id } });
  if (!doc) throw new Error("Not found");
  await deleteFile("payroll", doc.fileName).catch(() => null);
  await db.payroll.delete({ where: { id } });
  revalidatePath("/admin/payroll");
}

const calendarSchema = z.object({
  title: z.string().min(2),
  payPeriodStart: z.string(),
  payPeriodEnd: z.string(),
  payDate: z.string(),
  status: z.enum(["UPCOMING", "CURRENT", "COMPLETED"]).default("UPCOMING"),
  notes: z.string().optional(),
});

export async function createPayrollPeriod(input: z.infer<typeof calendarSchema>) {
  const admin = await requireAdmin();
  const data = calendarSchema.parse(input);
  const period = await db.payrollCalendar.create({
    data: {
      title: data.title,
      payPeriodStart: new Date(data.payPeriodStart),
      payPeriodEnd: new Date(data.payPeriodEnd),
      payDate: new Date(data.payDate),
      status: data.status,
      notes: data.notes ?? null,
      createdById: admin.id,
    },
  });
  revalidatePath("/admin/payroll");
  return period;
}

export async function deletePayrollPeriod(id: string) {
  await requireAdmin();
  await db.payrollCalendar.delete({ where: { id } });
  revalidatePath("/admin/payroll");
}
