/**
 * The payroll hand-off workbook HR sends to the accountants: one sheet per pay
 * period in the Timeclock Plus "Period (Detail)" layout (per employee, one row
 * per week, a totals row, the salaried staff, then control totals). Every
 * payroll/hours Excel export uses this layout. Pure: no database access.
 */
import AdmZip from "adm-zip";
import { isoWeekStart, splitEntryOvertime } from "@/lib/payroll-overtime";

export type WorkbookEntry = {
  id: string;
  employeeId: string;
  /** Business calendar day, YYYY-MM-DD. */
  date: string;
  clockIn: number;
  totalWorkMin: number;
  jobCode: string;
  approvalStatus: string;
  employeeName: string;
};

export type WorkbookPeriod = {
  /** YYYY-MM-DD, inclusive */
  start: string;
  end: string;
};

/** Leave job codes get their own column; everything else is worked time. */
export const LEAVE_COLUMNS: Array<{ code: string; label: string }> = [
  { code: "102", label: "HOLIDAY" },
  { code: "100", label: "PTO" },
  { code: "101", label: "BEREAVEMENT" },
];

export type SheetCell = string | number | null;
export type SheetRowModel = {
  cells: SheetCell[];
  /** title/subtitle: centered banner; header: underlined; total: underlined person total; grand: bold control totals; plain: no column alignment. */
  style?: "title" | "subtitle" | "header" | "total" | "grand" | "plain";
  /** Cell indexes that hold minutes, written as Excel durations. */
  durationCols?: number[];
};
export type SheetModel = {
  name: string;
  widths: number[];
  rows: SheetRowModel[];
  /** Horizontal alignment per column. */
  align?: Align[];
  /** Cell ranges to merge, e.g. "A1:F1". */
  merges?: string[];
};

const mdy = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${m}/${d}/${y}`;
};
const sheetDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")}.${String(y).slice(2)}`;
};

export function periodSheetName(p: WorkbookPeriod): string {
  return `${sheetDate(p.start)} to ${sheetDate(p.end)}`;
}

type WeekBucket = { work: number; regular: number; overtime: number; leave: Map<string, number> };
type Sums = { hours: number; regular: number; overtime: number; leave: Map<string, number> };
const emptySums = (): Sums => ({ hours: 0, regular: 0, overtime: 0, leave: new Map() });

