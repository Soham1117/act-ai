import { readFileSync, writeFileSync } from "node:fs";
import { analyzePaystubPdf, type ParsedPaystub } from "../src/lib/paystub-parser";
import { matchEmployee } from "../src/lib/paystub-match";

async function main() {
if (process.env.SENSITIVE_DATA_KMS_KEY_ARN || process.env.SENSITIVE_DATA_REQUIRE_ENCRYPTED === "true") throw new Error("This raw-snapshot matcher is disabled for KMS-protected employee data. Use the application matching service.");
const pdfPath = process.argv[2] ?? "d:/Deployed Projects/ACT Persona/Paystubs/Paystubs 10-29-2026.pdf";
const dbPath = process.argv[3] ?? "d:/Deployed Projects/ACT Persona/data/backups/db-employees-utf8.txt";

const bytes = readFileSync(pdfPath);
const analysis = await analyzePaystubPdf(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);

const stubs = analysis.pages
  .filter((p) => p.status === "SUPPORTED" && p.parsed?.employeeName)
  .map((p) => ({
    page: p.pageNumber,
    name: p.parsed!.employeeName!,
    ssn: p.parsed!.ssnLast4,
  }));

const renames: Record<string, string> = {
  "Alexandro Torres": "Alex Torres",
  "Deepak Somarajan Pillai": "Deepak Somarajan",
  "Jose Gonzales": "Jose Gonzalez",
  "Ronald Wayne Schmidt": "Ron Schmidt",
};

const employees = readFileSync(dbPath, "utf8")
  .replace(/^\uFEFF/, "")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => {
    const [id, name, ssnLast4] = line.split("\t");
    const trimmed = (name ?? "").trim();
    const ssn = (ssnLast4 ?? "").trim();
    return {
      id,
      name: renames[trimmed] ?? trimmed,
      ssnLast4: /^\d{4}$/.test(ssn) ? ssn : null,
    };
  })
  .filter((e) => e.name);

const results = stubs.map((s) => {
  const parsed: ParsedPaystub = {
    employeeName: s.name,
    ssnLast4: s.ssn,
    payPeriodStart: null,
    payPeriodEnd: null,
    payDate: null,
    checkNumber: null,
    netPay: null,
  };
  const m = matchEmployee(parsed, employees);
  const dbName = m.employeeId
    ? employees.find((e) => e.id === m.employeeId)?.name ?? null
    : null;
  return {
    page: s.page,
    stub: s.name,
    ssn: s.ssn,
    confidence: m.confidence,
    nameOk: m.nameOk,
    db: dbName,
    employeeId: m.employeeId,
    reason: m.reason,
  };
});

const summary = {
  file: pdfPath.split(/[/\\]/).pop(),
  pageCount: analysis.pageCount,
  stubsWithNames: stubs.length,
  nameOk: results.filter((r) => r.nameOk).length,
  nameNotOk: results.filter((r) => !r.nameOk).length,
  mediumNameOnly: results.filter((r) => r.confidence === "medium" && r.nameOk).length,
  none: results.filter((r) => r.confidence === "none").length,
  exactSpelling: results.filter(
    (r) => r.db && r.stub.toLowerCase() === r.db.toLowerCase(),
  ).length,
  spellingDiffers: results.filter(
    (r) => r.nameOk && r.db && r.stub.toLowerCase() !== r.db.toLowerCase(),
  ),
  unmatched: results.filter((r) => !r.nameOk || r.confidence === "none"),
  all: results,
};

const out = "d:/Deployed Projects/ACT Persona/data/backups/paystub-name-check.json";
writeFileSync(out, JSON.stringify(summary, null, 2));
console.log(
  JSON.stringify(
    {
      ...summary,
      all: undefined,
      sample: results.slice(0, 10),
    },
    null,
    2,
  ),
);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
