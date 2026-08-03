import { requireUser } from "@/lib/auth";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { EmployeeSidebar } from "@/components/employee-sidebar";
import { AppTopbar } from "@/components/app-topbar";
import { db } from "@/lib/db";

export default async function EmployeeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const initialUnread = user.employeeId
    ? await db.notificationRecipient
        .count({ where: { employeeId: user.employeeId, read: false } })
        .catch(() => 0)
    : 0;
  return (
    <SidebarProvider defaultOpen style={{ "--sidebar-width": "13.5rem" } as React.CSSProperties}>
      <EmployeeSidebar />
      <SidebarInset className="min-w-0">
        <AppTopbar user={user} initialUnread={initialUnread} />
        <div className="min-w-0 flex-1 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
