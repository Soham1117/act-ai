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
