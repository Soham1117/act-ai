import type { HirePacketFormType, HirePacketProposals, ProposedField } from "@/lib/hire-packet/types";

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_RE = /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const ZIP_RE = /\b(\d{5})(?:-\d{4})?\b/;
const STATE_RE = /\b([A-Z]{2})\b/;
const SSN_LAST4_RE =
  /(?:ssn|social\s+security)[^\d]{0,30}(\d{4})\b|(?:\*{3}[-\s]*\*{2}[-\s]*|(?:\d{3}[-\s]\d{2}[-\s]))(\d{4})\b/i;
const DOB_RE =
  /(?:date\s+of\s+birth|d\.?o\.?b\.?|birth\s+date)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2})/i;
const DATE_RE = /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/;
const HIRE_DATE_RE =
  /(?:date\s+of\s+hire|start\s+date|hire\s+date|commencement)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i;

function field(
  value: string | null | undefined,
  confidence: ProposedField["confidence"],
  sourceFile: string,
  sourceForm: HirePacketFormType,
): ProposedField | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  return { value: v, confidence, sourceFile, sourceForm };
}

function normalizeDate(raw: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) return raw;
  const mdy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/.exec(raw);
  if (!mdy) return null;
  const [, m, d, yRaw] = mdy;
  const y = yRaw!.length === 2 ? `20${yRaw}` : yRaw!;
  return `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
}

function extractAddressBlock(text: string): Partial<HirePacketProposals> {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const streetIdx = lines.findIndex((l) =>
    /\d+\s+\w/.test(l) && /(st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|way|ct|court)/i.test(l),
  );
  if (streetIdx === -1) return {};

  const street = lines[streetIdx];
  const cityLine = lines[streetIdx + 1] ?? "";
  const cityStateZip = /^(.+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i.exec(cityLine);
  if (cityStateZip) {
    return {
      address: field(street, "medium", "", "UNKNOWN"),
      city: field(cityStateZip[1], "medium", "", "UNKNOWN"),
      state: field(cityStateZip[2]!.toUpperCase(), "medium", "", "UNKNOWN"),
      zipCode: field(cityStateZip[3], "medium", "", "UNKNOWN"),
    };
  }
  return { address: field(street, "low", "", "UNKNOWN") };
}

function extractCommon(text: string, sourceFile: string, form: HirePacketFormType): HirePacketProposals {
  const out: HirePacketProposals = {};
  const email = text.match(EMAIL_RE)?.[0];
  const phone = text.match(PHONE_RE)?.[0];
  const ssn = SSN_LAST4_RE.exec(text);
  const dob = DOB_RE.exec(text);
  const addr = extractAddressBlock(text);

  if (email) out.personalEmail = field(email, "medium", sourceFile, form);
  if (phone) out.phoneNumber = field(phone.replace(/\D/g, "").length >= 10 ? phone : phone, "medium", sourceFile, form);
  if (ssn) {
    const last4 = ssn[1] ?? ssn[2];
    if (last4) out.ssnLast4 = field(last4, "high", sourceFile, form);
  }
  if (dob?.[1]) {
    const iso = normalizeDate(dob[1]);
    if (iso) out.dateOfBirth = field(iso, "high", sourceFile, form);
  }

  for (const [k, v] of Object.entries(addr) as [keyof HirePacketProposals, ProposedField | undefined][]) {
    if (v) out[k] = { ...v, sourceFile, sourceForm: form };
  }

  return out;
}

function extractI9(text: string, sourceFile: string): HirePacketProposals {
  const out = extractCommon(text, sourceFile, "I9");
  const lastMatch = /last\s+name(?:\s*\([^)]*\))?\s*:\s*([^\n\r]+)/i.exec(text);
  const firstMatch = /first\s+name(?:\s*\([^)]*\))?\s*:\s*([^\n\r]+)/i.exec(text);
  if (firstMatch && lastMatch) {
    out.name = field(
      `${firstMatch[1].trim()} ${lastMatch[1].trim()}`,
      "high",
      sourceFile,
      "I9",
    );
  }
  const emergency = /(?:emergency\s+contact|person\s+to\s+notify)\s*:\s*([^\n\r]+)/i.exec(text);
  if (emergency?.[1]) out.emergencyName = field(emergency[1].trim(), "medium", sourceFile, "I9");
  return out;
}

function extractW4(text: string, sourceFile: string): HirePacketProposals {
  const out = extractCommon(text, sourceFile, "W4");
  if (/married/i.test(text)) out.maritalStatus = field("MARRIED", "medium", sourceFile, "W4");
  else if (/single/i.test(text)) out.maritalStatus = field("SINGLE", "medium", sourceFile, "W4");
  else if (/head\s+of\s+household/i.test(text)) out.maritalStatus = field("OTHER", "low", sourceFile, "W4");
  return out;
}

function extractOfferLetter(text: string, sourceFile: string): HirePacketProposals {
  const out: HirePacketProposals = {};
  const title = /(?:position|job\s+title|role)[:\s]+([^\n]+)/i.exec(text);
  if (title?.[1]) out.jobTitle = field(title[1].trim(), "medium", sourceFile, "OFFER_LETTER");
  const hire = HIRE_DATE_RE.exec(text) ?? DATE_RE.exec(text);
  if (hire?.[1]) {
    const iso = normalizeDate(hire[1]);
    if (iso) out.dateOfHire = field(iso, "medium", sourceFile, "OFFER_LETTER");
  }
  const dear = /dear\s+([A-Za-z]+(?:\s+[A-Za-z]+)+)/i.exec(text);
  if (dear?.[1] && !out.name) out.name = field(dear[1], "low", sourceFile, "OFFER_LETTER");
  return out;
}

function extractDriversLicense(text: string, sourceFile: string): HirePacketProposals {
  const out = extractCommon(text, sourceFile, "DRIVERS_LICENSE");
  const nameLine = linesNamed(text).find((l) => /^[A-Z][A-Z\s,'-]{4,}$/.test(l) && l.split(/\s+/).length >= 2);
  if (nameLine && !out.name) out.name = field(titleCase(nameLine), "medium", sourceFile, "DRIVERS_LICENSE");
  return out;
}

function linesNamed(text: string): string[] {
  return text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Template-based extraction for a single document. */
export function extractFromTemplate(
  text: string,
  sourceFile: string,
  formType: HirePacketFormType,
): HirePacketProposals {
  switch (formType) {
    case "I9":
      return extractI9(text, sourceFile);
    case "W4":
      return extractW4(text, sourceFile);
    case "OFFER_LETTER":
      return extractOfferLetter(text, sourceFile);
    case "DRIVERS_LICENSE":
      return extractDriversLicense(text, sourceFile);
    case "DIRECT_DEPOSIT":
      return {};
    default:
      return extractCommon(text, sourceFile, formType);
  }
}

export function mergeProposals(sources: HirePacketProposals[]): HirePacketProposals {
  const rank: Record<ProposedField["confidence"], number> = { high: 3, medium: 2, low: 1 };
  const merged: HirePacketProposals = {};
  for (const src of sources) {
    for (const [key, proposal] of Object.entries(src) as [keyof HirePacketProposals, ProposedField][]) {
      const existing = merged[key];
      if (!existing || rank[proposal.confidence] > rank[existing.confidence]) {
        merged[key] = proposal;
      }
    }
  }
  return merged;
}

// Export for tests
export { normalizeDate, SSN_LAST4_RE, ZIP_RE, STATE_RE };
