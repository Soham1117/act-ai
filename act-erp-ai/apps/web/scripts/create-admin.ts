/**
 * Create or reset an admin user with a credentials password.
 *
 *   pnpm tsx --env-file=.env.local scripts/create-admin.ts <email> <password> [name]
 *
 * Idempotent: upserts by email, sets role=ADMIN, hashes the password, and bumps
 * tokenVersion so any older sessions for that email are revoked.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const [, , email, password, name] = process.argv;

if (!email || !password) {
  console.error("Usage: tsx scripts/create-admin.ts <email> <password> [name]");
  process.exit(1);
}

const db = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await db.user.upsert({
    where: { email: email.toLowerCase() },
    create: {
      email: email.toLowerCase(),
      name: name ?? "Admin",
      role: "ADMIN",
      passwordHash,
    },
    update: {
      role: "ADMIN",
      passwordHash,
      tokenVersion: { increment: 1 },
    },
    select: { id: true, email: true, role: true },
  });
  console.log("admin ready:", user);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
