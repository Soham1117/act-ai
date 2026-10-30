"use client";

import { useEffect } from "react";
import { compareKeys, sortKey } from "@/lib/table-sort";

/**
 * Makes every data table sortable: click a column header to sort, click again
 * to reverse. It attaches to tables as they appear, so no table needs its own
 * sorting code.
 *
 * A table is left alone when it already has sort controls (buttons or
 * aria-sort in its header), has grouped headers, or sits inside an element
 * marked `data-no-sort`. A cell can set `data-sort-value` to sort by something
 * other than its visible text. A body row with a single wide cell is treated as
 * the detail of the row above it and moves with it.
 */

const CSS = `
th[data-sortable]{cursor:pointer;user-select:none;white-space:nowrap}
th[data-sortable]::after{content:"\\2195";margin-left:.35em;opacity:.3;font-size:.85em}
th[data-sortable]:hover::after{opacity:.7}
th[data-sortable][aria-sort="ascending"]::after{content:"\\2191";opacity:1}
th[data-sortable][aria-sort="descending"]::after{content:"\\2193";opacity:1}
th[data-sortable]:focus-visible{outline:2px solid currentColor;outline-offset:-2px}
@media print{th[data-sortable]::after{display:none}}
`;

type State = { col: number; dir: "asc" | "desc" };
const states = new WeakMap<HTMLTableElement, State>();
const busy = new WeakSet<HTMLTableElement>();

function eligible(table: HTMLTableElement): boolean {
  if (table.closest("[data-no-sort]")) return false;
  if (!table.tHead || table.tHead.rows.length !== 1) return false;
  if (table.tBodies.length !== 1) return false;
  const header = table.tHead.rows[0]!;
  for (const th of Array.from(header.cells)) {
    if (th.colSpan > 1 || th.hasAttribute("aria-sort") || th.querySelector("button, a, input, select")) return false;
  }
  return true;
}

function isDetailRow(row: HTMLTableRowElement): boolean {
  return row.cells.length === 1 && row.cells[0]!.colSpan > 1;
}

function cellValue(row: HTMLTableRowElement, col: number): string {
  const cell = row.cells[col];
  if (!cell) return "";
  return cell.dataset.sortValue ?? cell.textContent ?? "";
}

function applySort(table: HTMLTableElement, state: State) {
  const body = table.tBodies[0]!;
  const groups: HTMLTableRowElement[][] = [];
  for (const row of Array.from(body.rows)) {
    if (isDetailRow(row) && groups.length) groups[groups.length - 1]!.push(row);
    else groups.push([row]);
  }
  const keyed = groups.map((rows, i) => ({ rows, i, key: sortKey(cellValue(rows[0]!, state.col)) }));
  keyed.sort((a, b) => compareKeys(a.key, b.key, state.dir) || a.i - b.i);
  const fragment = document.createDocumentFragment();
  for (const g of keyed) for (const r of g.rows) fragment.appendChild(r);
  busy.add(table);
  body.appendChild(fragment);
  // Mutation records are delivered later; release after they were seen.
  setTimeout(() => busy.delete(table), 0);
}

function markHeaders(table: HTMLTableElement, state: State | undefined) {
  const header = table.tHead!.rows[0]!;
  Array.from(header.cells).forEach((th, i) => {
    if (!th.hasAttribute("data-sortable")) return;
    th.setAttribute(
      "aria-sort",
      state && state.col === i ? (state.dir === "asc" ? "ascending" : "descending") : "none",
    );
  });
}

function enhance(table: HTMLTableElement) {
  table.dataset.sorter = "1";
  if (!eligible(table)) return;
  const header = table.tHead!.rows[0]!;
  let any = false;
  Array.from(header.cells).forEach((th) => {
    if (!(th.textContent ?? "").trim()) return; // checkbox / action columns
    th.setAttribute("data-sortable", "");
    th.setAttribute("tabindex", "0");
    th.setAttribute("aria-sort", "none");
    any = true;
  });
  if (!any) return;

  const sortBy = (th: HTMLTableCellElement) => {
    const col = th.cellIndex;
    const prev = states.get(table);
    const dir: State["dir"] = prev && prev.col === col && prev.dir === "asc" ? "desc" : "asc";
    const next = { col, dir };
    states.set(table, next);
    markHeaders(table, next);
    applySort(table, next);
  };
  header.addEventListener("click", (e) => {
    const th = (e.target as Element).closest("th[data-sortable]");
    if (th) sortBy(th as HTMLTableCellElement);
  });
  header.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const th = (e.target as Element).closest("th[data-sortable]");
    if (!th) return;
    e.preventDefault();
    sortBy(th as HTMLTableCellElement);
  });

  // Keep the chosen order when the page adds or replaces rows.
  let timer: ReturnType<typeof setTimeout> | undefined;
  new MutationObserver(() => {
    if (busy.has(table)) return;
    const state = states.get(table);
    if (!state) return;
    clearTimeout(timer);
    timer = setTimeout(() => applySort(table, state), 30);
  }).observe(table.tBodies[0]!, { childList: true });
}

export function TableSorter() {
  useEffect(() => {
    const scan = () => {
      document.querySelectorAll<HTMLTableElement>("table:not([data-sorter])").forEach(enhance);
    };
    scan();
    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(scan);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  return <style>{CSS}</style>;
}
