/**
 * Dry-run (default), --apply, or --verify. Never logs record values or identities.
 * Invoke with caller-supplied DATABASE_URL/AWS credentials/KMS configuration:
 *   node --conditions=react-server --import tsx scripts/encrypt-onboarding-data.ts
 * Retain an encrypted-reader-compatible app for rollback after the first write.
 */
import { Prisma, PrismaClient, type OnboardingPacketSubmission } from "@prisma/client";
import {
  encryptSensitiveJson,
  decryptSensitiveJson,
  isEncryptedSensitiveJson,
} from "../src/server/sensitive-data";
import {
  ONBOARDING_PACKET_FIELDS,
  onboardingDraftContext,
  onboardingPacketContext,
} from "../src/server/onboarding-sensitive-data";
import {
  migrateSensitiveRow,
  type MigrationCrypto,
  type MigrationMode,
  type MigrationResult,
} from "../src/server/onboarding-encryption-migration";

const PAGE_SIZE = 100;
const crypto: MigrationCrypto = {
  encrypt: encryptSensitiveJson,
  decrypt: decryptSensitiveJson,
  isEncrypted: isEncryptedSensitiveJson,
};
type FieldCounts = { plaintext: number; encrypted: number; invalid: number; skipped: number };
type TableCounts = {
  rows: number;
  updated: number;
  unchanged: number;
  failed: number;
  conflicts: number;
  fields: Record<string, FieldCounts>;
};
const newFieldCounts = (): FieldCounts => ({ plaintext: 0, encrypted: 0, invalid: 0, skipped: 0 });
const newTableCounts = (fields: readonly string[]): TableCounts => ({
  rows: 0, updated: 0, unchanged: 0, failed: 0, conflicts: 0,
  fields: Object.fromEntries(fields.map(field => [field, newFieldCounts()])),
});
function countResult(counts: TableCounts, result: MigrationResult) {
  for (const [field, state] of Object.entries(result.fields)) counts.fields[field][state]++;
  if (result.outcome === "updated") counts.updated++;
  if (result.outcome === "unchanged") counts.unchanged++;
  if (result.outcome === "failed") counts.failed++;
  if (result.outcome === "conflict") counts.conflicts++;
}
function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function main() {
  const flags = process.argv.slice(2);
  if (flags.some(flag => flag !== "--apply" && flag !== "--verify") || flags.length > 1) {
    throw new Error("Use no flags, --apply, or --verify.");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const mode: MigrationMode = flags[0] === "--apply" ? "apply" : flags[0] === "--verify" ? "verify" : "dry-run";
  // No query/parameter logging and no dotenv/env-file loading in this script.
  const db = new PrismaClient({ log: [], datasources: { db: { url: process.env.DATABASE_URL } } });
  const drafts = newTableCounts(["draftJson"]);
  const packets = newTableCounts(ONBOARDING_PACKET_FIELDS);
  try {
    let cursor: string | undefined;
    while (true) {
      const rows = await db.onboardingInvite.findMany({
        where: cursor ? { id: { gt: cursor } } : {},
        select: { id: true, draftJson: true },
        orderBy: { id: "asc" }, take: PAGE_SIZE,
      });
      if (!rows.length) break;
      for (const row of rows) {
        drafts.rows++;
        if (row.draftJson == null) {
          drafts.fields.draftJson.skipped++;
          continue;
        }
        const result = await migrateSensitiveRow({
          mode, crypto,
          fields: [{ name: "draftJson", value: row.draftJson, context: onboardingDraftContext(row.id) }],
          compareAndSwap: async (expected, replacement) => {
            const changed = await db.onboardingInvite.updateMany({
              where: { id: row.id, draftJson: { equals: json(expected.draftJson) } },
              data: { draftJson: json(replacement.draftJson) },
            });
            return changed.count === 1;
          },
          readBack: () => db.onboardingInvite.findUnique({ where: { id: row.id }, select: { draftJson: true } }),
        });
        countResult(drafts, result);
      }
      cursor = rows[rows.length - 1].id;
    }
    cursor = undefined;
    while (true) {
      const rows: Pick<OnboardingPacketSubmission,
        "id" | "inviteId" | (typeof ONBOARDING_PACKET_FIELDS)[number]
      >[] = await db.onboardingPacketSubmission.findMany({
        where: cursor ? { id: { gt: cursor } } : {},
        select: {
          id: true, inviteId: true, application: true, drugAlcohol: true,
          background: true, directDeposit: true, handbook: true,
        },
        orderBy: { id: "asc" }, take: PAGE_SIZE,
      });
      if (!rows.length) break;
      for (const row of rows) {
        packets.rows++;
        const result = await migrateSensitiveRow({
          mode, crypto,
          fields: ONBOARDING_PACKET_FIELDS.map(field => ({
            name: field, value: row[field], context: onboardingPacketContext(row.inviteId, field),
          })),
          compareAndSwap: async (expected, replacement) => {
            const where: Prisma.OnboardingPacketSubmissionWhereInput = {
              id: row.id,
              AND: ONBOARDING_PACKET_FIELDS.map(field => ({ [field]: { equals: json(expected[field]) } })),
            };
            const data = Object.fromEntries(Object.entries(replacement).map(([field, value]) => [field, json(value)]));
            const changed = await db.onboardingPacketSubmission.updateMany({ where, data });
            return changed.count === 1;
          },
          readBack: () => db.onboardingPacketSubmission.findUnique({
            where: { id: row.id },
            select: { application: true, drugAlcohol: true, background: true, directDeposit: true, handbook: true },
          }),
        });
        countResult(packets, result);
      }
      cursor = rows[rows.length - 1].id;
    }
    console.log(JSON.stringify({
      mode,
      note: mode === "dry-run" ? "Encrypted counts inspect format only; --verify authenticates ciphertext." : undefined,
      OnboardingInvite: drafts,
      OnboardingPacketSubmission: packets,
    }, null, 2));
    const invalid = Object.values(drafts.fields).concat(Object.values(packets.fields))
      .reduce((sum, field) => sum + field.invalid, 0);
    if (invalid || drafts.failed || drafts.conflicts || packets.failed || packets.conflicts) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

main().catch(() => {
  console.error("Onboarding encryption migration failed. No record values were logged.");
  process.exitCode = 1;
});
