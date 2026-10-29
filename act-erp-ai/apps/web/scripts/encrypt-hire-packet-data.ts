/**
 * Count-only dry-run (default), --apply, or --verify. No record values logged.
 * node --conditions=react-server --import tsx scripts/encrypt-hire-packet-data.ts
 * Supply DATABASE_URL and KMS/AWS environment explicitly; no dotenv loading.
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { encryptSensitiveJson, decryptSensitiveJson, isEncryptedSensitiveJson } from "../src/server/sensitive-data";
import {
  HIRE_PACKET_SENSITIVE_FIELDS, hirePacketContext, safeHirePacketError,
} from "../src/server/hire-packet-sensitive-data";
import { migrateSensitiveRow, type MigrationMode } from "../src/server/onboarding-encryption-migration";

const PAGE_SIZE = 100;
const crypto = { encrypt: encryptSensitiveJson, decrypt: decryptSensitiveJson, isEncrypted: isEncryptedSensitiveJson };
const json = (value: unknown) => value as Prisma.InputJsonValue;
const newFieldCounts = () => ({ plaintext: 0, encrypted: 0, invalid: 0, skipped: 0 });

async function main() {
  const flags = process.argv.slice(2);
  if (flags.some(flag => flag !== "--apply" && flag !== "--verify") || flags.length > 1 || !process.env.DATABASE_URL) {
    throw new Error("Use no flags, --apply, or --verify with DATABASE_URL configured.");
  }
  const mode: MigrationMode = flags[0] === "--apply" ? "apply" : flags[0] === "--verify" ? "verify" : "dry-run";
  const db = new PrismaClient({ log: [], datasources: { db: { url: process.env.DATABASE_URL } } });
  const counts = {
    rows: 0, updated: 0, unchanged: 0, failed: 0, conflicts: 0,
    unsafeErrorMessages: 0, errorsSanitized: 0,
    fields: { proposedFields: newFieldCounts(), fileResults: newFieldCounts() },
  };
  try {
    let cursor: string | undefined;
    while (true) {
      const rows = await db.hirePacketImport.findMany({
        where: cursor ? { id: { gt: cursor } } : {},
        select: { id: true, updatedAt: true, proposedFields: true, fileResults: true, errorMessage: true },
        orderBy: { id: "asc" }, take: PAGE_SIZE,
      });
      if (!rows.length) break;
      for (const row of rows) {
        counts.rows++;
        const fields = HIRE_PACKET_SENSITIVE_FIELDS.filter(field => row[field] != null);
        for (const field of HIRE_PACKET_SENSITIVE_FIELDS) {
          if (row[field] == null) counts.fields[field].skipped++;
        }
        const normalizedError = safeHirePacketError(row.errorMessage);
        const unsafeError = row.errorMessage !== normalizedError;
        if (unsafeError) counts.unsafeErrorMessages++;
        const result = await migrateSensitiveRow({
          mode, crypto,
          fields: fields.map(field => ({ name: field, value: row[field], context: hirePacketContext(row.id, field) })),
          compareAndSwap: async (expected, replacement) => {
            // updatedAt protects worker heartbeats, retries and status changes as
            // well as edits to either nullable JSON value.
            const changed = await db.hirePacketImport.updateMany({
              where: {
                id: row.id, updatedAt: row.updatedAt,
                AND: fields.map(field => ({ [field]: { equals: json(expected[field]) } })),
              },
              data: { ...replacement, errorMessage: normalizedError },
            });
            if (changed.count === 1 && unsafeError) counts.errorsSanitized++;
            return changed.count === 1;
          },
          readBack: () => db.hirePacketImport.findUnique({
            where: { id: row.id }, select: { proposedFields: true, fileResults: true },
          }),
        });
        for (const field of fields) counts.fields[field][result.fields[field]]++;
        if (result.outcome === "failed") counts.failed++;
        if (result.outcome === "conflict") counts.conflicts++;
        if (result.outcome === "updated") counts.updated++;
        if (result.outcome === "unchanged") counts.unchanged++;
        // Existing error strings can themselves contain sensitive extraction
        // values. Normalize these even when every JSON field was already sealed.
        if (unsafeError && mode === "apply" && result.outcome === "unchanged") {
          const changed = await db.hirePacketImport.updateMany({
            where: { id: row.id, updatedAt: row.updatedAt },
            data: { errorMessage: normalizedError },
          });
          if (changed.count === 1) {
            counts.errorsSanitized++;
            const checked = await db.hirePacketImport.findUnique({ where: { id: row.id }, select: { errorMessage: true } });
            if (!checked || checked.errorMessage !== normalizedError) counts.failed++;
          } else counts.conflicts++;
        }
        if (unsafeError && mode === "verify") counts.failed++;
      }
      cursor = rows[rows.length - 1].id;
    }
    console.log(JSON.stringify({
      mode,
      note: mode === "dry-run" ? "Encrypted counts inspect format only; --verify authenticates ciphertext." : undefined,
      HirePacketImport: counts,
    }, null, 2));
    if (counts.failed || counts.conflicts || Object.values(counts.fields).some(field => field.invalid > 0)) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error("Hire-packet encryption migration failed. No record values were logged.");
  process.exitCode = 1;
});
