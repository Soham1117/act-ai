/**
 * Reset every employee's kiosk PIN to the temporary default (3214). Each person
 * must choose a new 4-digit PIN on their next kiosk punch.
 *
 *   pnpm tsx --env-file=.env.local scripts/reset-all-kiosk-pins.ts
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DEFAULT_KIOSK_PIN } from "../src/lib/kiosk-pin";

async function main() {
  const db = new PrismaClient();
  try {
    const hash = await bcrypt.hash(DEFAULT_KIOSK_PIN, 12);
    const res = await db.employee.updateMany({ data: { kioskPinHash: hash } });
    console.log(`Reset kiosk PIN for ${res.count} employees.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
