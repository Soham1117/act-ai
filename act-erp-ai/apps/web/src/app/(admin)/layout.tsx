import { requireAdmin } from "@/lib/auth";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AdminSidebar } from "@/components/admin-sidebar";
import { AppTopbar } from "@/components/app-topbar";
import { db } from "@/lib/db";
import { aiEnabled } from "@/lib/features";
import { Providers } from "@/components/providers";

// Every page in this group is session-scoped and DB-backed — there is nothing
// here that can be meaningfully prerendered at build time. Declaring it keeps
// the build from attempting a static export of authenticated pages.
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  const initialUnread = user.employeeId
    ? await db.notificationRecipient
        .count({ where: { employeeId: user.employeeId, read: false } })
        .catch(() => 0)
    : 0;
  return (
    <Providers>
      <SidebarProvider defaultOpen style={{ "--sidebar-width": "13.5rem" } as React.CSSProperties}>
        <AdminSidebar aiEnabled={aiEnabled} />
        <SidebarInset className="min-w-0">
          <AppTopbar user={user} initialUnread={initialUnread} />
          <div className="min-w-0 flex-1 p-4 md:p-6">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </Providers>
  );
}
