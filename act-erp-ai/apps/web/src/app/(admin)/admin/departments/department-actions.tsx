"use client";

import { useState, useTransition } from "react";
import { Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toastAction, toastCaught } from "@/lib/toast-action";
import { deleteDepartment } from "@/server/actions/departments";
import { DepartmentDialog, type DepartmentFormValues } from "./department-dialog";

/** Edit / Delete menu for one department card. */
export function DepartmentActions({ department }: { department: DepartmentFormValues }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirmDelete() {
    startTransition(async () => {
      try {
        const res = await deleteDepartment(department.id);
        if (!toastAction(res)) return;
        toast.success(`Deleted ${department.name}`);
        setDeleting(false);
      } catch (err) {
        toastCaught(err);
      }
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={`Actions for ${department.name}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditing(true)}>
            <Pencil className="mr-2 h-4 w-4" /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => setDeleting(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {editing && (
        <DepartmentDialog
          key={department.id}
          existing={department}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(false);
          }}
        />
      )}

      <Dialog open={deleting} onOpenChange={(o) => !pending && setDeleting(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {department.name}?</DialogTitle>
            <DialogDescription>
              This removes the department. A department that still has employees or open
              onboarding invites cannot be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
