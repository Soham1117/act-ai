import type { ParsedPaystub } from "./paystub-parser";
import type { MatchResult } from "./paystub-match";

export type BatchDuplicate = { id: string; title: string; employeeId: string; payPeriodStart: string; payPeriodEnd: string; version: string; exact: boolean };
export type BatchPage = {
  pageNumber: number; status: "SUPPORTED" | "OCR_REQUIRED" | "UNSUPPORTED"; reason: string | null;
  parsed: ParsedPaystub | null; match: MatchResult; reviewToken: string;
  duplicates: BatchDuplicate[]; extraction: "TEXT" | "OCR";
};
export type BatchPreview = { sourceHash: string; pageCount: number; pages: BatchPage[]; rosterHash: string };
export type BatchDecision = {
  pageNumber: number; employeeId: string; payPeriodStart: string; payPeriodEnd: string;
  reviewToken: string; confirmed: true; overrideReason?: string; dateReason?: string;
  duplicateMode: "KEEP" | "ADDITIONAL" | "REPLACE"; replaceId?: string; replaceVersion?: string;
};
export type BatchReceipt = { pageNumber: number; status: "SAVED" | "EXISTING" | "SKIPPED" | "FAILED"; id?: string; error?: string; warning?: string };
