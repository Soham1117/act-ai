import { describe, expect, it } from "vitest";
import {
  normalizeEmail,
  optionalNormalizedEmail,
  optionalNormalizedUsername,
} from "./identity";
import { generatePassword } from "./password-generator";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Jane.Doe@ACTools.COM ")).toBe("jane.doe@actools.com");
  });
  it("maps empty/whitespace/null to null", () => {
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });
});

describe("zod normalisers", () => {
  it("normalises emails and treats blank as undefined", () => {
    expect(optionalNormalizedEmail.parse(" A@B.com ")).toBe("a@b.com");
    expect(optionalNormalizedEmail.parse("")).toBeUndefined();
    expect(optionalNormalizedEmail.parse(undefined)).toBeUndefined();
    expect(optionalNormalizedEmail.safeParse("not-an-email").success).toBe(false);
  });
  it("normalises usernames before validating", () => {
    expect(optionalNormalizedUsername.parse("  JSmith ")).toBe("jsmith");
    expect(optionalNormalizedUsername.parse("")).toBeUndefined();
    expect(optionalNormalizedUsername.safeParse("a").success).toBe(false);
    expect(optionalNormalizedUsername.safeParse("bad name").success).toBe(false);
  });
});

describe("generatePassword", () => {
  it("has requested length and mixes character classes", () => {
    const p = generatePassword(16);
    expect(p).toHaveLength(16);
    expect(p).toMatch(/[a-z]/);
    expect(p).toMatch(/[A-Z]/);
    expect(p).toMatch(/\d/);
    expect(p).toMatch(/[!@#$%&*?]/);
  });
  it("is not constant", () => {
    expect(generatePassword()).not.toBe(generatePassword());
  });
});