export function buildPeriodSheet(input: {
  period: WorkbookPeriod;
  /** Entries from the Monday of the period's first week through period end. */
  entries: WorkbookEntry[];
  salariedNames: string[];
  /** employeeId -> note for this period */
  notes: Map<string, string>;
}): SheetModel {
  const { period } = input;
  // Any non-rejected punch puts its week on the sheet, even at 0:00, as Timeclock Plus does.
  const paid = input.entries.filter((e) => e.approvalStatus !== "REJECTED");
  const leaveCodes = new Set(LEAVE_COLUMNS.map((c) => c.code));

  // Weekly overtime counts worked time only (leave never makes overtime).
  const byEmployee = new Map<string, WorkbookEntry[]>();
  for (const e of paid) byEmployee.set(e.employeeId, [...(byEmployee.get(e.employeeId) ?? []), e]);

  const people: Array<{ id: string; name: string; weeks: Map<string, WeekBucket> }> = [];
  const usedLeave = new Set<string>();
  for (const [id, list] of byEmployee) {
    const split = splitEntryOvertime(
      list
        .filter((e) => !leaveCodes.has(e.jobCode))
        .map((e) => ({ id: e.id, date: e.date, clockIn: e.clockIn, minutes: e.totalWorkMin })),
      period.start,
      period.end,
    );
    const weeks = new Map<string, WeekBucket>();
    for (const e of list) {
      if (e.date < period.start || e.date > period.end) continue;
      const wk = isoWeekStart(e.date);
      const b = weeks.get(wk) ?? { work: 0, regular: 0, overtime: 0, leave: new Map() };
      if (leaveCodes.has(e.jobCode)) {
        b.leave.set(e.jobCode, (b.leave.get(e.jobCode) ?? 0) + e.totalWorkMin);
        usedLeave.add(e.jobCode);
      } else {
        const s = split.get(e.id) ?? { regularMin: e.totalWorkMin, overtimeMin: 0 };
        b.work += e.totalWorkMin;
        b.regular += s.regularMin;
        b.overtime += s.overtimeMin;
      }
      weeks.set(wk, b);
    }
    if (weeks.size) people.push({ id, name: list[0]!.employeeName, weeks });
  }
  people.sort((a, b) => a.name.localeCompare(b.name));

  const leaveCols = LEAVE_COLUMNS.filter((c) => usedLeave.has(c.code));
  const hoursCols = [2, 3, 4, ...leaveCols.map((_, i) => 5 + i)];
  const lastHours = colName(hoursCols.at(-1)!);
  const sumCells = (s: Sums) => [
    s.hours,
    s.regular,
    s.overtime,
    ...leaveCols.map((c) => s.leave.get(c.code) ?? 0),
  ];
  const rows: SheetRowModel[] = [
    { cells: ["Period (Detail)"], style: "title" },
    { cells: [`For the period of ${mdy(period.start)} to ${mdy(period.end)}`], style: "subtitle" },
    // The notes column has no heading, like the HR file.
    { cells: ["Name", "Week Start", "Hours", "Regular", "Overtime 1", ...leaveCols.map((c) => c.label)], style: "header" },
  ];
  const merges = [`A1:${lastHours}1`, `A2:${lastHours}2`];

  const grand = emptySums();
  for (const p of people) {
    const total = emptySums();
    let first = true;
    for (const [wk, b] of [...p.weeks.entries()].sort((a, c) => (a[0] < c[0] ? -1 : 1))) {
      const week: Sums = {
        hours: b.work + [...b.leave.values()].reduce((s, v) => s + v, 0),
        regular: b.regular,
        overtime: b.overtime,
        leave: b.leave,
      };
      for (const s of [total, grand]) {
        s.hours += week.hours;
        s.regular += week.regular;
        s.overtime += week.overtime;
        for (const [code, min] of b.leave) s.leave.set(code, (s.leave.get(code) ?? 0) + min);
      }
      rows.push({
        cells: [first ? p.name : "", mdy(wk), ...sumCells(week), first ? (input.notes.get(p.id) ?? "") : ""],
        durationCols: hoursCols,
      });
      first = false;
    }
    rows.push({ cells: [`Totals for ${p.name}:`, "", ...sumCells(total)], style: "total", durationCols: hoursCols });
    merges.push(`A${rows.length}:B${rows.length}`);
  }

  const hourlyNames = new Set(people.map((p) => p.name));
  for (const name of [...input.salariedNames].sort((a, b) => a.localeCompare(b))) {
    if (hourlyNames.has(name)) continue;
    rows.push({ cells: [name, "Salary"], style: "plain" });
  }

  rows.push({ cells: [] });
  rows.push({ cells: ["Control Totals:", "", ...sumCells(grand)], style: "grand", durationCols: hoursCols });
  merges.push(`A${rows.length}:B${rows.length}`);

  return {
    name: periodSheetName(period),
    widths: [25, 11, 10, 10, 11.29, ...leaveCols.map(() => 9), 56.29],
    align: ["left", "center", ...hoursCols.map(() => "right" as const), "left"],
    merges,
    rows,
  };
}

// ── xlsx writing ────────────────────────────────────────────────────────────

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)
    // XML 1.0 forbids most control characters
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

