import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem, TextMarkedContent } from "pdfjs-dist/types/src/display/api";

export type ParsedPaystub = {
  employeeName: string | null;
  ssnLast4: string | null;
  payPeriodStart: string | null; // YYYY-MM-DD
  payPeriodEnd: string | null; // YYYY-MM-DD
  payDate: string | null; // YYYY-MM-DD
  checkNumber: string | null;
  netPay: number | null;
};

const MAX_BYTES = 5 * 1024 * 1024;
const SSN_RE = /\*\*\*-\*\*-(\d{4})/;
const PAY_PERIOD_RE = /Pay Period:\s*(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/;
const PAY_DATE_RE = /Pay Date:\s*(\d{2}\/\d{2}\/\d{4})/;
const CHECK_NUMBER_RE = /Check number:\s*(\S+)/;
const AMOUNT_RE = /-?[\d,]+\.\d{2}/;

function mdyToIso(mdy: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(mdy);
  if (!m) return null;
  const [, month, day, year] = m;
  return `${year}-${month}-${day}`;
}

type Row = { y: number; text: string };

function extractRows(items: TextItem[]): Row[] {
  const buckets = new Map<number, { x: number; str: string }[]>();
  for (const item of items) {
    const str = item.str?.trim();
    if (!str) continue;
    const y = Math.round(item.transform[5] / 3) * 3;
    const x = item.transform[4];
    if (!buckets.has(y)) buckets.set(y, []);
    buckets.get(y)!.push({ x, str });
  }
  return [...buckets.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([y, parts]) => ({
      y,
      text: parts
        .sort((a, b) => a.x - b.x)
        .map((p) => p.str)
        .join(" "),
    }));
}

/**
 * Deterministic, position-based extraction tuned to this company's payroll
 * provider template — no OCR, no ML. Returns null only when the file isn't a
 * readable PDF at all; otherwise returns whatever fields were found (each
 * field independently, so a partially-matching template still yields partial
 * data) — callers must treat every field as possibly null and fall back to
 * manual entry, never trust this as a sole source of truth.
 */
export async function parsePaystub(
  bytes: ArrayBuffer,
  mimeType: string,
): Promise<ParsedPaystub | null> {
  if (mimeType !== "application/pdf") return null;
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return null;

  try {
    const doc = await getDocument({
      data: new Uint8Array(bytes),
      useWorkerFetch: false,
      isEvalSupported: false,
      disableFontFace: true,
    }).promise;
    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    const items = content.items.filter(
      (i): i is TextItem => "str" in i,
    ) as TextItem[];
    const rows = extractRows(items);
    const fullText = rows.map((r) => r.text).join("\n");

    const ssnMatch = SSN_RE.exec(fullText);
    const ssnRow = ssnMatch ? rows.find((r) => r.text.includes(ssnMatch[0])) : undefined;
    const employeeName = ssnRow
      ? ssnRow.text.split(",")[0]?.trim().replace(SSN_RE, "").trim() || null
      : null;

    const periodMatch = PAY_PERIOD_RE.exec(fullText);
    const payDateMatch = PAY_DATE_RE.exec(fullText);
    const checkMatch = CHECK_NUMBER_RE.exec(fullText);

    const netPayRow = rows.find((r) => /^Net Pay\b/.test(r.text));
    const netPayMatch = netPayRow ? AMOUNT_RE.exec(netPayRow.text) : null;

    return {
      employeeName,
      ssnLast4: ssnMatch ? ssnMatch[1] : null,
      payPeriodStart: periodMatch ? mdyToIso(periodMatch[1]) : null,
      payPeriodEnd: periodMatch ? mdyToIso(periodMatch[2]) : null,
      payDate: payDateMatch ? mdyToIso(payDateMatch[1]) : null,
      checkNumber: checkMatch ? checkMatch[1] : null,
      netPay: netPayMatch ? Number(netPayMatch[0].replace(/,/g, "")) : null,
    };
  } catch {
    // Encrypted, corrupt, or unrecognized PDF structure — not a readable
    // paystub from this template. Manual entry required.
    return null;
  }
}
