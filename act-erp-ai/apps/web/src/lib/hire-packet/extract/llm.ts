import type { HirePacketProposals } from "@/lib/hire-packet/types";
import { mergeProposals } from "@/lib/hire-packet/extract/templates";

const FIELD_KEYS = [
  "name",
  "phoneNumber",
  "dateOfBirth",
  "address",
  "city",
  "state",
  "zipCode",
  "emergencyName",
  "emergencyPhone",
  "nationality",
  "ssnLast4",
  "maritalStatus",
  "jobTitle",
  "dateOfHire",
  "workEmail",
  "personalEmail",
] as const;

const DEFAULT_CLAUDE_MODEL = "claude-3-5-haiku-20241022";

function parseJsonObject(raw: string): Record<string, string> | null {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(trimmed);
  const body = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(body) as Record<string, string>;
  } catch {
    return null;
  }
}

/**
 * Optional LLM pass for fields templates missed. Uses Claude when
 * ANTHROPIC_API_KEY (or CLAUDE_API_KEY) is set; otherwise returns existing proposals unchanged.
 */
export async function llmFillGaps(
  combinedText: string,
  existing: HirePacketProposals,
): Promise<HirePacketProposals> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY;
  if (!apiKey) return existing;

  const missing = FIELD_KEYS.filter((k) => !existing[k]);
  if (missing.length === 0) return existing;

  const redacted = combinedText.replace(/\d{3}-\d{2}-\d{4}/g, "***-**-****");
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_CLAUDE_MODEL;

  const prompt = `You extract employee onboarding fields from OCR text. Return ONLY valid JSON object with keys from this list and string values (ISO dates YYYY-MM-DD for dates, SSN last 4 digits only for ssnLast4, maritalStatus one of SINGLE|MARRIED|DIVORCED|WIDOWED|SEPARATED|OTHER). Omit keys you cannot find confidently.

Keys to try: ${missing.join(", ")}

Document text:
"""
${redacted.slice(0, 12000)}
"""`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) return existing;

    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
    };
    const raw = data.content?.find((part) => part.type === "text")?.text;
    if (!raw) return existing;

    const parsed = parseJsonObject(raw);
    if (!parsed) return existing;

    const llmProps: HirePacketProposals = {};
    for (const key of FIELD_KEYS) {
      const val = parsed[key];
      if (typeof val === "string" && val.trim() && !existing[key]) {
        llmProps[key] = {
          value: val.trim(),
          confidence: "low",
          sourceFile: "(LLM)",
          sourceForm: "UNKNOWN",
        };
      }
    }
    return mergeProposals([existing, llmProps]);
  } catch {
    return existing;
  }
}
