import { db } from "@/lib/db";
import type { PunchPhotoType } from "@/lib/punch-photo";

/** One query per roster, restricted to the people already authorized for this kiosk. */
export async function latestKioskPhotoUrls(
  slug: string,
  type: PunchPhotoType,
  personIds: string[],
): Promise<Map<string, string>> {
  if (!personIds.length) return new Map();
  const photoFilter = {
    OR: [{ clockInPhotoKey: { not: null } }, { clockOutPhotoKey: { not: null } }],
  };
  const select = { id: true, clockInPhotoKey: true, clockOutPhotoKey: true } as const;
  const rows =
    type === "employee"
      ? (
          await db.timeEntry.findMany({
            where: { employeeId: { in: personIds }, ...photoFilter },
            orderBy: { clockIn: "desc" },
            distinct: ["employeeId"],
            select: { ...select, employeeId: true },
          })
        ).map((row) => ({ ...row, personId: row.employeeId }))
      : (
          await db.contractTimeEntry.findMany({
            where: { contractWorkerId: { in: personIds }, ...photoFilter },
            orderBy: { clockIn: "desc" },
            distinct: ["contractWorkerId"],
            select: { ...select, contractWorkerId: true },
          })
        ).map((row) => ({ ...row, personId: row.contractWorkerId }));
  return new Map(
    rows.map((row) => {
      const side = row.clockOutPhotoKey ? "out" : "in";
      const query = new URLSearchParams({ type, id: row.id, side });
      return [row.personId, `/kiosk/${encodeURIComponent(slug)}/photo?${query}`];
    }),
  );
}
