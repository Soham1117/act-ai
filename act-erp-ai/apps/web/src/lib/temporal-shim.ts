/**
 * Schedule-X v4 reads `Temporal` as a free global. It does not import
 * `temporal-polyfill` itself — every `Temporal.ZonedDateTime` reference in
 * its bundle resolves to whatever `globalThis.Temporal` happens to be at
 * call time.
 *
 * If the browser ships a partial native `Temporal` (Safari TP, Chrome
 * behind flags), our events — built with the polyfill class — fail
 * Schedule-X's `instanceof` checks against the native class, throwing:
 *
 *   [Schedule-X error]: Event start time needs to be a
 *   Temporal.ZonedDateTime or Temporal.PlainDate.
 *
 * The fix is to ALWAYS overwrite `globalThis.Temporal` with the polyfill so
 * Schedule-X and our event objects share one class identity. Import this
 * module for its side effects from any client component that uses
 * Schedule-X.
 */
import { Temporal } from "temporal-polyfill";

if (typeof globalThis !== "undefined") {
  (globalThis as { Temporal?: unknown }).Temporal = Temporal;
}

export { Temporal };
