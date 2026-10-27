import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { uploadFile } from "@/lib/storage";
import { parsePunchPhoto, type PunchPhotoType } from "@/lib/punch-photo";

export function kioskProfilePhotoUrl(
  slug: string,
  type: PunchPhotoType,
  id: string,
  version: string,
) {
  return `/kiosk/${encodeURIComponent(slug)}/photo?${new URLSearchParams({ type, id, profile: "1", v: version })}`;
}

/** Called only after kiosk, active-person and personal-PIN checks. Never modifies attendance. */
export async function saveKioskProfilePhoto(
  type: PunchPhotoType,
  personId: string,
  photo: string,
) {
  const bytes = parsePunchPhoto(photo);
  if (!bytes) return null;
  // Immutable keys: a failed upload/DB write cannot replace the current portrait.
  const { key } = await uploadFile(
    "profile-pics",
    `kiosk/${type}/${personId}/${randomUUID()}.jpg`,
    bytes,
    {
      contentType: "image/jpeg",
    },
  );
  if (type === "employee") {
    await db.employee.update({
      where: { id: personId },
      data: { kioskProfilePhotoKey: key },
    });
  } else {
    await db.contractWorker.update({
      where: { id: personId },
      data: { kioskProfilePhotoKey: key },
    });
  }
  return key;
}
