/**
 * Create or reset an admin user with a credentials password. Idempotent: safe
 * to re-run (resets the password, keeps the role, never duplicates rows).
 *
 *   pnpm tsx --env-file=.env.local scripts/create-admin.ts <email> <password> \
 *       [personalEmail] [--name "Full Name"] [--with-employee]
 *
 *   <email>          login email (stored trimmed + lowercase)
 *   <password>       at least 8 characters
 *   [personalEmail]  where 2FA codes go (required only if LOGIN_2FA_ENABLED=true;
 *                    a bootstrap admin has no Employee record to hold one)
 *   --name           display name (default "Admin"). A non-email third positional
 *                    argument is also accepted as the name, for older usage.
 *   --with-employee  also create a linked Employee record (EMP-YYYY-NNNN) so this
 *                    admin gets in-app notifications (e.g. "new hire awaiting
 *                    approval") and appears in the employee list. Skipped if the
 *                    user already has one.
 *
 * Re-running bumps tokenVersion, which signs out that user's existing sessions.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { nextEmployeeIdFrom } from "../src/lib/employee-create";
import { DEFAULT_KIOSK_PIN } from "../src/lib/kiosk-pin";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  let name: string | undefined;
  let withEmployee = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--name") name = argv[++i];
    else if (a.startsWith("--name=")) name = a.slice("--name=".length);
    else if (a === "--with-employee") withEmployee = true;
    else if (a.startsWith("--")) {
      console.error(`Unknown option ${a}`);
      process.exit(1);
    } else positional.push(a);
  }
  const [email, password, third, fourth] = positional;
  let personalEmail: string | undefined;
  if (third) {
    if (EMAIL_RE.test(third)) personalEmail = third;
    else if (!name) name = third; // legacy: third positional was the name
    else {
      console.error(`personalEmail "${third}" is not a valid email address.`);
      process.exit(1);
    }
  }
  if (fourth && !name) name = fourth;
  return { email, password, personalEmail, name, withEmployee };
}

function usage(): never {
  console.error(
    'Usage: tsx scripts/create-admin.ts <email> <password> [personalEmail] [--name "Full Name"] [--with-employee]',
  );
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
if (!args.email || !args.password) usage();

const email = args.email.trim().toLowerCase();
const personalEmail = args.personalEmail?.trim().toLowerCase();
const name = (args.name ?? "Admin").trim() || "Admin";

if (!EMAIL_RE.test(email)) {
  console.error(`"${args.email}" is not a valid email address.`);
  process.exit(1);
}
if (args.password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}
if (args.password.length > 72) {
  console.error("Password must be at most 72 characters (bcrypt limit).");
  process.exit(1);
}
if (process.env.LOGIN_2FA_ENABLED === "true" && !personalEmail) {
  console.error("LOGIN_2FA_ENABLED=true: a personalEmail is required so this admin can receive 2FA codes.");
  process.exit(1);
}

const db = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash(args.password!, 12);

  const user = await db.user.upsert({
    where: { email },
    create: {
      email,
      personalEmail: personalEmail ?? null,
      name,
      role: "ADMIN",
      passwordHash,
    },
    update: {
      role: "ADMIN",
      passwordHash,
      mustChangePassword: false,
      // Only overwrite these when explicitly provided on this run.
      ...(personalEmail ? { personalEmail } : {}),
      ...(args.name ? { name } : {}),
      tokenVersion: { increment: 1 },
    },
    select: { id: true, email: true, role: true, employee: { select: { id: true, employeeId: true } } },
  });

  let employeeId = user.employee?.employeeId ?? null;
  if (args.withEmployee && !user.employee) {
    const kioskPinHash = await bcrypt.hash(DEFAULT_KIOSK_PIN, 12);
    const year = new Date().getFullYear();
    employeeId = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('employee-id-seq'))`;
      const existing = await tx.employee.findMany({
        where: { employeeId: { startsWith: `EMP-${year}-` } },
        select: { employeeId: true },
      });
      const id = nextEmployeeIdFrom(
        existing.map((e) => e.employeeId),
        year,
      );
      await tx.employee.create({
        data: {
          employeeId: id,
          userId: user.id,
          name,
          email,
          personalEmail: personalEmail ?? null,
          gender: "OTHER",
          employmentType: "FULL_PART_TIME",
          compensationType: "MONTHLY_SALARY",
          dateOfHire: new Date(),
          kioskPinHash,
        },
      });
      return id;
    });
  }

  console.log("admin ready:", {
    id: user.id,
    email: user.email,
    role: user.role,
    employeeId,
  });
  if (!employeeId) {
    console.log(
      "note: this admin has no Employee record, so it gets no in-app notifications. Re-run with --with-employee to add one.",
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
