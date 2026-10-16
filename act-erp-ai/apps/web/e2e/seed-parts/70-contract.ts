import { createHash } from "node:crypto";
import type { SeedContext } from "../seed";
import {
  CW_AGENCY,
  CW_JOB,
  CW_KIOSK_COUNT,
  CW_SEED_DORMANT_WORKER,
  CW_SEED_OLDCODE_WORKER,
  cwKioskSlug,
  cwKioskSuffix,
} from "../support/contract-data";

/** Contract-worker area: own agencies, job codes, workers and kiosks. */
export default async function (ctx: SeedContext) {
  const { db, admin, daysAgo } = ctx;

  const alpha = await db.staffingAgency.create({ data: { name: CW_AGENCY.alpha } });
  await db.staffingAgency.create({ data: { name: CW_AGENCY.beta } });
  await db.staffingAgency.create({ data: { name: CW_AGENCY.existing } });
  const dormant = await db.staffingAgency.create({
    data: { name: CW_AGENCY.dormant, isActive: false },
  });

  await db.jobCode.create({ data: { ...CW_JOB.active, rate: "NA", isActive: true } });
  await db.jobCode.create({ data: { ...CW_JOB.second, rate: "NA", isActive: true } });
  await db.jobCode.create({ data: { ...CW_JOB.inactive, rate: "NA", isActive: false } });

  await db.contractWorker.create({
    data: {
      ...CW_SEED_DORMANT_WORKER,
      agencyId: dormant.id,
      jobCode: CW_JOB.active.code,
      startDate: daysAgo(20),
      createdById: admin.id,
    },
  });
  await db.contractWorker.create({
    data: {
      ...CW_SEED_OLDCODE_WORKER,
      agencyId: alpha.id,
      jobCode: CW_JOB.inactive.code, // retired after assignment
      startDate: daysAgo(20),
      createdById: admin.id,
    },
  });

  const expiresAt = new Date(Date.now() + 90 * 86_400_000);
  const cookie = process.env.E2E_KIOSK_COOKIE;
  if (!cookie) throw new Error("E2E_KIOSK_COOKIE missing");
  for (let n = 1; n <= CW_KIOSK_COUNT; n++) {
    await db.kioskSession.create({
      data: {
        slug: cwKioskSlug(n),
        label: `E2E Contract Kiosk ${n}`,
        provisionedBy: admin.id,
        expiresAt,
        cookieHash: createHash("sha256")
          .update(cookie + cwKioskSuffix(n))
          .digest("hex"),
      },
    });
  }
}
