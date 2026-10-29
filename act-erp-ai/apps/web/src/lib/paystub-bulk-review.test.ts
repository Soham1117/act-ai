import { describe, expect, it } from "vitest";
import { bulkUpdatePaystubRows } from "./paystub-bulk-review";
import type { BatchPage, BatchReceipt } from "./paystub-import";

function row(id: string, changes: Partial<ReturnType<typeof base>> = {}) {
  return { ...base(id), ...changes };
}
function base(id: string) {
  return {
    id, selected: false, reviewed: false, skipped: false,
    page: { status: "SUPPORTED" as BatchPage["status"], duplicates: [] as BatchPage["duplicates"] },
    receipt: undefined as Pick<BatchReceipt, "status"> | undefined,
    employeeId: "dummy-employee", overrideReason: "", dateReason: "", start: "2026-10-12",
  };
}
const skipped = (item: ReturnType<typeof base>) => item.skipped;

describe("bulk paystub selection and review", () => {
  it("selects eligible pages across files and preserves existing review flags", () => {
    const rows = [row("file-a/1", { reviewed: true }), row("file-b/1")];
    const updated = bulkUpdatePaystubRows(rows, "select", skipped);
    expect(updated.map(item => item.selected)).toEqual([true, true]);
    expect(updated.map(item => item.reviewed)).toEqual([true, false]);
    expect(rows.every(item => !item.selected)).toBe(true);
  });

  it("leaves skipped, unsupported, OCR-needed, imported, and exact-duplicate pages untouched", () => {
    const blocked = [
      row("skipped", { skipped: true }),
      row("unsupported", { page: { status: "UNSUPPORTED", duplicates: [] } }),
      row("ocr", { page: { status: "OCR_REQUIRED", duplicates: [] } }),
      row("saved", { receipt: { status: "SAVED" } }),
      row("existing", { receipt: { status: "EXISTING" } }),
      row("receipt-skipped", { receipt: { status: "SKIPPED" } }),
      row("exact", { page: { status: "SUPPORTED", duplicates: [{ exact: true } as BatchPage["duplicates"][number]] } }),
    ];
    for (const action of ["select", "deselect", "review", "unreview"] as const) {
      const updated = bulkUpdatePaystubRows(blocked, action, skipped);
      expect(updated).toEqual(blocked);
      updated.forEach((item, index) => expect(item).toBe(blocked[index]));
    }
  });

  it("marks only selected eligible pages reviewed without resolving mismatches or dates", () => {
    const rows = [row("selected", { selected: true }), row("unselected")];
    const updated = bulkUpdatePaystubRows(rows, "review", skipped);
    expect(updated[0]).toEqual({ ...rows[0], reviewed: true });
    expect(updated[0].overrideReason).toBe("");
    expect(updated[0].dateReason).toBe("");
    expect(updated[0].employeeId).toBe(rows[0].employeeId);
    expect(updated[0].start).toBe(rows[0].start);
    expect(updated[1]).toBe(rows[1]);
  });

  it("allows failed pages to be selected and reviewed again", () => {
    const selected = bulkUpdatePaystubRows([row("retry", { receipt: { status: "FAILED" } })], "select", skipped);
    expect(bulkUpdatePaystubRows(selected, "review", skipped)[0]).toMatchObject({
      selected: true, reviewed: true, receipt: { status: "FAILED" },
    });
  });

  it("clears selection without discarding review, and clears review only on selected pages", () => {
    const rows = [row("a", { selected: true, reviewed: true }), row("b", { reviewed: true })];
    expect(bulkUpdatePaystubRows(rows, "deselect", skipped).map(item => [item.selected, item.reviewed]))
      .toEqual([[false, true], [false, true]]);
    expect(bulkUpdatePaystubRows(rows, "unreview", skipped).map(item => [item.selected, item.reviewed]))
      .toEqual([[true, false], [false, true]]);
  });
});
