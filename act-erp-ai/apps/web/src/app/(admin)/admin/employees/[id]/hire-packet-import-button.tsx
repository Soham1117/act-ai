"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { uploadHirePacketZip } from "@/server/actions/hire-packet";
import { toastAction } from "@/lib/toast-action";

export function HirePacketImportButton({ employeeId }: { employeeId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;

    startTransition(async () => {
      const bytes = await file.arrayBuffer();
      const res = await uploadHirePacketZip(employeeId, { name: file.name, bytes });
      if (!toastAction(res)) return;

      setOpen(false);
      reset();
      router.push(`/admin/employees/${employeeId}/hire-import/${res.jobId}`);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Archive className="mr-1.5 h-3.5 w-3.5" />
          Import hire packet
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Import hire packet</DialogTitle>
            <DialogDescription>
              Upload a .zip of onboarding forms (I-9, W-4, offer letter, ID, direct deposit).
              Files are stored and fields are extracted for your review before applying.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-4">
            <div className="grid gap-2">
              <Label htmlFor="hire-zip">Zip file</Label>
              <Input
                ref={inputRef}
                id="hire-zip"
                type="file"
                accept=".zip,application/zip"
                disabled={pending}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {file && (
                <p className="text-xs text-muted-foreground">
                  {file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !file}>
              {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Upload &amp; process
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
