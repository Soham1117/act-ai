import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { isCalendarDate, MAX_PAYSTUB_BYTES, MAX_PAYSTUB_PAGES } from "./paystub-batch";

export type ParsedPaystub = {
  employeeName: string | null;
  ssnLast4: string | null;
  payPeriodStart: string | null;
  payPeriodEnd: string | null;
  payDate: string | null;
  checkNumber: string | null;
  netPay: number | null;
};
export type PaystubTextRow = { y: number; text: string };
export type PaystubPageAnalysis = {
  status: "SUPPORTED" | "OCR_REQUIRED" | "UNSUPPORTED";
  reason: string | null;
  parsed: ParsedPaystub | null;
};
export type PaystubPdfAnalysis = {
  pageCount: number;
  pages: (PaystubPageAnalysis & { pageNumber: number })[];
};
const SSN_RE = /\*\*\*-\*\*-(\d{4})/;
const IDENTITY_RE = /(?:\*{3}|\d{3})-(?:\*{2}|\d{2})-\d{4}/g;
const PAY_PERIOD_RE = /Pay Period:\s*(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/i;
const PAY_DATE_RE = /Pay Date:\s*(\d{2}\/\d{2}\/\d{4})/i;
const CHECK_NUMBER_RE = /Check number:\s*([^\s]+)/i;
const AMOUNT_RE = /-?[\d,]+\.\d{2}/;
const STUB_RE = /\bEmployee Pay Stub\b/gi;
const SUMMARY_RE =
  /\b(?:payroll\s+(?:summary|register|report)|employee\s+(?:payroll\s+)?summary|check\s+register|earnings\s+register)\b/i;
const CONTINUATION_RE = /\b(?:continued|continuation|page\s+[2-9]\d*\s+of\s+\d+)\b/i;

function mdyToIso(mdy: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(mdy);
  if (!match) return null;
  const value = `${match[3]}-${match[1]}-${match[2]}`;
  return isCalendarDate(value) ? value : null;
}
function extractRows(items: TextItem[]): PaystubTextRow[] {
  const buckets = new Map<number, { x: number; str: string }[]>();
  for (const item of items) {
    const str = item.str?.trim();
    if (!str) continue;
    const y = Math.round(item.transform[5] / 3) * 3;
    const parts = buckets.get(y) ?? [];
    parts.push({ x: item.transform[4], str });
    buckets.set(y, parts);
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
/** Pure provider-template extraction; OCR may supply the same positioned rows. */
export function parsePaystubPageRows(rows: readonly PaystubTextRow[]): ParsedPaystub {
  const fullText = rows.map((row) => row.text).join("\n");
  const ssnMatch = SSN_RE.exec(fullText);
  const identityRow = ssnMatch
    ? rows.find((row) => row.text.includes(ssnMatch[0]))
    : undefined;
  const name = identityRow?.text.split(",")[0]?.replace(SSN_RE, "").trim();
  const employeeName =
    name &&
    name.length <= 160 &&
    /^[\p{L}\p{M} .,'’-]+$/u.test(name) &&
    name.split(/\s+/).filter((token) => /\p{L}/u.test(token)).length >= 2
      ? name
      : null;
  const period = PAY_PERIOD_RE.exec(fullText);
  let payPeriodStart = period ? mdyToIso(period[1]) : null;
  let payPeriodEnd = period ? mdyToIso(period[2]) : null;
  if (payPeriodStart && payPeriodEnd && payPeriodStart > payPeriodEnd) {
    payPeriodStart = null;
    payPeriodEnd = null;
  }
  const payDate = PAY_DATE_RE.exec(fullText);
  const check = CHECK_NUMBER_RE.exec(fullText);
  const netPayRow = rows.find((row) => /^Net Pay\b/i.test(row.text));
  const netPay = netPayRow ? AMOUNT_RE.exec(netPayRow.text) : null;
  return {
    employeeName,
    ssnLast4: ssnMatch?.[1] ?? null,
    payPeriodStart,
    payPeriodEnd,
    payDate: payDate ? mdyToIso(payDate[1]) : null,
    checkNumber: check && check[1].length <= 80 ? check[1] : null,
    netPay: netPay ? Number(netPay[0].replace(/,/g, "")) : null,
  };
}
function unsafeBoundaryReason(text: string): string | null {
  if (SUMMARY_RE.test(text))
    return "Payroll summaries and registers cannot be distributed as individual paystubs.";
  if (
    CONTINUATION_RE.test(text) ||
    [...text.matchAll(/\bpage\s+(\d+)\s+of\s+(\d+)\b/gi)].some(
      (match) => Number(match[2]) > 1,
    )
  )
    return "Continuation pages require verified document boundaries and are not supported.";
  if (
    [...text.matchAll(IDENTITY_RE)].length > 1 ||
    [...text.matchAll(STUB_RE)].length > 1 ||
    [...text.matchAll(/\bPay Period:/gi)].length > 1 ||
    [...text.matchAll(/\bPay Date:/gi)].length > 1 ||
    [...text.matchAll(/\bEmployee(?: Name)?:/gi)].length > 1 ||
    [...text.matchAll(/\bCheck number:/gi)].length > 1
  ) {
    return "This page contains multiple paystub identities or ambiguous document boundaries.";
  }
  return null;
}
/** Only the verified one-stub-per-page provider layout is eligible for saving. */
export function classifyPaystubRows(
  rows: readonly PaystubTextRow[],
): PaystubPageAnalysis {
  const text = rows.map((row) => row.text).join("\n");
  if (!text.trim())
    return {
      status: "OCR_REQUIRED",
      reason: "No readable text was found. This page requires OCR.",
      parsed: null,
    };
  const unsafeReason = unsafeBoundaryReason(text);
  if (unsafeReason) return { status: "UNSUPPORTED", reason: unsafeReason, parsed: null };
  if (![...text.matchAll(STUB_RE)].length) {
    return {
      status: "UNSUPPORTED",
      reason: "This page does not use the supported individual paystub layout.",
      parsed: null,
    };
  }
  const parsed = parsePaystubPageRows(rows);
  if (
    !parsed.employeeName ||
    !parsed.ssnLast4 ||
    !parsed.payPeriodStart ||
    !parsed.payPeriodEnd ||
    !parsed.payDate ||
    !parsed.checkNumber
  ) {
    return {
      status: "UNSUPPORTED",
      reason:
        "A complete employee identity, valid pay period, pay date, and check reference are required on each page.",
      parsed: null,
    };
  }
  return { status: "SUPPORTED", reason: null, parsed };
}
async function inspectPdf(
  bytes: ArrayBuffer,
  classify: (rows: PaystubTextRow[]) => PaystubPageAnalysis,
  limits = { maxBytes: MAX_PAYSTUB_BYTES, maxPages: MAX_PAYSTUB_PAGES },
): Promise<PaystubPdfAnalysis> {
  if (!bytes.byteLength) throw new Error("The PDF is empty.");
  if (bytes.byteLength > limits.maxBytes)
    throw new Error(`The PDF exceeds the ${limits.maxBytes / (1024 * 1024)} MB limit.`);
  const pageLimitMessage = `The PDF exceeds the ${limits.maxPages}-page limit.`;
  let loadingTask: ReturnType<typeof getDocument> | undefined;
  try {
    loadingTask = getDocument({
      // PDF.js may detach its input; preserve the source for hashing and splitting.
      data: new Uint8Array(bytes.slice(0)),
      useWorkerFetch: false,
      isEvalSupported: false,
      disableFontFace: true,
      verbosity: 0,
    });
    const document = await loadingTask.promise;
    if (document.numPages > limits.maxPages) throw new Error(pageLimitMessage);
    const pages: PaystubPdfAnalysis["pages"] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const items = content.items.filter((item): item is TextItem => "str" in item);
        pages.push({ pageNumber, ...classify(extractRows(items)) });
      } finally {
        page.cleanup();
      }
    }
    return { pageCount: document.numPages, pages };
  } catch (error) {
    if (error instanceof Error && error.message === pageLimitMessage) throw error;
    throw new Error(
      "The PDF could not be read. It may be encrypted, damaged, or unsupported.",
    );
  } finally {
    // Destroy the task even when loading fails; never expose PDF.js errors or text.
    await loadingTask?.destroy().catch(() => undefined);
  }
}
export async function analyzePaystubPdf(bytes: ArrayBuffer): Promise<PaystubPdfAnalysis> {
  return inspectPdf(bytes, classifyPaystubRows);
}
/** Inspect all legacy payroll PDFs within their existing upload-size allowance. */
export async function analyzePayrollPdfForGuard(
  bytes: ArrayBuffer,
): Promise<PaystubPdfAnalysis> {
  return inspectPdf(bytes, classifyPaystubRows, {
    maxBytes: 15 * 1024 * 1024,
    maxPages: 1000,
  });
}
/** Legacy partial-field preview. Combined and ambiguous sources are never reduced to page one. */
export async function parsePaystub(
  bytes: ArrayBuffer,
  mimeType: string,
): Promise<ParsedPaystub | null> {
  if (mimeType !== "application/pdf") return null;
  try {
    const result = await inspectPdf(bytes, (rows) => {
      const analysis = classifyPaystubRows(rows);
      const text = rows.map((row) => row.text).join("\n");
      return {
        ...analysis,
        parsed:
          text.trim() && !unsafeBoundaryReason(text) ? parsePaystubPageRows(rows) : null,
      };
    });
    return result.pageCount === 1 ? result.pages[0].parsed : null;
  } catch {
    return null;
  }
}
