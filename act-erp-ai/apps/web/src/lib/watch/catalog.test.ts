import { describe, expect, it } from "vitest";
import { POLICY_FIELDS, RULE_LABELS, parsePolicyForm } from "./catalog";
import { DEFAULT_POLICY } from "./types";

const defaults = () => Object.fromEntries(POLICY_FIELDS.map((f) => [f.key, DEFAULT_POLICY[f.key]]));

describe("parsePolicyForm", () => {
  it("accepts the defaults and normalises recipients", () => {
    const r = parsePolicyForm({ numbers: defaults(), recipients: "A@x.com, b@x.com; a@x.com" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.policy.digestRecipientEmails).toEqual(["a@x.com", "b@x.com"]);
  });
  it("accepts numbers typed as text", () => {
    const r = parsePolicyForm({ numbers: { ...defaults(), lunchMinutes: "45" }, recipients: "a@x.com" });
    expect(r.ok && r.policy.lunchMinutes).toBe(45);
  });
  it("rejects out-of-range and blank numbers", () => {
    expect(parsePolicyForm({ numbers: { ...defaults(), lunchMinutes: 500 }, recipients: "a@x.com" }).ok).toBe(false);
    expect(parsePolicyForm({ numbers: { ...defaults(), lunchMinutes: "" }, recipients: "a@x.com" }).ok).toBe(false);
    expect(parsePolicyForm({ numbers: { ...defaults(), lunchMinutes: "abc" }, recipients: "a@x.com" }).ok).toBe(false);
  });
  it("rejects missing or bad recipients", () => {
    expect(parsePolicyForm({ numbers: defaults(), recipients: "  " }).ok).toBe(false);
    expect(parsePolicyForm({ numbers: defaults(), recipients: "not-an-email" }).ok).toBe(false);
  });
  it("covers every numeric policy field exactly once", () => {
    const keys = POLICY_FIELDS.map((f) => f.key).sort();
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(Object.keys(DEFAULT_POLICY).filter((k) => k !== "digestRecipientEmails").sort());
  });
});

describe("rule labels", () => {
  it("has a label for every rule id that exists in the jobs", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const dir = "src/server/watch/jobs";
    const ids = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && f !== "index.ts")
      .flatMap((f) => [...readFileSync(`${dir}/${f}`, "utf8").matchAll(/id: "([a-z0-9.-]+)"/g)].map((m) => m[1]!));
    expect(ids.length).toBeGreaterThan(50);
    expect(ids.filter((id) => !RULE_LABELS[id])).toEqual([]);
  });
});
