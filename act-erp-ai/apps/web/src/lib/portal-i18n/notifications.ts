import { portalMessages, type PortalTranslator } from "./core";

type NotificationCopy = { title: string; message: string; translationKey?: string | null; translationParams?: unknown };

/** Never machine-translate employee/admin text or rewrite historical notifications. */
export function localizeNotification(notification: NotificationCopy, translator: PortalTranslator) {
  const key = notification.translationKey;
  if (translator.language === "en" || !key || !portalMessages[`${key}.title`] || !portalMessages[`${key}.message`]) {
    return { title: notification.title, message: notification.message };
  }
  const values: Record<string, string | number> = {};
  if (notification.translationParams && typeof notification.translationParams === "object" && !Array.isArray(notification.translationParams)) {
    for (const [name, value] of Object.entries(notification.translationParams)) {
      if (typeof value !== "string" && typeof value !== "number") continue;
      if (["status", "leaveType", "tier", "category", "role"].includes(name) && typeof value === "string") {
        values[name] = translator.enumLabel(value.toUpperCase());
      } else if (name.endsWith("Date") || name === "payPeriodEnd") {
        values[name] = translator.formatDateOnly(String(value));
      } else if (name === "amount") {
        const currency = (notification.translationParams as Record<string, unknown>).currency;
        values[name] = translator.formatCurrency(value, typeof currency === "string" ? currency : "USD");
      } else if (name === "change") {
        values[name] = translator.t(value === "updated" ? "notificationTemplates.updated" : "notificationTemplates.entered");
      } else if (name === "note") {
        values[name] = value ? translator.t("notificationTemplates.note", { note: value }) : "";
      } else { values[name] = value; }
    }
  }
  return { title: translator.t(`${key}.title`, values), message: translator.t(`${key}.message`, values) };
}
