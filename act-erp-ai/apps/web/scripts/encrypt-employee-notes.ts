/** Count-only dry-run (default), --apply or --verify. Supply env securely.
 * node --conditions=react-server --import tsx scripts/encrypt-employee-notes.ts
 */
import { PrismaClient } from "@prisma/client";
import {
  decryptSensitiveJson, encryptSensitiveJson, isEncryptedSensitiveJson,
  isEncryptedSensitiveText, SENSITIVE_TEXT_PREFIX,
} from "../src/server/sensitive-data";
import { employeeNoteContext, PRIVATE_NOTE_REASON, PRIVATE_NOTE_TITLE } from "../src/server/employee-note-sensitive-data";
import { migrateSensitiveRow, type MigrationCrypto, type MigrationMode } from "../src/server/onboarding-encryption-migration";

type NoteRow = { id: string; title: string; body: string; reason?: string | null; updatedAt?: Date };
const crypto: MigrationCrypto = {
  encrypt: (value, context) => encryptSensitiveJson(JSON.stringify(value), context),
  decrypt: async (value, context) => JSON.parse(await decryptSensitiveJson<string>(value, context)),
  isEncrypted: isEncryptedSensitiveJson,
};
function content(row: NoteRow) {
  return isEncryptedSensitiveText(row.body)
    ? JSON.parse(row.body.slice(SENSITIVE_TEXT_PREFIX.length)) as unknown
    : { title: row.title, body: row.body, reason: row.reason ?? null };
}
async function main() {
  const flags = process.argv.slice(2);
  if (flags.length > 1 || flags.some(flag => !["--apply", "--verify"].includes(flag))) throw new Error("Invalid flags");
  if (!process.env.DATABASE_URL) throw new Error("Missing database configuration");
  const mode: MigrationMode = flags[0] === "--apply" ? "apply" : flags[0] === "--verify" ? "verify" : "dry-run";
  const db = new PrismaClient({ log: [] });
  const report: Record<string, Record<string, number>> = {};
  try {
    for (const revision of [false, true]) {
      const counts = { rows: 0, plaintext: 0, encrypted: 0, invalid: 0, updated: 0, unchanged: 0, conflicts: 0, failed: 0 };
      report[revision ? "EmployeeNoteRevision" : "EmployeeNote"] = counts;
      let cursor: string | undefined;
      while (true) {
        const pageArgs = { where: cursor ? { id: { gt: cursor } } : {}, orderBy: { id: "asc" as const }, take: 100 };
        const rows: NoteRow[] = revision
          ? await db.employeeNoteRevision.findMany({ ...pageArgs, select: { id: true, title: true, body: true, reason: true } })
          : await db.employeeNote.findMany({ ...pageArgs, select: { id: true, title: true, body: true, updatedAt: true } });
        if (!rows.length) break;
        for (const row of rows) {
          counts.rows++;
          try {
            if (isEncryptedSensitiveText(row.body) &&
                (row.title !== PRIVATE_NOTE_TITLE || (revision && row.reason !== PRIVATE_NOTE_REASON))) {
              counts.invalid++;
              continue;
            }
            const result = await migrateSensitiveRow({
              mode, crypto,
              fields: [{ name: "content", value: content(row), context: employeeNoteContext(row.id, revision) }],
              compareAndSwap: async (_expected, replacement) => {
                const data = { title: PRIVATE_NOTE_TITLE, body: SENSITIVE_TEXT_PREFIX + JSON.stringify(replacement.content) };
                const changed = revision
                  ? await db.employeeNoteRevision.updateMany({
                      where: { id: row.id, title: row.title, body: row.body, reason: row.reason },
                      data: { ...data, reason: PRIVATE_NOTE_REASON },
                    })
                  : await db.employeeNote.updateMany({
                      where: { id: row.id, title: row.title, body: row.body, updatedAt: row.updatedAt }, data,
                    });
                return changed.count === 1;
              },
              readBack: async () => {
                const saved = revision
                  ? await db.employeeNoteRevision.findUnique({ where: { id: row.id }, select: { id: true, title: true, body: true, reason: true } })
                  : await db.employeeNote.findUnique({ where: { id: row.id }, select: { id: true, title: true, body: true } });
                if (!saved) return null;
                if (saved.title !== PRIVATE_NOTE_TITLE || ("reason" in saved && saved.reason !== PRIVATE_NOTE_REASON)) throw new Error("Unmasked note metadata");
                return { content: content(saved) };
              },
            });
            counts[result.fields.content]++;
            if (result.outcome === "conflict") counts.conflicts++;
            else if (result.outcome !== "dry-run") counts[result.outcome]++;
          } catch {
            counts.failed++;
          }
        }
        cursor = rows.at(-1)!.id;
      }
    }
    console.log(JSON.stringify({ mode, report }, null, 2));
    if (Object.values(report).some(count => count.failed || count.invalid || count.conflicts)) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error("Employee note encryption migration failed. No note contents were logged.");
  process.exitCode = 1;
});
