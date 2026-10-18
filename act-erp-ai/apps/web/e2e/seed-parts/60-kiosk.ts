/** Kiosk area (slot 6): one kiosk per scenario, plus dedicated employees. */
import type { SeedContext } from "../seed";
import {
  EMP,
  IP_LOCK_EMPS,
  KIOSK_NAMES,
  NO_PIN_KIOSKS,
  PASSWORD_FOR,
  emailFor,
  kioskCookie,
  kioskSlug,
  sha256,
  type Emp,
} from "../support/kiosk";

export default async function seedKiosk(ctx: SeedContext) {
  const { db, daysAgo, makeEmployee } = ctx;
  const DAY = 24 * 60 * 60 * 1000;

  const people: Emp[] = [...Object.values(EMP), ...IP_LOCK_EMPS];
  for (const e of people) {
    const terminated = e.status === "TERMINATED";
    const created = await makeEmployee({
      employeeId: e.employeeId,
      name: e.name,
      email: emailFor(e),
      password: PASSWORD_FOR(e),
      status: terminated ? "TERMINATED" : "ACTIVE",
      terminationDate: terminated ? daysAgo(200) : undefined,
      pin: e.employeeId === EMP.temp.employeeId ? "3214" : undefined,
    });
    if (e.jobTitle) {
      await db.employee.update({ where: { id: created.id }, data: { jobTitle: e.jobTitle } });
    }
  }

  for (const name of KIOSK_NAMES) {
    const base = {
      slug: kioskSlug(name),
      label: `K6 ${name}`,
      provisionedBy: ctx.admin.id,
      expiresAt: new Date(Date.now() + 90 * DAY),
      cookieHash: sha256(kioskCookie(name)) as string | null,
      revokedAt: null as Date | null,
      requirePin: !NO_PIN_KIOSKS.includes(name),
    };
    const special: Record<string, Partial<typeof base>> = {
      "adm-expired": { expiresAt: new Date(Date.now() - 3 * DAY) },
      "adm-expiring": { expiresAt: new Date(Date.now() + 5 * DAY) },
      "sess-slide": { expiresAt: new Date(Date.now() + 10 * DAY) },
      "adm-revoked": { revokedAt: new Date(Date.now() - DAY), cookieHash: null },
      "adm-inactive": { cookieHash: null },
    };
    await db.kioskSession.create({ data: { ...base, ...(special[name] ?? {}) } });
  }
}
