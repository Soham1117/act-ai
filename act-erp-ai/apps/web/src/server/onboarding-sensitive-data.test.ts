import { beforeEach, describe, expect, it, vi } from "vitest";

const crypto = vi.hoisted(() => ({ encrypt: vi.fn(), decrypt: vi.fn() }));
vi.mock("./sensitive-data", () => ({
  encryptSensitiveJson: crypto.encrypt,
  decryptSensitiveJson: crypto.decrypt,
}));

import {
  ONBOARDING_PACKET_FIELDS,
  encryptOnboardingPacketFields,
  decryptOnboardingPacketFields,
  onboardingDraftContext,
} from "./onboarding-sensitive-data";

const packet = {
  application: { driversLicenseNumber: "dummy-license" },
  drugAlcohol: { accepted: true, printedName: "Test Hire" },
  background: { accepted: true },
  directDeposit: { accountNumber: "000000000", routingNumber: "000000000" },
  handbook: { accepted: true },
};

describe("onboarding sensitive data", () => {
  beforeEach(() => vi.resetAllMocks());

  it("encrypts every packet section with its invite and field binding", async () => {
    crypto.encrypt.mockImplementation(async (_value, context) => ({
      ciphertext: `cipher:${context.field}`,
    }));
    const encrypted = await encryptOnboardingPacketFields("invite-test", packet);
    expect(crypto.encrypt).toHaveBeenCalledTimes(5);
    for (const field of ONBOARDING_PACKET_FIELDS) {
      expect(crypto.encrypt).toHaveBeenCalledWith(packet[field], {
        purpose: "onboarding-packet", recordId: "invite-test", field,
      });
      expect(encrypted[field]).toEqual({ ciphertext: `cipher:${field}` });
    }
    expect(JSON.stringify(encrypted)).not.toContain("000000000");
    expect(JSON.stringify(encrypted)).not.toContain("dummy-license");
  });

  it("does not return a partly plaintext packet when encryption fails", async () => {
    crypto.encrypt.mockRejectedValue(new Error("Encryption unavailable"));
    await expect(encryptOnboardingPacketFields("invite-test", packet))
      .rejects.toThrow("Encryption unavailable");
  });

  it("decrypts the same bindings and retains packet metadata", async () => {
    crypto.decrypt.mockImplementation(async (_value, context) => packet[context.field as keyof typeof packet]);
    const encrypted = Object.fromEntries(ONBOARDING_PACKET_FIELDS.map((field) => [field, { ciphertext: field }])) as Record<keyof typeof packet, unknown>;
    const row = { ...encrypted, consentVersion: "test", submittedAt: new Date("2026-01-01") };
    const opened = await decryptOnboardingPacketFields("invite-test", row);
    expect(opened).toEqual({ ...packet, consentVersion: row.consentVersion, submittedAt: row.submittedAt });
    for (const field of ONBOARDING_PACKET_FIELDS) {
      expect(crypto.decrypt).toHaveBeenCalledWith(encrypted[field], {
        purpose: "onboarding-packet", recordId: "invite-test", field,
      });
    }
  });

  it("fails closed rather than displaying a partial packet on decryption failure", async () => {
    crypto.decrypt.mockRejectedValue(new Error("Unable to read protected details"));
    await expect(decryptOnboardingPacketFields("invite-test", packet))
      .rejects.toThrow("Unable to read protected details");
  });

  it("keeps invite drafts separate from submitted packet fields", () => {
    expect(onboardingDraftContext("invite-test")).toEqual({
      purpose: "onboarding-draft", recordId: "invite-test", field: "draftJson",
    });
  });
});
