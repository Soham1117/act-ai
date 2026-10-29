import { describe, expect, it } from "vitest";
import {
  ONBOARDING_CONSENT_VERSION,
  emptyApplication,
  maskAccountNumber,
  packetPayloadSchema,
} from "./onboarding-packet";

describe("onboarding packet schema", () => {
  it("accepts a complete packet", () => {
    const parsed = packetPayloadSchema.safeParse({
      application: {
        ...emptyApplication(),
        positionApplied: "Welder",
        felony: "NO",
        workInUsa: "YES",
      },
      drugAlcohol: {
        accepted: true,
        printedName: "Jane Doe",
        textVersion: ONBOARDING_CONSENT_VERSION,
      },
      background: {
        accepted: true,
        printedName: "Jane Doe",
        textVersion: ONBOARDING_CONSENT_VERSION,
      },
      directDeposit: {
        bankName: "First National",
        bankLocation: "Houston, TX",
        routingNumber: "111000025",
        accountNumber: "123456789",
        accountType: "CHECKING",
        printedName: "Jane Doe",
        accepted: true,
        textVersion: ONBOARDING_CONSENT_VERSION,
      },
      handbook: {
        accepted: true,
        printedName: "Jane Doe",
        title: "Employee Handbook",
        versionNumber: 1,
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects bad routing numbers", () => {
    const parsed = packetPayloadSchema.safeParse({
      application: emptyApplication(),
      drugAlcohol: {
        accepted: true,
        printedName: "Jane Doe",
        textVersion: ONBOARDING_CONSENT_VERSION,
      },
      background: {
        accepted: true,
        printedName: "Jane Doe",
        textVersion: ONBOARDING_CONSENT_VERSION,
      },
      directDeposit: {
        bankName: "Bank",
        routingNumber: "123",
        accountNumber: "9999",
        accountType: "CHECKING",
        printedName: "Jane Doe",
        accepted: true,
        textVersion: ONBOARDING_CONSENT_VERSION,
      },
      handbook: { accepted: true, printedName: "Jane Doe" },
    });
    expect(parsed.success).toBe(false);
  });

  it("masks account numbers", () => {
    expect(maskAccountNumber("123456789")).toBe("•••••6789");
  });
});
