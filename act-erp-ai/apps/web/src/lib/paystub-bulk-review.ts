import type { BatchPage, BatchReceipt } from "./paystub-import";

type BulkReviewRow = {
  page: Pick<BatchPage, "status" | "duplicates">;
  receipt?: Pick<BatchReceipt, "status">;
  selected: boolean;
  reviewed: boolean;
};

export function canBulkReviewPaystub(row: BulkReviewRow, skipped: boolean): boolean {
  return row.page.status === "SUPPORTED" && !skipped &&
    !row.page.duplicates.some(duplicate => duplicate.exact) &&
    (!row.receipt || row.receipt.status === "FAILED");
}

/** Bulk confirmation never changes employee assignments, dates or explanations. */
export function bulkUpdatePaystubRows<T extends BulkReviewRow>(
  rows: T[],
  action: "select" | "deselect" | "review" | "unreview",
  isSkipped: (row: T) => boolean,
): T[] {
  return rows.map(row => {
    if (!canBulkReviewPaystub(row, isSkipped(row))) return row;
    if (action === "select" || action === "deselect") {
      return { ...row, selected: action === "select" };
    }
    return row.selected ? { ...row, reviewed: action === "review" } : row;
  });
}

type CleanCheckPage = Pick<BatchPage, "status" | "duplicates" | "match" | "extraction" | "parsed">;

/**
 * A page that needs no human decision: readable text, a high-confidence
 * employee match, a complete period, no existing document for it, and no other
 * page in the same PDF for the same employee and period.
 */
export function isCleanPaystubPage(page: CleanCheckPage, siblings: CleanCheckPage[]): boolean {
  if (page.status !== "SUPPORTED" || page.extraction !== "TEXT") return false;
  if (page.match.confidence !== "high" || !page.match.employeeId) return false;
  const start = page.parsed?.payPeriodStart;
  const end = page.parsed?.payPeriodEnd;
  if (!start || !end || end < start) return false;
  if (page.duplicates.length > 0) return false;
  return !siblings.some(
    (other) =>
      other !== page &&
      other.status === "SUPPORTED" &&
      other.match.employeeId === page.match.employeeId &&
      other.parsed?.payPeriodStart === start &&
      other.parsed?.payPeriodEnd === end,
  );
}
