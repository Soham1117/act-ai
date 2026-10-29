import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  analyzePaystubPdf,
  analyzePayrollPdfForGuard,
  classifyPaystubRows,
  parsePaystub,
  parsePaystubPageRows,
} from "./paystub-parser";
import { MAX_PAYSTUB_BYTES } from "./paystub-batch";

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
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
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
    const huge = new ArrayBuffer(MAX_PAYSTUB_BYTES + 1);
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

const stubRows = (extra: string[] = []) =>
  [
    "Employee Pay Stub Check number: DD0001 Pay Period: 01/05/2026 - 01/18/2026 Pay Date: 01/22/2026",
    "Jane A Tester, 1 Test St, Testville, TX 76028 ***-**-9999",
    ...extra,
  ].map((text, index) => ({ y: 700 - index * 20, text }));

async function combinePages(...inputs: ArrayBuffer[]): Promise<ArrayBuffer> {
  const document = await PDFDocument.create();
  for (const input of inputs) {
    const source = await PDFDocument.load(input);
    const pages = await document.copyPages(source, source.getPageIndices());
    for (const page of pages) document.addPage(page);
  }
  const bytes = await document.save();
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

describe("classifyPaystubRows", () => {
  it("accepts a complete stub without requiring financial amounts", () => {
    expect(classifyPaystubRows(stubRows())).toMatchObject({
      status: "SUPPORTED",
      reason: null,
      parsed: { employeeName: "Jane A Tester" },
    });
  });

  it.each([
    ["summary", ["Payroll Summary", "Employee: Jane Tester Employee: John Tester"]],
    ["register", ["Payroll Register"]],
    ["continuation", ["Continued on next page"]],
    ["first page of a multi-page stub", ["Page 1 of 2"]],
    ["multiple identities", ["John B Tester, 2 Test St ***-**-1111"]],
    ["same last-four on a second identity", ["John B Tester, 2 Test St ***-**-9999"]],
    ["multiple stubs", ["Employee Pay Stub"]],
    ["multiple check references", ["Check number: DD0002"]],
    ["multiple unmasked employees", ["Employee: Jane Tester", "Employee: John Tester"]],
  ])("blocks %s", (_name, extra) => {
    expect(classifyPaystubRows(stubRows(extra))).toMatchObject({
      status: "UNSUPPORTED",
      parsed: null,
    });
  });

  it("distinguishes unreadable pages from an unknown readable template", () => {
    expect(classifyPaystubRows([])).toMatchObject({
      status: "OCR_REQUIRED",
      parsed: null,
    });
    expect(classifyPaystubRows([{ y: 700, text: "A different report" }])).toMatchObject({
      status: "UNSUPPORTED",
      parsed: null,
    });
  });

  it.each([
    ["02/30/2026", "03/01/2026"],
    ["02/29/2026", "03/01/2026"],
    ["13/01/2026", "13/02/2026"],
    ["01/18/2026", "01/05/2026"],
  ])("rejects invalid or reversed dates %s - %s", (start, end) => {
    const rows = stubRows();
    rows[0].text = rows[0].text.replace("01/05/2026 - 01/18/2026", `${start} - ${end}`);
    expect(classifyPaystubRows(rows).status).toBe("UNSUPPORTED");
  });

  it("rejects an invalid pay date and accepts leap days", () => {
    const rows = stubRows();
    rows[0].text = rows[0].text.replace("01/22/2026", "02/29/2026");
    expect(classifyPaystubRows(rows).status).toBe("UNSUPPORTED");
    rows[0].text = rows[0].text
      .replaceAll("2026", "2028")
      .replace("01/05/2028 - 01/18/2028", "02/01/2028 - 02/29/2028");
    expect(parsePaystubPageRows(rows)).toMatchObject({
      payDate: "2028-02-29",
      payPeriodEnd: "2028-02-29",
    });
    expect(classifyPaystubRows(rows).status).toBe("SUPPORTED");
  });
});

describe("analyzePaystubPdf", () => {
  it("inspects every page and preserves the original bytes", async () => {
    const bytes = await combinePages(
      await buildFixture({}),
      await buildFixture({ name: "John B Tester", ssnLast4: "1111" }),
    );
    const before = new Uint8Array(bytes).slice();
    const result = await analyzePaystubPdf(bytes);
    expect(result.pageCount).toBe(2);
    expect(
      result.pages.map((page) => [
        page.pageNumber,
        page.status,
        page.parsed?.employeeName,
      ]),
    ).toEqual([
      [1, "SUPPORTED", "Jane A Tester"],
      [2, "SUPPORTED", "John B Tester"],
    ]);
    expect(new Uint8Array(bytes)).toEqual(before);
    expect(JSON.stringify(result)).not.toContain("Testville");
    expect(await parsePaystub(bytes, "application/pdf")).toBeNull();
  });

  it("marks an image-only page for OCR while retaining other page classifications", async () => {
    const document = await PDFDocument.create();
    const page = document.addPage();
    const png = await document.embedPng(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6XkAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    page.drawImage(png, { x: 10, y: 10, width: 100, height: 100 });
    const imageBytes = await document.save();
    const bytes = await combinePages(
      await buildFixture({}),
      imageBytes.buffer.slice(
        imageBytes.byteOffset,
        imageBytes.byteOffset + imageBytes.byteLength,
      ) as ArrayBuffer,
    );
    const result = await analyzePaystubPdf(bytes);
    expect(result.pages.map((page) => page.status)).toEqual([
      "SUPPORTED",
      "OCR_REQUIRED",
    ]);
  });

  it("rejects oversized, empty, corrupt, and over-page-limit inputs with bounded errors", async () => {
    await expect(
      analyzePaystubPdf(new ArrayBuffer(MAX_PAYSTUB_BYTES + 1)),
    ).rejects.toThrow("10 MB");
    await expect(analyzePaystubPdf(new ArrayBuffer(0))).rejects.toThrow("empty");
    await expect(
      analyzePaystubPdf(new TextEncoder().encode("private input text").buffer),
    ).rejects.toThrow(
      "The PDF could not be read. It may be encrypted, damaged, or unsupported.",
    );
    const document = await PDFDocument.create();
    for (let index = 0; index < 201; index++) document.addPage();
    const bytes = await document.save();
    await expect(
      analyzePaystubPdf(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
      ),
    ).rejects.toThrow("200-page");
  });
});

describe("analyzePayrollPdfForGuard", () => {
  it("inspects a valid generic PDF above 10 MB while the batch path retains its limit", async () => {
    const document = await PDFDocument.create();
    document.addPage().drawText("Benefits enrollment information", { x: 40, y: 700 });
    // An uncompressed synthetic stream pads a valid PDF without payroll data.
    document.context.register(document.context.stream(new Uint8Array(MAX_PAYSTUB_BYTES)));
    const saved = await document.save({ useObjectStreams: false });
    const bytes = saved.buffer.slice(
      saved.byteOffset,
      saved.byteOffset + saved.byteLength,
    ) as ArrayBuffer;
    expect(bytes.byteLength).toBeGreaterThan(MAX_PAYSTUB_BYTES);
    const result = await analyzePayrollPdfForGuard(bytes);
    expect(result).toMatchObject({
      pageCount: 1,
      pages: [{ pageNumber: 1, status: "UNSUPPORTED", parsed: null }],
    });
    await expect(analyzePaystubPdf(bytes)).rejects.toThrow("10 MB");
  });

  it("inspects later paystub pages beyond the batch's 200-page allowance", async () => {
    const document = await PDFDocument.create();
    for (let index = 0; index < 200; index++) document.addPage();
    const stub = await PDFDocument.load(await buildFixture({}));
    const [page] = await document.copyPages(stub, [0]);
    document.addPage(page);
    const saved = await document.save();
    const result = await analyzePayrollPdfForGuard(
      saved.buffer.slice(
        saved.byteOffset,
        saved.byteOffset + saved.byteLength,
      ) as ArrayBuffer,
    );
    expect(result.pageCount).toBe(201);
    expect(result.pages[200]).toMatchObject({ pageNumber: 201, status: "SUPPORTED" });
  });

  it("rejects oversized, corrupt, and over-page-limit legacy PDFs explicitly", async () => {
    await expect(
      analyzePayrollPdfForGuard(new ArrayBuffer(15 * 1024 * 1024 + 1)),
    ).rejects.toThrow("15 MB");
    await expect(
      analyzePayrollPdfForGuard(new TextEncoder().encode("not a PDF").buffer),
    ).rejects.toThrow("The PDF could not be read.");
    const document = await PDFDocument.create();
    for (let index = 0; index < 1001; index++) document.addPage();
    const saved = await document.save();
    await expect(
      analyzePayrollPdfForGuard(
        saved.buffer.slice(
          saved.byteOffset,
          saved.byteOffset + saved.byteLength,
        ) as ArrayBuffer,
      ),
    ).rejects.toThrow("1000-page");
  });
});
