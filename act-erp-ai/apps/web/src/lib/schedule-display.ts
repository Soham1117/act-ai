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

type ListEvent = { title: string; start: string; end: string };

/**
 * Schedule-X's List view has no hook for custom text and formats times from the
 * already-resolved instant, so a gap time (02:30 -> 03:30) shows the moved time.
 * Rewrite the time labels from the stored values. Safe to call repeatedly.
 */
export function patchListTimes(root: ParentNode, events: ListEvent[]): void {
  const byKey = new Map<string, ListEvent[]>();
  for (const e of events) {
    const k = `${e.start.slice(0, 10)}|${e.title}`;
    byKey.set(k, [...(byKey.get(k) ?? []), e]);
  }
  const seen = new Map<string, number>();
  const set = (el: Element | null, text: string) => {
    if (el && el.textContent !== text) el.textContent = text;
  };
  root.querySelectorAll(".sx__list-day").forEach((day) => {
    const date = day.getAttribute("data-date") ?? "";
    day.querySelectorAll(".sx__list-event").forEach((el) => {
      const title = el.querySelector(".sx__list-event-title")?.textContent ?? "";
      const startKey = `${date}|${title}`;
      const starts = byKey.get(startKey);
      if (starts) {
        const i = seen.get(startKey) ?? 0;
        seen.set(startKey, i + 1);
        const ev = starts[i];
        if (ev) {
          set(el.querySelector(".sx__list-event-start-time"), formatHHMM(clock(ev.start)));
          // Same-day shift: the end label sits on the same row.
          if (ev.end.slice(0, 10) === date) {
            set(el.querySelector(".sx__list-event-end-time"), formatHHMM(clock(ev.end)));
          }
        }
        return;
      }
      // Last day of an overnight shift: only the end label is shown.
      const endOnly = el.querySelector(".sx__list-event-end-time");
      if (!endOnly || el.querySelector(".sx__list-event-start-time")) return;
      const ev = events.find((x) => x.end.slice(0, 10) === date && x.title === title);
      if (ev) set(endOnly, formatHHMM(clock(ev.end)));
    });
  });
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
