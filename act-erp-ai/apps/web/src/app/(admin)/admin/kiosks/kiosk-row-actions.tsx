"use client";

import { useState, useTransition } from "react";
import {
  Copy,
  ExternalLink,
  MoreHorizontal,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { deleteKiosk, revokeKiosk } from "@/server/actions/kiosk";

export function KioskRowActions({
  id,
  slug,
  isActive,
}: {
  id: string;
  slug: string | null;
  isActive: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={pending}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {slug && (
            <>
              <DropdownMenuItem asChild>
                <Link href={`/kiosk/${slug}`} target="_blank">
                  <ExternalLink className="mr-2 h-3.5 w-3.5" /> Open terminal
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  navigator.clipboard.writeText(
                    `${window.location.origin}/kiosk/${slug}`,
                  );
                  toast.success("URL copied");
                }}
              >
                <Copy className="mr-2 h-3.5 w-3.5" /> Copy URL
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {isActive && (
            <DropdownMenuItem
              onClick={() =>
                startTransition(async () => {
                  try {
                    await revokeKiosk(id);
                    toast.success("Kiosk revoked");
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Failed");
                  }
                })
              }
            >
              <X className="mr-2 h-3.5 w-3.5" /> Revoke session
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() => setConfirmDelete(true)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete kiosk
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this kiosk?</AlertDialogTitle>
            <AlertDialogDescription>
              The kiosk record is removed. The slug becomes available again.
              Time entries already recorded by this kiosk are preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                startTransition(async () => {
                  try {
                    await deleteKiosk(id);
                    toast.success("Kiosk deleted");
                    setConfirmDelete(false);
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Failed");
                  }
                });
              }}
              disabled={pending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
