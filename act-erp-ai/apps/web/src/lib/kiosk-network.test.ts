import { describe, expect, it } from "vitest";
import { ipMatchesNetwork, isIpAllowed } from "./ip-network";

describe("kiosk network allowlist", () => {
  it("matches exact IPv4 and IPv4-mapped addresses", () => {
    expect(ipMatchesNetwork("12.228.151.122", "12.228.151.122")).toBe(true);
    expect(ipMatchesNetwork("::ffff:12.228.151.122", "12.228.151.122")).toBe(true);
  });

  it("matches IPv4 CIDRs and rejects addresses outside them", () => {
    expect(ipMatchesNetwork("192.168.10.42", "192.168.10.0/24")).toBe(true);
    expect(ipMatchesNetwork("192.168.11.42", "192.168.10.0/24")).toBe(false);
  });

  it("accepts any configured rule and fails closed without configuration", () => {
    expect(isIpAllowed("203.0.113.8", "10.0.0.0/8, 203.0.113.8")).toBe(true);
    expect(isIpAllowed("203.0.113.8", undefined)).toBe(false);
    expect(isIpAllowed(null, "203.0.113.8")).toBe(false);
  });
});
