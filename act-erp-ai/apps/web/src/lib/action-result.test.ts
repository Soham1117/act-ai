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
  it("turns browser network errors into a plain message", () => {
    for (const m of ["Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed"]) {
      expect(humanizeUnexpectedError(new TypeError(m))).toBe(
        "Could not reach the server. Check the connection and try again.",
      );
    }
  });

  it("tells the user to reload a page left open across a deploy", () => {
    expect(humanizeUnexpectedError(new Error('Failed to find Server Action "abc123".'))).toBe(
      "This page is out of date. Reload the page and try again.",
    );
  });

  it("recognises the stale-action message the Next.js client throws", () => {
    expect(
      humanizeUnexpectedError(new Error('Server Action "abc" was not found on the server. Read more: https://nextjs.org/docs/messages/failed-to-find-server-action')),
    ).toBe("This page is out of date. Reload the page and try again.");
  });

  it("turns a server crash body into a plain message", () => {
    for (const m of ["Internal Server Error", "An unexpected response was received from the server.", "Bad Gateway"]) {
      expect(humanizeUnexpectedError(new Error(m))).toBe("The server had a problem. Try again in a moment.");
    }
  });

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
      errorCode: "errors.conflict",
    });
    expect(failFromUnknown(null)).toMatchObject({
      ok: false,
      errorCode: "errors.unexpected",
    });
  });
});