function colName(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

type Align = "left" | "center" | "right";
type CellStyle = { font: 0 | 1 | 2 | 3; align?: Align; bottom?: boolean; duration?: boolean };
// fonts: 0 Tahoma 8 (default), 1 Tahoma 8 bold, 2 Tahoma 12 bold, 3 Tahoma 10 bold
const FONTS =
  `<font><sz val="8"/><name val="Tahoma"/></font><font><b/><sz val="8"/><name val="Tahoma"/></font>` +
  `<font><b/><sz val="12"/><name val="Tahoma"/></font><font><b/><sz val="10"/><name val="Tahoma"/></font>`;

/** The distinct cell formats a workbook uses; index 0 is the plain default. */
class StyleTable {
  private ids = new Map<string, number>([["0||0|0", 0]]);
  private xfs = [`<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`];
  id(s: CellStyle): number {
    const key = `${s.font}|${s.align ?? ""}|${s.bottom ? 1 : 0}|${s.duration ? 1 : 0}`;
    let id = this.ids.get(key);
    if (id === undefined) {
      id = this.xfs.length;
      this.ids.set(key, id);
      const base = `numFmtId="${s.duration ? 164 : 0}" fontId="${s.font}" fillId="0" borderId="${s.bottom ? 1 : 0}" xfId="0" applyFont="1" applyBorder="1" applyNumberFormat="1"`;
      this.xfs.push(
        s.align ? `<xf ${base} applyAlignment="1"><alignment horizontal="${s.align}"/></xf>` : `<xf ${base}/>`,
      );
    }
    return id;
  }
  xml(): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="[h]:mm"/></numFmts><fonts count="4">${FONTS}</fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${this.xfs.length}">${this.xfs.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  }
}

function cellStyle(row: SheetRowModel, ci: number, sheet: SheetModel, duration: boolean): CellStyle {
  const align = sheet.align?.[ci];
  switch (row.style) {
    case "title":
      return { font: 2, align: "center" };
    case "subtitle":
      return { font: 3, align: "center" };
    case "header":
      return { font: 0, align, bottom: true };
    case "total":
      return { font: 0, align: ci === 0 ? "right" : align, bottom: true, duration };
    case "grand":
      return { font: 1, align: ci === 0 ? "right" : align, duration };
    case "plain":
      return { font: 0 };
    default:
      return { font: 0, align, duration };
  }
}

function cellXml(value: SheetCell, ref: string, s: number, duration: boolean): string {
  const attr = s ? ` s="${s}"` : "";
  if (value === null || value === "") return s ? `<c r="${ref}"${attr}/>` : "";
  if (typeof value === "number") {
    // minutes -> fraction of a day, shown as [h]:mm
    return `<c r="${ref}"${attr}><v>${duration ? value / 1440 : value}</v></c>`;
  }
  return `<c r="${ref}"${attr} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

function sheetXml(sheet: SheetModel, styles: StyleTable): string {
  const cols = sheet.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  const rows = sheet.rows
    .map((r, ri) => {
      const cells = r.cells
        .map((v, ci) => {
          const duration = !!r.durationCols?.includes(ci) && typeof v === "number";
          return cellXml(v, `${colName(ci)}${ri + 1}`, styles.id(cellStyle(r, ci, sheet, duration)), duration);
        })
        .join("");
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join("");
  const merges = sheet.merges?.length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetFormatPr defaultRowHeight="12" customHeight="1"/><cols>${cols}</cols><sheetData>${rows}</sheetData>${merges}</worksheet>`;
}

function safeSheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[[\]:*?/\\]/g, "-").slice(0, 31) || "Sheet";
  let n = 2;
  while (used.has(base.toLowerCase())) base = `${name.slice(0, 27)} (${n++})`;
  used.add(base.toLowerCase());
  return base;
}

export function buildWorkbookXlsx(sheets: SheetModel[]): Buffer {
  const zip = new AdmZip();
  const used = new Set<string>();
  const names = sheets.map((s) => safeSheetName(s.name, used));
  zip.addFile(
    "[Content_Types].xml",
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join("")}</Types>`,
    ),
  );
  zip.addFile(
    "_rels/.rels",
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
  );
  zip.addFile(
    "xl/workbook.xml",
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
        .map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join("")}</sheets></workbook>`,
    ),
  );
  zip.addFile(
    "xl/_rels/workbook.xml.rels",
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
  );
  const styles = new StyleTable();
  sheets.forEach((s, i) => zip.addFile(`xl/worksheets/sheet${i + 1}.xml`, Buffer.from(sheetXml(s, styles))));
  zip.addFile("xl/styles.xml", Buffer.from(styles.xml()));
  return zip.toBuffer();
}
