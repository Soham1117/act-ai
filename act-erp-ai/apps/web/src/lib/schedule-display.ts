import { formatHHMM } from "@/lib/schedule-rules";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** "YYYY-MM-DD HH:mm" -> "HH:mm". */
function clock(s: string): string {
  return s.slice(11, 16);
}

/**
 * Event text built from the stored "HH:mm" values. Schedule-X formats the
 * time from an instant, so a wall-clock time inside a DST gap (2:30 AM on the
 * spring-forward day) would read 3:30 AM. These strings keep what was stored.
 * The instant is only used to place the event on the grid.
 */
export function storedTimeContent(e: { title: string; start: string; end: string }) {
  const startText = formatHHMM(clock(e.start));
  const endText = formatHHMM(clock(e.end));
  const title = esc(e.title);
  return {
    monthGrid:
      `<div class="sx__month-grid-event-time">${startText}</div>` +
      `<div class="sx__month-grid-event-title">${title}</div>`,
    timeGrid:
      `<div class="sx__time-grid-event-title">${title}</div>` +
      `<div class="sx__time-grid-event-time">${startText} – ${endText}</div>`,
    monthAgenda:
      `<div class="sx__month-agenda-event__title">${title}</div>` +
      `<div class="sx__month-agenda-event__time">${startText} – ${endText}</div>`,
  };
}
