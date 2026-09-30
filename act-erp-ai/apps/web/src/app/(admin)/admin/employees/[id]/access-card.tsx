"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toastAction } from "@/lib/toast-action";
import { setUserRole } from "@/server/actions/employees";

/** Promote / demote an admin. Server refuses self-change and the last admin. */
export function AccessCard({
  employeeId,
  name,
  role,
  isSelf,
  canPromote,
  mustChangePassword,
}: {
  employeeId: string;
  name: string;
  role: "ADMIN" | "EMPLOYEE";
  isSelf: boolean;
  /** Only active employees can be made admins. */
  canPromote: boolean;
  mustChangePassword: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const target = role === "ADMIN" ? "EMPLOYEE" : "ADMIN";

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Access</CardTitle>
          <Badge variant={role === "ADMIN" ? "default" : "secondary"}>
            {role === "ADMIN" ? "Admin" : "Employee"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Admins can see and change every employee record, run payroll uploads and manage
            settings. Changing a role signs that person out.
          </p>
          {mustChangePassword && (
            <p className="text-xs text-amber-600">
              Has a temporary password and must choose a new one at next sign-in.
            </p>
          )}
          {isSelf ? (
            <p className="text-xs text-muted-foreground">
              You can&apos;t change your own role. Ask another admin.
            </p>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={pending || (role === "EMPLOYEE" && !canPromote)}
              title={
                role === "EMPLOYEE" && !canPromote
                  ? "Only active employees can be made admins"
                  : undefined
              }
              onClick={() => setOpen(true)}
            >
              {role === "ADMIN" ? (
                <>
                  <ShieldOff className="mr-2 h-3.5 w-3.5" /> Remove admin access
                </>
              ) : (
                <>
                  <ShieldCheck className="mr-2 h-3.5 w-3.5" /> Make admin
                </>
              )}
            </Button>
          )}
        </CardContent>
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {target === "ADMIN" ? `Make ${name} an admin?` : `Remove admin access from ${name}?`}
            </DialogTitle>
            <DialogDescription>
              {target === "ADMIN"
                ? "They will be able to view and edit everything in the admin area. They are signed out and must sign in again."
                : "They will only see their own employee pages. They are signed out and must sign in again. There must always be at least one admin."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await setUserRole(employeeId, target);
                  if (!toastAction(res)) return;
                  toast.success(target === "ADMIN" ? "Admin access granted" : "Admin access removed");
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
