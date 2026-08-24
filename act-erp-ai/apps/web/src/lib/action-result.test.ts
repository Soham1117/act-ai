import { describe, expect, it } from "vitest";
import {
  fail,
  failFromUnknown,
  humanizeUnexpectedError,
  isDigestErrorMessage,
  ok,
} from "./action-result";

describe("ok / fail", () => {
  it("builds success and failure shapes", () => {
    expect(ok()).toEqual({ ok: true });
    expect(ok({ id: "1" })).toEqual({ ok: true, id: "1" });
    expect(fail("nope")).toEqual({ ok: false, error: "nope" });
  });
});

describe("isDigestErrorMessage", () => {
  it("detects Next.js production redaction text", () => {
    expect(
      isDigestErrorMessage(
        "An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details. A digest property is included on this error instance which may provide additional details about the nature of the error.",
      ),
    ).toBe(true);
    expect(isDigestErrorMessage("That email is already in use.")).toBe(false);
  });
});

describe("humanizeUnexpectedError", () => {
  it("maps Prisma unique email conflicts", () => {
    expect(
      humanizeUnexpectedError({ code: "P2002", meta: { target: ["email"] } }),
    ).toMatch(/email is already in use/i);
  });

  it("maps Zod field errors", () => {
    const err = {
      name: "ZodError",
      issues: [{ path: ["personalEmail"], message: "Invalid email" }],
    };
    expect(humanizeUnexpectedError(err)).toBe("Check personalEmail: Invalid email");
  });

  it("returns null for digest Error messages so callers can use a fallback", () => {
    expect(
      humanizeUnexpectedError(
        new Error("An error occurred in the Server Components render. omitted in production"),
      ),
    ).toBeNull();
  });

  it("failFromUnknown always returns a Fail", () => {
    expect(failFromUnknown({ code: "P2002", meta: { target: ["username"] } })).toEqual({
      ok: false,
      error: expect.stringMatching(/username/i),
    });
    expect(failFromUnknown(null).ok).toBe(false);
  });
});
