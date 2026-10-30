"use client";

import { Fragment, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  InlinePanel,
  InlinePanelContent,
  PanelSlot,
  PanelSlotRow,
  InlinePanelDescription,
  InlinePanelFooter,
  InlinePanelHeader,
  InlinePanelTitle,
} from "@/components/inline-panel";
import { runAction, toastAction } from "@/lib/toast-action";
import {
  createAgency,
  setAgencyActive,
  updateAgency,
} from "@/server/actions/contract-workers";
import { DataListCard, ResponsiveDataList } from "@/components/mobile";
import type { AgencyRow } from "./shared";

export function AgencyForm({ agency }: { agency?: AgencyRow }) {
  const formId = useId();
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
      const res = agency
        ? await runAction(() => updateAgency(agency.id, input))
        : await runAction(() => createAgency(input));
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
        <Button
          className="min-h-11 md:min-h-9"
          size="sm"
          variant="ghost"
          onClick={() => { if (!pending) setOpen(true); }}
        >
          <Pencil className="mr-1 h-3.5 w-3.5" />
          Edit
        </Button>
      ) : (
        <Button className="min-h-11 md:min-h-9" size="sm" onClick={() => { if (!pending) setOpen(true); }}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add agency
        </Button>
      )}
      <InlinePanel
        open={open}
        onOpenChange={(v) => {
          if (pending) return;
          setOpen(v);
          if (v) reset();
        }}
      >
        <InlinePanelContent panelSlot={agency ? `agency-${agency.id}` : undefined}>
          <InlinePanelHeader>
            <InlinePanelTitle>
              {agency ? `Edit ${agency.name}` : "Add agency"}
            </InlinePanelTitle>
            <InlinePanelDescription>
              Staffing agency that supplies contract workers.
            </InlinePanelDescription>
          </InlinePanelHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor={`${formId}-name`}>Name</Label>
              <Input
                id={`${formId}-name`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${formId}-contact`}>Contact name</Label>
              <Input
                id={`${formId}-contact`}
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                maxLength={120}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor={`${formId}-phone`}>Phone</Label>
                <Input
                  id={`${formId}-phone`}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  maxLength={40}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${formId}-email`}>Email</Label>
                <Input
                  id={`${formId}-email`}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={200}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${formId}-notes`}>Notes</Label>
              <Textarea
                id={`${formId}-notes`}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={2000}
              />
            </div>
          </div>
          <InlinePanelFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {agency ? "Save changes" : "Add agency"}
            </Button>
          </InlinePanelFooter>
        </InlinePanelContent>
      </InlinePanel>
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
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No agencies yet. Add one to start.
      </p>
    );
  const table = (
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
            <Fragment key={a.id}>
            <tr className="border-b last:border-0 [&:has(+tr_[data-panel-open])]:bg-primary/10">
              <td className="p-3 font-medium">{a.name}</td>
              <td className="p-3 text-xs">
                <div>{a.contactName ?? "—"}</div>
                <div className="text-muted-foreground">
                  {[a.phone, a.email].filter(Boolean).join(" · ")}
                </div>
              </td>
              <td className="p-3 tabular-nums">{a.workerCount}</td>
              <td className="p-3">
                <Badge
                  variant={a.isActive ? "success" : "secondary"}
                  className="text-[10px]"
                >
                  {a.isActive ? "Active" : "Inactive"}
                </Badge>
              </td>
              <td className="p-3">
                <div className="flex flex-wrap justify-end gap-1">
                  <AgencyForm agency={a} />
                  <ActiveToggle agency={a} />
                </div>
              </td>
            </tr>
            <PanelSlotRow id={`agency-${a.id}`} colSpan={6} />
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <ResponsiveDataList
      mobile={
        <div className="space-y-2 p-2">
          {agencies.map((a) => (
            <Fragment key={a.id}>
            <DataListCard>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{a.name}</p>
                  <Badge
                    variant={a.isActive ? "success" : "secondary"}
                    className="text-[10px]"
                  >
                    {a.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {a.contactName ?? "—"}
                  {[a.phone, a.email].filter(Boolean).length > 0 &&
                    ` · ${[a.phone, a.email].filter(Boolean).join(" · ")}`}
                </p>
                <p className="text-xs">
                  <span className="font-medium tabular-nums">{a.workerCount}</span>{" "}
                  workers
                </p>
                <div className="flex flex-wrap gap-1">
                  <AgencyForm agency={a} />
                  <ActiveToggle agency={a} />
                </div>
              </div>
            </DataListCard>
            <PanelSlot id={`agency-${a.id}`} view="mobile" />
            </Fragment>
          ))}
        </div>
      }
      desktop={table}
    />
  );
}
