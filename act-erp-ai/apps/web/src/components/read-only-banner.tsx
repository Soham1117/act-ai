import { getPortalLanguage } from "@/lib/portal-i18n/server";
import { Lock } from "lucide-react";
import type { EmploymentStatus } from "@prisma/client";
import { readOnlyUntil } from "@/lib/employee-validation";

/** Visible notice on every employee page when the account is read-only. */
export async function ReadOnlyBanner({
  status,
  terminationDate,
}: {
  status: EmploymentStatus | null;
  terminationDate: Date | null;
}) {
  const { t, formatDateOnly } = await getPortalLanguage();
  const message = status === "PENDING_REVIEW" ? t("common.pendingReview")
    : status === "INACTIVE" ? t("common.inactiveReadOnly")
    : status === "TERMINATED" ? terminationDate
      ? t("common.terminatedReadOnly", { date: formatDateOnly(readOnlyUntil(terminationDate)) })
      : t("common.terminatedLimited")
    : t("common.readOnly");
  return (
    <div
      role="status"
      className="flex items-start gap-2 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-900 dark:text-amber-200 md:px-6"
    >
      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <p>{message}</p>
    </div>
  );
}
