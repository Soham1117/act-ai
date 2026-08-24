import { headers } from "next/headers";

/** Whether Set-Cookie should use the Secure flag for this request. */
export async function requestUsesHttps(): Promise<boolean> {
  if (process.env.COOKIE_SECURE === "true") return true;
  if (process.env.COOKIE_SECURE === "false") return false;

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? h.get("x-forwarded-protocol");
  if (proto) return proto.split(",")[0]!.trim() === "https";
  return false;
}
