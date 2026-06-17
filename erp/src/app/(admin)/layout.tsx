import { requireAdmin } from "@/lib/auth";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AdminSidebar } from "@/components/admin-sidebar";
import { AppTopbar } from "@/components/app-topbar";
import { db } from "@/lib/db";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  const initialUnread = user.employeeId
    ? await db.notificationRecipient
        .count({ where: { employeeId: user.employeeId, read: false } })
        .catch(() => 0)
    : 0;
  return (
    <SidebarProvider defaultOpen>
      <AdminSidebar />
      <SidebarInset>
        <AppTopbar user={user} initialUnread={initialUnread} />
        <div className="flex-1 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
