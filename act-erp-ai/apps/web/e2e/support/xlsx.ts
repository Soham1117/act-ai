import { readFile } from "node:fs/promises";
import AdmZip from "adm-zip";
import type { Download } from "@playwright/test";
import { isoWeekStart } from "../../src/lib/payroll-overtime";
import { readSheetRows } from "../../src/test-utils/read-xlsx";

/** A downloaded Period (Detail) workbook: file name, sheet names, and the first sheet as display rows. */
export async function readPeriodWorkbook(file: Download) {
  const buf = await readFile((await file.path())!);
  const zip = new AdmZip(buf);
  const sheets = [...zip.readAsText("xl/workbook.xml").matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1]!);
  return { filename: file.suggestedFilename(), sheets, rows: readSheetRows(buf), xml: zip.readAsText("xl/worksheets/sheet1.xml") };
}

/** "Week Start" cell for a YYYY-MM-DD day, e.g. "9/14/2026". */
export function weekStartCell(ymd: string): string {
  const [y, m, d] = isoWeekStart(ymd).split("-").map(Number) as [number, number, number];
  return `${m}/${d}/${y}`;
}

/** The rows for one person: week rows through their "Totals for" row. */
export function personRows(rows: string[][], name: string): string[][] {
  const start = rows.findIndex((r) => r[0] === name);
  if (start < 0) return [];
  const end = rows.findIndex((r, i) => i > start && r[0] === `Totals for ${name}:`);
  return rows.slice(start, end + 1);
}
