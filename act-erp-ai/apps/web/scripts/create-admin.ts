/**
 * Create or reset an admin user with a credentials password.
 *
 *   pnpm tsx --env-file=.env.local scripts/create-admin.ts <email> <password> <personalEmail> [name]
 *
 * personalEmail is where 2FA sign-in codes go — required, since login now
 * always requires a second factor and a bootstrap admin has no Employee
 * record for Employee.personalEmail to live on (see User.personalEmail in
 * schema.prisma). Without it this admin could never actually sign in.
 *
 * Idempotent: upserts by email, sets role=ADMIN, hashes the password, and bumps
 * tokenVersion so any older sessions for that email are revoked.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const [, , email, password, personalEmail, name] = process.argv;

if (!email || !password || !personalEmail) {
  console.error("Usage: tsx scripts/create-admin.ts <email> <password> <personalEmail> [name]");
  process.exit(1);
}

const db = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await db.user.upsert({
    where: { email: email.toLowerCase() },
    create: {
      email: email.toLowerCase(),
      personalEmail,
      name: name ?? "Admin",
      role: "ADMIN",
      passwordHash,
    },
    update: {
      role: "ADMIN",
      passwordHash,
      personalEmail,
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
