import { db } from "@/lib/db";
import { uploadFile } from "@/lib/storage";
import {
  parsePunchPhoto,
  punchPhotoPath,
  type PunchPhotoSide,
  type PunchPhotoType,
} from "@/lib/punch-photo";

/**
 * Best-effort: validate, upload and record a kiosk punch photo on the entry.
 * Never throws. Returns the stored key, or null when there is no (valid) photo
 * or the upload failed — the punch itself is already done by then.
 */
export async function storePunchPhoto(args: {
  type: PunchPhotoType;
  entryId: string | null | undefined;
  side: PunchPhotoSide;
  photo: string | null | undefined;
}): Promise<string | null> {
  if (!args.entryId) return null;
  const bytes = parsePunchPhoto(args.photo);
  if (!bytes) return null;
  try {
    const { key } = await uploadFile(
      "kiosk-photos",
      punchPhotoPath(args.type, args.entryId, args.side),
      bytes,
      { contentType: "image/jpeg", upsert: true },
    );
    const data = args.side === "in" ? { clockInPhotoKey: key } : { clockOutPhotoKey: key };
    if (args.type === "employee") {
      await db.timeEntry.update({ where: { id: args.entryId }, data });
    } else {
      await db.contractTimeEntry.update({ where: { id: args.entryId }, data });
    }
    return key;
  } catch (err) {
    console.error("[kiosk-photo] upload failed", err);
    return null;
  }
}
