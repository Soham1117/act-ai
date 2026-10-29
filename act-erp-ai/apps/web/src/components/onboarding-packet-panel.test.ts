import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OnboardingPacketPanel } from "./onboarding-packet-panel";

describe("admin packet disclosure", () => {
  it("never renders full bank or license numbers into HTML", () => {
    const html = renderToStaticMarkup(createElement(OnboardingPacketPanel, {
      packet: {
        consentVersion: "test", submittedAt: new Date("2026-01-01"),
        application: { driversLicenseNumber: "TEST-LICENSE-9876", driversLicenseState: "TX" },
        drugAlcohol: {}, background: {}, handbook: {},
        directDeposit: { routingNumber: "000005555", accountNumber: "0000012345678" },
      },
    }));
    expect(html).not.toContain("000005555");
    expect(html).not.toContain("0000012345678");
    expect(html).not.toContain("TEST-LICENSE-9876");
    expect(html).toContain("5678");
    expect(html).toContain("9876");
  });
});
