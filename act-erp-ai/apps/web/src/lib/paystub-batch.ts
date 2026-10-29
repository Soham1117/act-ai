/** Shared limits for both source analysis and confirmation. */
export const MAX_PAYSTUB_BYTES = 10 * 1024 * 1024;
export const MAX_PAYSTUB_PAGES = 200;

/** Reject JavaScript's date rollover (for example, February 30). */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1900 || year > 9999) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
