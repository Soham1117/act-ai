import { decryptSensitiveJson, encryptSensitiveJson, SensitiveDataError } from "./sensitive-data";
import type { HirePacketFileResult, HirePacketProposals } from "@/lib/hire-packet/types";

export const HIRE_PACKET_SENSITIVE_FIELDS = ["proposedFields", "fileResults"] as const;
export type HirePacketSensitiveField = (typeof HIRE_PACKET_SENSITIVE_FIELDS)[number];
export const HIRE_PACKET_FAILURE_MESSAGE = "This hire-packet import could not be processed. Retry or upload the packet again.";

export function hirePacketContext(jobId: string, field: HirePacketSensitiveField) {
  return { purpose: "hire-packet-import", recordId: jobId, field };
}

/** Legacy worker/SDK errors can contain OCR values or filenames. Never expose them. */
export function safeHirePacketError(error: unknown): string | null {
  return error == null || error === "" ? null : HIRE_PACKET_FAILURE_MESSAGE;
}

export async function encryptHirePacketFields(jobId: string, fields: {
  proposedFields: HirePacketProposals;
  fileResults: HirePacketFileResult[];
}) {
  const [proposedFields, fileResults] = await Promise.all([
    encryptSensitiveJson(fields.proposedFields, hirePacketContext(jobId, "proposedFields")),
    encryptSensitiveJson(fields.fileResults, hirePacketContext(jobId, "fileResults")),
  ]);
  return { proposedFields, fileResults };
}

/** Must only run behind an explicit admin check. Never send ciphertext as proposals. */
export async function decryptHirePacketFields(jobId: string, fields: {
  proposedFields: unknown;
  fileResults: unknown;
}): Promise<{ proposedFields: HirePacketProposals | null; fileResults: HirePacketFileResult[] | null }> {
  const [proposedFields, fileResults] = await Promise.all([
    decryptSensitiveJson<HirePacketProposals | null>(fields.proposedFields, hirePacketContext(jobId, "proposedFields")),
    decryptSensitiveJson<HirePacketFileResult[] | null>(fields.fileResults, hirePacketContext(jobId, "fileResults")),
  ]);
  if (proposedFields !== null && (typeof proposedFields !== "object" || Array.isArray(proposedFields))) {
    throw new SensitiveDataError();
  }
  if (fileResults !== null && !Array.isArray(fileResults)) throw new SensitiveDataError();
  return { proposedFields, fileResults };
}
