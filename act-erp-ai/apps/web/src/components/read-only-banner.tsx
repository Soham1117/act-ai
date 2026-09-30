import { Lock } from "lucide-react";
import type { EmploymentStatus } from "@prisma/client";
import { readOnlyUntil } from "@/lib/employee-validation";

/** Visible notice on every employee page when the account is read-only. */
export function ReadOnlyBanner({
  status,
  terminationDate,
}: {
  status: EmploymentStatus | null;
  terminationDate: Date | null;
}) {
  let message: string;
  if (status === "PENDING_REVIEW") {
    message =
      "Your account is awaiting approval by an administrator. You can look around, but you can't make changes (time off, requests, reimbursements, settings) until you're approved.";
  } else if (status === "TERMINATED") {
    const until = terminationDate
      ? readOnlyUntil(terminationDate).toLocaleDateString("en-US", {
          timeZone: "UTC",
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : null;
    message = `Your employment has ended. You can still view your pay stubs and documents${
      until ? ` until ${until}` : " for a limited time"
    }, but you can't make changes.`;
  } else {
    message = "Your account is read-only. You can view your records but can't make changes.";
  }
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
