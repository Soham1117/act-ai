import type { HirePacketFormType } from "@/lib/hire-packet/types";

/** Heuristic form classification from extracted text + filename. */
export function classifyHireDocument(text: string, fileName: string): HirePacketFormType {
  const hay = `${fileName}\n${text}`.toLowerCase();

  if (/form\s+i-?9|employment eligibility|uscis/i.test(hay)) return "I9";
  if (/form\s+w-?4|employee'?s withholding|withholding certificate/i.test(hay)) return "W4";
  if (/driver'?s?\s+licen|state\s+id|identification\s+card|dmv/i.test(hay)) return "DRIVERS_LICENSE";
  if (/direct\s+deposit|bank\s+routing|routing\s+number|account\s+number/i.test(hay)) {
    return "DIRECT_DEPOSIT";
  }
  if (/offer\s+(of\s+)?employ|employment\s+agreement|position\s+offer/i.test(hay)) {
    return "OFFER_LETTER";
  }

  return "UNKNOWN";
}
