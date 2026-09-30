import { describe, expect, it } from "vitest";
import { REQUEST_TRANSITIONS } from "./request-transitions";

describe("request transitions", () => {
  it("allows the forward paths", () => {
    expect(REQUEST_TRANSITIONS.PENDING).toEqual(["PROCESSING", "REJECTED", "COMPLETED"]);
    expect(REQUEST_TRANSITIONS.PROCESSING).toEqual(["COMPLETED", "REJECTED"]);
  });
  it("treats COMPLETED and REJECTED as terminal", () => {
    expect(REQUEST_TRANSITIONS.COMPLETED).toHaveLength(0);
    expect(REQUEST_TRANSITIONS.REJECTED).toHaveLength(0);
  });
});
