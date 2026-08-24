import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { parsePaystub } from "./paystub-parser";

/**
 * Builds a synthetic paystub PDF with the same row layout as the real
 * provider template (see paystub-parser.ts), but entirely fake data — never
 * use the real sample file as a fixture, it carries real PII.
 */
async function buildFixture(opts: {
  name?: string;
  ssnLast4?: string;
  periodStart?: string;
  periodEnd?: string;
  payDate?: string;
  checkNumber?: string;
  netPay?: string;
  includeSsnRow?: boolean;
  includePeriodRow?: boolean;
  includeNetPayRow?: boolean;
}) {
  const {
    name = "Jane A Tester",
    ssnLast4 = "9999",
    periodStart = "01/05/2026",
    periodEnd = "01/18/2026",
    payDate = "01/22/2026",
    checkNumber = "DD0001",
    netPay = "1,000.00",
    includeSsnRow = true,
    includePeriodRow = true,
    includeNetPayRow = true,
  } = opts;

  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const draw = (text: string, x: number, y: number) =>
    page.drawText(text, { x, y, size: 10, font });

  draw("American Completion Tools, Inc.", 40, 750);
  if (includePeriodRow) {
    draw(
      `Employee Pay Stub  Check number: ${checkNumber}  Pay Period: ${periodStart} - ${periodEnd}  Pay Date: ${payDate}`,
      22,
      531,
    );
  }
  if (includeSsnRow) {
    draw(`${name}, 1 Test St, Testville, TX 76028 ***-**-${ssnLast4}`, 22, 501);
  }
  if (includeNetPayRow) {
    draw(`Net Pay`, 22, 404);
    draw(`${netPay}`, 211, 404);
    draw(`${netPay}`, 270, 404);
  }

  const bytes = await doc.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe("parsePaystub", () => {
  it("extracts every field from a well-formed stub", async () => {
    const bytes = await buildFixture({});
    const result = await parsePaystub(bytes, "application/pdf");
    expect(result).toEqual({
      employeeName: "Jane A Tester",
      ssnLast4: "9999",
      payPeriodStart: "2026-01-05",
      payPeriodEnd: "2026-01-18",
      payDate: "2026-01-22",
      checkNumber: "DD0001",
      netPay: 1000,
    });
  });

  it("returns null for a non-PDF mimetype", async () => {
    const bytes = await buildFixture({});
    const result = await parsePaystub(bytes, "image/png");
    expect(result).toBeNull();
  });

  it("returns null for an oversized payload", async () => {
    const huge = new ArrayBuffer(6 * 1024 * 1024);
    const result = await parsePaystub(huge, "application/pdf");
    expect(result).toBeNull();
  });

  it("returns null for corrupt PDF bytes rather than throwing", async () => {
    const garbage = new TextEncoder().encode("not a pdf").buffer;
    const result = await parsePaystub(garbage, "application/pdf");
    expect(result).toBeNull();
  });

  it("returns partial fields (not null overall) when only some rows are missing", async () => {
    const bytes = await buildFixture({ includeNetPayRow: false });
    const result = await parsePaystub(bytes, "application/pdf");
    expect(result).not.toBeNull();
    expect(result!.employeeName).toBe("Jane A Tester");
    expect(result!.ssnLast4).toBe("9999");
    expect(result!.netPay).toBeNull();
  });

  it("leaves ssnLast4 and employeeName null when the SSN row is absent", async () => {
    const bytes = await buildFixture({ includeSsnRow: false });
    const result = await parsePaystub(bytes, "application/pdf");
    expect(result).not.toBeNull();
    expect(result!.ssnLast4).toBeNull();
    expect(result!.employeeName).toBeNull();
  });
});
