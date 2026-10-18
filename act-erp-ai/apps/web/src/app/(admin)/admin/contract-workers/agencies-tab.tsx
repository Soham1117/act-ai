"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { runAction, toastAction } from "@/lib/toast-action";
import { createAgency, setAgencyActive, updateAgency } from "@/server/actions/contract-workers";
import type { AgencyRow } from "./shared";

export function AgencyFormDialog({ agency }: { agency?: AgencyRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(agency?.name ?? "");
  const [contactName, setContactName] = useState(agency?.contactName ?? "");
  const [phone, setPhone] = useState(agency?.phone ?? "");
  const [email, setEmail] = useState(agency?.email ?? "");
  const [notes, setNotes] = useState(agency?.notes ?? "");

  function reset() {
    setName(agency?.name ?? "");
    setContactName(agency?.contactName ?? "");
    setPhone(agency?.phone ?? "");
    setEmail(agency?.email ?? "");
    setNotes(agency?.notes ?? "");
  }

  function submit() {
    if (!name.trim()) return toast.error("Enter the agency name.");
    const input = {
      name,
      contactName: contactName || null,
      phone: phone || null,
      email: email || null,
      notes: notes || null,
    };
    startTransition(async () => {
      const res = agency ? await runAction(() => updateAgency(agency.id, input)) : await runAction(() => createAgency(input));
      if (!toastAction(res)) return;
      toast.success(agency ? "Agency updated" : "Agency added");
      setOpen(false);
      if (!agency) reset();
      router.refresh();
    });
  }

  return (
    <>
      {agency ? (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          <Pencil className="mr-1 h-3.5 w-3.5" />
          Edit
        </Button>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add agency
        </Button>
      )}
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (v) reset();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{agency ? `Edit ${agency.name}` : "Add agency"}</DialogTitle>
            <DialogDescription>Staffing agency that supplies contract workers.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="ag-name">Name</Label>
              <Input id="ag-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ag-contact">Contact name</Label>
              <Input
                id="ag-contact"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                maxLength={120}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="ag-phone">Phone</Label>
                <Input id="ag-phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ag-email">Email</Label>
                <Input
                  id="ag-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={200}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ag-notes">Notes</Label>
              <Textarea id="ag-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {agency ? "Save changes" : "Add agency"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ActiveToggle({ agency }: { agency: AgencyRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await runAction(() => setAgencyActive(agency.id, !agency.isActive));
          if (!toastAction(res)) return;
          toast.success(agency.isActive ? "Agency deactivated" : "Agency activated");
          router.refresh();
        })
      }
    >
      {pending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
      {agency.isActive ? "Deactivate" : "Activate"}
    </Button>
  );
}

export function AgenciesTable({ agencies }: { agencies: AgencyRow[] }) {
  if (agencies.length === 0)
    return <p className="py-10 text-center text-sm text-muted-foreground">No agencies yet. Add one to start.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="p-3 font-medium">Agency</th>
            <th className="p-3 font-medium">Contact</th>
            <th className="p-3 font-medium">Workers</th>
            <th className="p-3 font-medium">Status</th>
            <th className="p-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {agencies.map((a) => (
            <tr key={a.id} className="border-b last:border-0">
              <td className="p-3 font-medium">{a.name}</td>
              <td className="p-3 text-xs">
                <div>{a.contactName ?? "—"}</div>
                <div className="text-muted-foreground">{[a.phone, a.email].filter(Boolean).join(" · ")}</div>
              </td>
              <td className="p-3 tabular-nums">{a.workerCount}</td>
              <td className="p-3">
                <Badge variant={a.isActive ? "success" : "secondary"} className="text-[10px]">
                  {a.isActive ? "Active" : "Inactive"}
                </Badge>
              </td>
              <td className="p-3">
                <div className="flex justify-end gap-1">
                  <AgencyFormDialog agency={a} />
                  <ActiveToggle agency={a} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
