/**
 * One-off, idempotent: make every stored login identifier trimmed + lowercase.
 *
 * Login lowercases whatever the user types, so a mixed-case email or username
 * in the database can never match and that person is locked out. This fixes
 * existing rows (new rows are normalised by the app).
 *
 *   pnpm tsx --env-file=.env.local scripts/normalize-emails.ts           # dry run (default)
 *   pnpm tsx --env-file=.env.local scripts/normalize-emails.ts --apply   # write changes
 *
 * Covers User.email / username / personalEmail, Employee.email / personalEmail /
 * workEmail and OnboardingInvite.email. For UNIQUE columns (User.email,
 * User.username, Employee.email) two rows that would collapse onto the same
 * value are a COLLISION: they are reported and left untouched so a human can
 * decide which one is real. Safe to re-run; a second run changes nothing.
 * Exits with code 2 if collisions were found (even with --apply).
 */
import { PrismaClient } from "@prisma/client";

const apply = process.argv.includes("--apply");
const db = new PrismaClient();

const norm = (v: string | null): string | null => {
  if (v == null) return null;
  const t = v.trim().toLowerCase();
  return t === "" ? null : t;
};

type Row = { id: string; value: string | null };
type Stats = { label: string; checked: number; changed: number; collisions: number };

async function process_(
  label: string,
  unique: boolean,
  rows: Row[],
  update: (id: string, value: string | null) => Promise<unknown>,
): Promise<Stats> {
  const stats: Stats = { label, checked: rows.length, changed: 0, collisions: 0 };

  // Who currently holds / would hold each normalised value?
  const holders = new Map<string, string[]>();
  for (const r of rows) {
    const n = norm(r.value);
    if (n) holders.set(n, [...(holders.get(n) ?? []), r.id]);
  }

  for (const r of rows) {
    const n = norm(r.value);
    if (n === r.value) continue; // already normal
    if (unique && n && (holders.get(n)?.length ?? 0) > 1) {
      stats.collisions++;
      const others = holders.get(n)!.filter((id) => id !== r.id);
      console.warn(
        `  COLLISION ${label}: "${r.value}" -> "${n}" (id ${r.id}) clashes with id(s) ${others.join(", ")}; left unchanged`,
      );
      continue;
    }
    stats.changed++;
    console.log(`  ${apply ? "FIX " : "WOULD FIX "}${label}: "${r.value}" -> ${n === null ? "NULL" : `"${n}"`} (id ${r.id})`);
    if (apply) await update(r.id, n);
  }
  return stats;
}

async function main() {
  console.log(apply ? "APPLYING changes\n" : "DRY RUN (no changes). Re-run with --apply to write.\n");

  const users = await db.user.findMany({
    select: { id: true, email: true, username: true, personalEmail: true },
  });
  const employees = await db.employee.findMany({
    select: { id: true, email: true, personalEmail: true, workEmail: true },
  });
  const invites = await db.onboardingInvite.findMany({ select: { id: true, email: true } });

  const all: Stats[] = [];
  all.push(
    await process_("User.email", true, users.map((u) => ({ id: u.id, value: u.email })), (id, v) =>
      db.user.update({ where: { id }, data: { email: v } }),
    ),
  );
  all.push(
    await process_("User.username", true, users.map((u) => ({ id: u.id, value: u.username })), (id, v) =>
      db.user.update({ where: { id }, data: { username: v } }),
    ),
  );
  all.push(
    await process_("User.personalEmail", false, users.map((u) => ({ id: u.id, value: u.personalEmail })), (id, v) =>
      db.user.update({ where: { id }, data: { personalEmail: v } }),
    ),
  );
  all.push(
    await process_("Employee.email", true, employees.map((e) => ({ id: e.id, value: e.email })), (id, v) =>
      db.employee.update({ where: { id }, data: { email: v } }),
    ),
  );
  all.push(
    await process_("Employee.personalEmail", false, employees.map((e) => ({ id: e.id, value: e.personalEmail })), (id, v) =>
      db.employee.update({ where: { id }, data: { personalEmail: v } }),
    ),
  );
  all.push(
    await process_("Employee.workEmail", false, employees.map((e) => ({ id: e.id, value: e.workEmail })), (id, v) =>
      db.employee.update({ where: { id }, data: { workEmail: v } }),
    ),
  );
  all.push(
    await process_("OnboardingInvite.email", false, invites.map((i) => ({ id: i.id, value: i.email })), (id, v) =>
      db.onboardingInvite.update({ where: { id }, data: { email: v } }),
    ),
  );

  console.log("\nSummary");
  let changed = 0;
  let collisions = 0;
  for (const s of all) {
    console.log(`  ${s.label.padEnd(24)} checked ${String(s.checked).padStart(5)}  ${apply ? "fixed" : "to fix"} ${String(s.changed).padStart(4)}  collisions ${s.collisions}`);
    changed += s.changed;
    collisions += s.collisions;
  }
  console.log(
    `\n${apply ? "Changed" : "Would change"} ${changed} value(s); ${collisions} collision(s) need manual review.`,
  );
  if (!apply && changed > 0) console.log("Run again with --apply to write these changes.");
  if (collisions > 0) process.exitCode = 2;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
