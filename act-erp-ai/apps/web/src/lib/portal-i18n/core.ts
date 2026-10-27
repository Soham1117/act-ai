import { recoveryMessages } from "./catalogs/recovery";
import { notificationTemplateMessages } from "./catalogs/notification-templates";
import { documentControlMessages } from "./catalogs/document-controls";
import { businessErrorMessages } from "./catalogs/business-errors";
import { enUS, es } from "date-fns/locale";
import { BUSINESS_TIME_ZONE, plainSpaces } from "@/lib/format";
import { commonMessages } from "./catalogs/common";
import { timesheetMessages } from "./catalogs/timesheet";
import { timeMessages } from "./catalogs/time";
import { workspaceMessages } from "./catalogs/workspace";
import { recordsMessages } from "./catalogs/records";
import { accountMessages } from "./catalogs/account";
import { notificationsMessages } from "./catalogs/notifications";
import { homeMessages } from "./catalogs/home";
import { authMessages } from "./catalogs/auth";
import { serverErrorMessages } from "./catalogs/server-errors";
import { errorMessages } from "./catalogs/errors";

export type PortalLanguage = "en" | "es";
export type MessageCatalog = Record<string, { en: string; es: string }>;
export const PORTAL_LANGUAGE_COOKIE = "act_portal_language";
export const portalMessages: MessageCatalog = {
  ...recoveryMessages, ...businessErrorMessages, ...documentControlMessages, ...commonMessages, ...timesheetMessages, ...timeMessages, ...workspaceMessages,
  ...recordsMessages, ...accountMessages, ...notificationsMessages, ...homeMessages, ...authMessages, ...errorMessages, ...serverErrorMessages, ...notificationTemplateMessages,
};

export function normalizePortalLanguage(value: unknown): PortalLanguage {
  return value === "es" ? "es" : "en";
}

export function createPortalTranslator(language: PortalLanguage) {
  const locale = language === "es" ? "es-US" : "en-US";
  const t = (key: string, params: Record<string, string | number> = {}) => {
    const template = portalMessages[key]?.[language] ?? portalMessages[key]?.en ?? key;
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      Object.hasOwn(params, name) ? String(params[name]) : match,
    );
  };
  const date = (value: Date | string | number | null | undefined, options: Intl.DateTimeFormatOptions) => {
    if (value === null || value === undefined || value === "") return "—";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "—" : plainSpaces(new Intl.DateTimeFormat(locale, options).format(parsed));
  };
  return {
    language, locale, t, dateFnsLocale: language === "es" ? es : enUS,
    errorMessage: (result: { error: string; errorCode?: string; errorParams?: Record<string, string | number> }) =>
      language === "en" ? result.error : result.errorCode && portalMessages[result.errorCode]
        ? t(result.errorCode, Object.fromEntries(Object.entries(result.errorParams ?? {}).map(([name, value]) => [
          name,
          ["status", "type", "from", "to"].includes(name) && typeof value === "string"
            ? portalMessages[`enum.${value.toUpperCase()}`]?.[language] ?? value
            : name.endsWith("Date") ? date(String(value), { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : value,
        ])))
        : t("errors.unexpected"),
    formatDate: (value: Date | string | number | null | undefined, options: Intl.DateTimeFormatOptions = {}) =>
      date(value, { timeZone: BUSINESS_TIME_ZONE, month: "short", day: "numeric", year: "numeric", ...options }),
    formatDateOnly: (value: Date | string | null | undefined) =>
      date(value, { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }),
    formatDateTime: (value: Date | string | null | undefined) =>
      date(value, { timeZone: BUSINESS_TIME_ZONE, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }),
    formatTime: (value: Date | string | null | undefined) =>
      date(value, { timeZone: BUSINESS_TIME_ZONE, hour: "numeric", minute: "2-digit", hour12: true }),
    formatCurrency: (amount: number | string | null | undefined, currency = "USD") => {
      if (amount === null || amount === undefined || !Number.isFinite(Number(amount))) return "—";
      return plainSpaces(new Intl.NumberFormat(locale, { style: "currency", currency }).format(Number(amount)));
    },
    formatRelative: (value: Date | string | number) => {
      const seconds = (new Date(value).getTime() - Date.now()) / 1000;
      if (!Number.isFinite(seconds)) return "—";
      const units = [[31536000, "year"], [2592000, "month"], [86400, "day"], [3600, "hour"], [60, "minute"], [1, "second"]] as const;
      const [divisor, unit] = units.find(([size]) => Math.abs(seconds) >= size) ?? units[units.length - 1]!;
      return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(Math.round(seconds / divisor), unit);
    },
    enumLabel: (code: string) => portalMessages[`enum.${code}`]?.[language] ?? code.replace(/_/g, " ").toLowerCase(),
  };
}
export type PortalTranslator = ReturnType<typeof createPortalTranslator>;
