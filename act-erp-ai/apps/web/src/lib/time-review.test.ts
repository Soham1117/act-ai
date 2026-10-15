import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("bulk time review concurrency contract", () => {
  it("derives results, audit IDs, and notifications only from atomically changed rows", () => {
    const source = readFileSync(
      new URL("../server/actions/time-clock.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("updateManyAndReturn({");
    expect(source).toContain("ids: changed.map((entry) => entry.id)");
    expect(source).toContain("for (const entry of changed)");
    expect(source).toContain("const committedDecision = changed[0]!.approvalStatus");
    expect(source).toContain("title: committedDecision ===");
    expect(source).toContain("updated: changed.length");
    expect(source).toContain("skipped: ids.length - changed.length");
    expect(source).not.toContain("eligible.map((e) => e.id)");
  });

  it("updates only still-pending completed closed rows", () => {
    const source = readFileSync(
      new URL("../server/actions/time-clock.ts", import.meta.url),
      "utf8",
    );
    const bulkUpdate = source.slice(source.indexOf("updateManyAndReturn({"));

    expect(bulkUpdate).toContain('approvalStatus: "PENDING"');
    expect(bulkUpdate).toContain('status: "COMPLETED"');
    expect(bulkUpdate).toContain("clockOut: { not: null }");
    expect(bulkUpdate).toContain("approvalStatus: data.decision");
    expect(bulkUpdate).toContain("status: data.decision");
  });
});
