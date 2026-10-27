import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createPortalTranslator, normalizePortalLanguage, portalMessages } from "./core";
vi.mock("@/server/actions/portal-language", () => ({ setPortalLanguage: vi.fn() }));
import { PortalLanguageProvider } from "@/components/portal-language";
import { TimeEntriesList } from "@/app/(employee)/dashboard/time-tracking/time-entries-list";

describe("portal language foundation", () => {
  it("keeps translation source valid UTF-8 for the production compiler", () => {
    const directory = join(process.cwd(), "src/lib/portal-i18n/catalogs");
    for (const file of readdirSync(directory)) {
      expect(() => new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(join(directory, file))), file).not.toThrow();
    }
  });
  it("normalizes untrusted preferences and interpolates data without translating it", () => {
    expect(normalizePortalLanguage("es")).toBe("es");
    expect(normalizePortalLanguage("unsupported")).toBe("en");
    expect(createPortalTranslator("es").t("timesheet.kioskTitle", { name: "Shop 01" })).toContain("Shop 01");
  });
  it("provides both languages and identical interpolation names for each message", () => {
    for (const [key, value] of Object.entries(portalMessages)) {
      expect(value.en, key).toBeTruthy(); expect(value.es, key).toBeTruthy();
      expect([...value.en.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), key)
        .toEqual([...value.es.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort());
    }
  });
  it("keeps SQL date-only values on their calendar day and time displays in Chicago", () => {
    const es = createPortalTranslator("es");
    expect(es.formatDateOnly("2026-01-01")).toMatch(/1.*ene.*2026/i);
    expect(es.formatTime("2026-01-01T06:30:00Z")).toMatch(/12:30/);
    expect(es.formatCurrency(1234.5)).toContain("1,234.50");
  });
  it("renders a timesheet in either language while preserving employee content", () => {
    const entries = [{ id: "fixture", date: "2026-01-01", clockInIso: "2026-01-01T14:00:00Z", clockOutIso: "2026-01-01T22:00:00Z", jobCode: "ACT-1", totalWorkMin: 480, totalBreakMin: 0, status: "COMPLETED", approvalStatus: "APPROVED", source: "KIOSK" as const, kioskLabel: "Shop 01", kioskSlug: "shop", approvalNotes: null, editReason: null, edited: false, autoClosed: false }];
    // React.createElement types require this provider's non-optional children prop.
    // eslint-disable-next-line react/no-children-prop
    const render = (language: "en" | "es") => renderToStaticMarkup(createElement(PortalLanguageProvider, { language, children: createElement(TimeEntriesList, { entries }) }));
    expect(render("en")).toMatch(/approved/i);
    expect(render("es")).toMatch(/aprobado/i);
    expect(render("es")).toContain("Shop 01");
    expect(render("es")).toContain("ACT-1");
  });
});
