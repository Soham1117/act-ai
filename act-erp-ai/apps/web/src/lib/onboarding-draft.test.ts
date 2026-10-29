import { describe, expect, it } from "vitest";
import {
  parseOnboardingDraft,
  readBrowserDraft,
  redactDraftBankDetails,
  sanitizeBrowserDraft,
  sanitizeBrowserDraftFields,
  sanitizeDraftFields,
} from "./onboarding-draft";

describe("onboarding draft", () => {
  it("strips passwords from draft fields", () => {
    const fields = sanitizeDraftFields({
      name: "Pat Hire",
      password: "secret-password",
      confirmPassword: "secret-password",
      ssnLast4: "1234",
    });
    expect(fields).toMatchObject({ name: "Pat Hire", ssnLast4: "1234" });
    expect(fields).not.toHaveProperty("password");
    expect(fields).not.toHaveProperty("confirmPassword");
  });

  it("parses a valid draft payload", () => {
    const draft = parseOnboardingDraft({
      step: 3,
      fields: { name: "Pat", drugAccepted: true },
      savedAt: "2026-10-28T20:00:00.000Z",
    });
    expect(draft?.step).toBe(3);
    expect(draft?.fields.name).toBe("Pat");
  });

  it("rejects invalid drafts", () => {
    expect(parseOnboardingDraft({ step: -1, fields: {} })).toBeNull();
    expect(parseOnboardingDraft(null)).toBeNull();
  });

  it("keeps answers in the server draft but never in browser storage", () => {
    const fields = {
      name: "Pat Hire",
      email: "pat@example.test",
      username: "phire",
      password: "do-not-store",
      ssnLast4: "1234",
      dateOfBirth: "2000-01-01",
      address: "1 Test Street",
      phoneNumber: "555-0100",
      emergencyName: "Test Contact",
      ddBankName: "Test Bank",
      ddRouting: "111000025",
      ddAccount: "123456789",
      ddPrintedName: "Pat Hire",
      ddAccepted: true,
      handbookChecklistItemId: "template-1",
    };
    expect(sanitizeDraftFields(fields)).toMatchObject({
      name: "Pat Hire",
      ddAccount: "123456789",
      ssnLast4: "1234",
    });
    expect(sanitizeBrowserDraftFields(fields)).toEqual({
      handbookChecklistItemId: "template-1",
    });
    expect(sanitizeBrowserDraftFields({ application: { felonyExplain: "private" } })).toEqual({});
  });

  it("scrubs legacy browser drafts before restoring them", () => {
    let stored: string | null = JSON.stringify({
      step: 4,
      fields: {
        name: "Pat Hire",
        ddRouting: "111000025",
        ddAccount: "123456789",
        ssnLast4: "1234",
        handbookChecklistItemId: "template-1",
      },
      savedAt: "2026-10-29T12:00:00.000Z",
    });
    const operations: string[] = [];
    const storage = {
      getItem: () => stored,
      removeItem: () => { operations.push("remove"); stored = null; },
      setItem: (_key: string, value: string) => { operations.push("set"); stored = value; },
    };
    const draft = readBrowserDraft(storage, "test-token");
    expect(draft).toEqual({
      step: 4,
      fields: { handbookChecklistItemId: "template-1" },
      savedAt: "2026-10-29T12:00:00.000Z",
    });
    expect(operations).toEqual(["remove", "set"]);
    expect(stored).toBe(JSON.stringify(draft));
  });

  it("removes invalid legacy JSON instead of retaining it", () => {
    let stored: string | null = "not-json-with-sensitive-data";
    const storage = {
      getItem: () => stored,
      removeItem: () => { stored = null; },
      setItem: () => { throw new Error("must not rewrite invalid data"); },
    };
    expect(readBrowserDraft(storage, "test-token")).toBeNull();
    expect(stored).toBeNull();
    expect(sanitizeBrowserDraft({ step: -1, fields: {} })).toBeNull();
  });

  it("leaves no sensitive legacy data when safe storage replacement fails", () => {
    let stored: string | null = JSON.stringify({ step: 1, fields: { ssnLast4: "1234" } });
    const storage = {
      getItem: () => stored,
      removeItem: () => { stored = null; },
      setItem: () => { throw new Error("quota exceeded"); },
    };
    expect(readBrowserDraft(storage, "test-token")).toBeNull();
    expect(stored).toBeNull();
  });

  it("never returns bank numbers or old approval through a public resume link", () => {
    const draft = {
      step: 6,
      fields: { name: "Pat", ddRouting: "111000025", ddAccount: "123456789", ddAccepted: true },
    };
    expect(redactDraftBankDetails(draft)).toEqual({
      step: 6,
      fields: { name: "Pat", ddAccepted: false },
    });
    expect(draft.fields.ddAccount).toBe("123456789");
  });
});
