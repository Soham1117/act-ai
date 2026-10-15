import { describe, expect, it, vi } from "vitest";
import { copyText, MANUAL_COPY_GUIDANCE } from "./clipboard";

describe("copyText", () => {
  it("reports success only after the Clipboard API resolves", async () => {
    let resolveWrite!: () => void;
    const writeText = vi.fn(
      () => new Promise<void>((resolve) => { resolveWrite = resolve; }),
    );
    let settled = false;
    const resultPromise = copyText("invite-url", { writeText }).then((result) => {
      settled = true;
      return result;
    });

    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith("invite-url");
    expect(settled).toBe(false);

    resolveWrite();
    await expect(resultPromise).resolves.toEqual({ ok: true });
  });

  it("returns manual-copy guidance when clipboard access is rejected", async () => {
    const clipboard = { writeText: vi.fn().mockRejectedValue(new Error("denied")) };
    await expect(copyText("invite-url", clipboard)).resolves.toEqual({
      ok: false,
      error: MANUAL_COPY_GUIDANCE,
    });
  });

  it("returns manual-copy guidance when the Clipboard API is unavailable", async () => {
    await expect(copyText("invite-url", undefined)).resolves.toEqual({
      ok: false,
      error: MANUAL_COPY_GUIDANCE,
    });
  });
});
