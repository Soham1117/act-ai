import { afterEach, describe, expect, it, vi } from "vitest";
import { llmFillGaps } from "./llm";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("hire-packet external LLM opt-in", () => {
  it.each(["", "false"])("does not export OCR text with an API key when opt-in is %s", async enabled => {
    vi.stubEnv("HIRE_PACKET_LLM_ENABLED", enabled);
    vi.stubEnv("ANTHROPIC_API_KEY", "dummy-not-a-real-key");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const existing = {};
    expect(await llmFillGaps("Dummy bank account 000000000; dummy SSN 000-00-0000", existing)).toBe(existing);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("still requires a key after explicit opt-in", async () => {
    vi.stubEnv("HIRE_PACKET_LLM_ENABLED", "true");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("CLAUDE_API_KEY", "");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(await llmFillGaps("Dummy sensitive text", {})).toEqual({});
    expect(fetch).not.toHaveBeenCalled();
  });
});
