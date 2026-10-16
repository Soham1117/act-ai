/**
 * Whether punches at a kiosk need the employee PIN. Decided only from the
 * kiosk session row read on the server. Fails closed: anything other than an
 * explicit `false` (missing row, missing column) counts as "PIN required".
 */
export function kioskNeedsPin(session: { requirePin?: boolean | null } | null | undefined): boolean {
  return session?.requirePin !== false;
}
