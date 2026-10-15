/** Pure helpers for kiosk punch photos (no I/O, safe to import anywhere). */

export const PUNCH_PHOTO_PREFIX = "data:image/jpeg;base64,";
export const PUNCH_PHOTO_MAX_BYTES = 400 * 1024;

export type PunchPhotoType = "employee" | "contract";
export type PunchPhotoSide = "in" | "out";

/**
 * Decode a kiosk photo data URL. Returns the JPEG bytes, or null when the value
 * is missing, too large, or is not a real JPEG. Callers ignore null (the punch
 * still goes through).
 */
export function parsePunchPhoto(dataUrl: string | null | undefined): Buffer | null {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith(PUNCH_PHOTO_PREFIX)) return null;
  const b64 = dataUrl.slice(PUNCH_PHOTO_PREFIX.length);
  // Cheap size guard before decoding: base64 is ~4/3 of the byte size.
  if (b64.length > Math.ceil((PUNCH_PHOTO_MAX_BYTES * 4) / 3) + 4) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  const bytes = Buffer.from(b64, "base64");
  if (bytes.length === 0 || bytes.length > PUNCH_PHOTO_MAX_BYTES) return null;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  return bytes;
}

/** Storage path (inside the "kiosk-photos" bucket prefix) for a punch photo. */
export function punchPhotoPath(
  type: PunchPhotoType,
  entryId: string,
  side: PunchPhotoSide,
  when: Date = new Date(),
): string {
  const yyyy = String(when.getUTCFullYear());
  const mm = String(when.getUTCMonth() + 1).padStart(2, "0");
  return `${type}/${yyyy}/${mm}/${entryId}-${side}.jpg`;
}
