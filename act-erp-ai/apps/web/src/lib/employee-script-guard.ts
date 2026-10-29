import { Prisma, type PrismaClient } from "@prisma/client";

/** Legacy import/cleanup scripts must never silently overwrite encrypted PII. */
export async function assertLegacyEmployeeScriptSafe(db: Pick<PrismaClient, "employee">) {
  if (process.env.SENSITIVE_DATA_REQUIRE_ENCRYPTED === "true" ||
      process.env.SENSITIVE_DATA_KMS_KEY_ARN ||
      await db.employee.findFirst({ where: { privateDetails: { not: Prisma.DbNull } }, select: { id: true } })) {
    throw new Error("This legacy employee script is disabled for the KMS rollout. Use the encrypted employee service.");
  }
}
