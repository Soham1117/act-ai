/**
 * The payroll hand-off workbook HR sends to the accountants: one sheet per pay
 * period in the Timeclock Plus "Period (Detail)" layout (per employee, one row
 * per week, a totals row, then the salaried staff). Pure: no database access.
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
const LEAVE_COLUMNS: Array<{ code: string; label: string }> = [
  { code: "102", label: "HOLIDAY" },
  { code: "100", label: "PTO" },
  { code: "101", label: "BEREAVEMENT" },
];

export type SheetCell = string | number | null;
export type SheetRowModel = {
  cells: SheetCell[];
  style?: "title" | "header" | "total" | "note";
  /** Cell indexes that hold minutes, written as Excel durations. */
  durationCols?: number[];
};
export type SheetModel = { name: string; widths: number[]; rows: SheetRowModel[] };

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

export function buildPeriodSheet(input: {
  period: WorkbookPeriod;
  /** Entries from the Monday of the period's first week through period end. */
  entries: WorkbookEntry[];
  salariedNames: string[];
  /** employeeId -> note for this period */
  notes: Map<string, string>;
}): SheetModel {
  const { period } = input;
  const paid = input.entries.filter(
    (e) => e.totalWorkMin > 0 && e.approvalStatus !== "REJECTED",
  );
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
  const header = ["Name", "Week Start", "Hours", "Regular", "Overtime 1", ...leaveCols.map((c) => c.label), "Notes"];
  const hoursCols = [2, 3, 4, ...leaveCols.map((_, i) => 5 + i)];
  const rows: SheetRowModel[] = [
    { cells: ["Period (Detail)"], style: "title" },
    { cells: [`For the period of ${mdy(period.start)} to ${mdy(period.end)}`] },
    { cells: header, style: "header" },
  ];

  for (const p of people) {
    const total = { hours: 0, regular: 0, overtime: 0, leave: new Map<string, number>() };
    let first = true;
    for (const [wk, b] of [...p.weeks.entries()].sort((a, c) => (a[0] < c[0] ? -1 : 1))) {
      const leaveMin = [...b.leave.values()].reduce((s, v) => s + v, 0);
      total.hours += b.work + leaveMin;
      total.regular += b.regular;
      total.overtime += b.overtime;
      for (const [code, min] of b.leave) total.leave.set(code, (total.leave.get(code) ?? 0) + min);
      rows.push({
        cells: [
          first ? p.name : "",
          mdy(wk),
          b.work + leaveMin,
          b.regular,
          b.overtime,
          ...leaveCols.map((c) => b.leave.get(c.code) ?? 0),
          first ? (input.notes.get(p.id) ?? "") : "",
        ],
        durationCols: hoursCols,
      });
      first = false;
    }
    rows.push({
      cells: [
        `Totals for ${p.name}:`,
        "",
        total.hours,
        total.regular,
        total.overtime,
        ...leaveCols.map((c) => total.leave.get(c.code) ?? 0),
        "",
      ],
      style: "total",
      durationCols: hoursCols,
    });
  }

  const hourlyNames = new Set(people.map((p) => p.name));
  for (const name of [...input.salariedNames].sort((a, b) => a.localeCompare(b))) {
    if (hourlyNames.has(name)) continue;
    rows.push({ cells: [name, "Salary"] });
  }

  return {
    name: periodSheetName(period),
    widths: [34, 14, 10, 10, 12, ...leaveCols.map(() => 12), 60],
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

// style ids: 0 default, 1 bold, 2 duration, 3 bold duration
function cellXml(value: SheetCell, ref: string, bold: boolean, duration: boolean): string {
  if (value === null || value === "") return bold ? `<c r="${ref}" s="1"/>` : "";
  if (typeof value === "number") {
    // minutes -> fraction of a day, shown as [h]:mm
    const v = duration ? value / 1440 : value;
    return `<c r="${ref}" s="${duration ? (bold ? 3 : 2) : bold ? 1 : 0}"><v>${v}</v></c>`;
  }
  return `<c r="${ref}"${bold ? ' s="1"' : ""} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

function sheetXml(sheet: SheetModel): string {
  const cols = sheet.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  const rows = sheet.rows
    .map((r, ri) => {
      const bold = r.style === "title" || r.style === "header" || r.style === "total";
      const cells = r.cells
        .map((v, ci) =>
          cellXml(v, `${colName(ci)}${ri + 1}`, bold, !!r.durationCols?.includes(ci) && typeof v === "number"),
        )
        .join("");
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${rows}</sheetData></worksheet>`;
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
  zip.addFile(
    "xl/styles.xml",
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="[h]:mm"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs></styleSheet>`,
    ),
  );
  sheets.forEach((s, i) => zip.addFile(`xl/worksheets/sheet${i + 1}.xml`, Buffer.from(sheetXml(s))));
  return zip.toBuffer();
}
