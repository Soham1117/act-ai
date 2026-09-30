import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { ReadOnlyBanner } from "@/components/read-only-banner";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { EmployeeSidebar } from "@/components/employee-sidebar";
import { AppTopbar } from "@/components/app-topbar";
import { db } from "@/lib/db";
import { aiEnabled } from "@/lib/features";
import { Providers } from "@/components/providers";

// Every page in this group is session-scoped and DB-backed — there is nothing
// here that can be meaningfully prerendered at build time. Declaring it keeps
// the build from attempting a static export of authenticated pages.
export const dynamic = "force-dynamic";

export default async function EmployeeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  // Admin-set password must be replaced before anything else.
  if (user.mustChangePassword) redirect("/change-password");
  const readOnly =
    user.accessLevel !== "FULL" && user.employeeId
      ? await db.employee
          .findUnique({
            where: { id: user.employeeId },
            select: { employmentStatus: true, terminationDate: true },
          })
          .catch(() => null)
      : null;
  const initialUnread = user.employeeId
    ? await db.notificationRecipient
        .count({ where: { employeeId: user.employeeId, read: false } })
        .catch(() => 0)
    : 0;
  return (
    <Providers>
      <SidebarProvider defaultOpen style={{ "--sidebar-width": "13.5rem" } as React.CSSProperties}>
        <EmployeeSidebar aiEnabled={aiEnabled} />
        <SidebarInset className="min-w-0">
          <AppTopbar user={user} initialUnread={initialUnread} />
          {user.accessLevel !== "FULL" && (
            <ReadOnlyBanner
              status={readOnly?.employmentStatus ?? null}
              terminationDate={readOnly?.terminationDate ?? null}
            />
          )}
          <div className="min-w-0 flex-1 p-4 md:p-6">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </Providers>
  );
}
