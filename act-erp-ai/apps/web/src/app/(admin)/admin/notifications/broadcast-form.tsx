"use client";

import { useId, useState, useTransition } from "react";
import { Plus, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  InlinePanel,
  InlinePanelContent,
  InlinePanelDescription,
  InlinePanelFooter,
  InlinePanelHeader,
  InlinePanelTitle,
  InlinePanelTrigger,
} from "@/components/inline-panel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { broadcastNotification } from "@/server/actions/notifications";
import { runAction, toastAction } from "@/lib/toast-action";

const TYPES = ["PAYROLL", "COMPANY", "ANNOUNCEMENT", "POLICY", "OTHER"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

export function BroadcastForm({
  departments,
}: {
  departments: { id: string; name: string }[];
}) {
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState<(typeof TYPES)[number]>("ANNOUNCEMENT");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>("MEDIUM");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [link, setLink] = useState("");
  const [scope, setScope] = useState<"all" | "departments">("all");
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await runAction(() =>
        broadcastNotification({
          type,
          priority,
          title,
          message,
          link: link || undefined,
          departmentIds: scope === "departments" ? selectedDepts : undefined,
        }),
      );
      if (!toastAction(r)) return;
      toast.success(`Sent to ${r.recipientCount} recipient(s)`);
      setOpen(false);
      setTitle("");
      setMessage("");
      setLink("");
      setSelectedDepts([]);
      setScope("all");
    });
  }

  return (
    <InlinePanel open={open} onOpenChange={setOpen}>
      <InlinePanelTrigger asChild disabled={pending}>
        <Button>
          <Plus className="mr-2 h-4 w-4" /> New broadcast
        </Button>
      </InlinePanelTrigger>
      <InlinePanelContent>
        <InlinePanelHeader>
          <InlinePanelTitle>Send broadcast</InlinePanelTitle>
          <InlinePanelDescription>
            Reaches every recipient&apos;s notifications inbox.
          </InlinePanelDescription>
        </InlinePanelHeader>
        <form onSubmit={onSubmit} className="min-w-0 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-field-0`} className="text-xs">
                Type
              </Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as (typeof TYPES)[number])}
              >
                <SelectTrigger id={`${formId}-field-0`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-field-1`} className="text-xs">
                Priority
              </Label>
              <Select
                value={priority}
                onValueChange={(v) => setPriority(v as (typeof PRIORITIES)[number])}
              >
                <SelectTrigger id={`${formId}-field-1`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-field-2`} className="text-xs">
              Title
            </Label>
            <Input
              id={`${formId}-field-2`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={120}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-field-3`} className="text-xs">
              Message
            </Label>
            <Textarea
              id={`${formId}-field-3`}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-field-4`} className="text-xs">
              Link (optional)
            </Label>
            <Input
              id={`${formId}-field-4`}
              type="url"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-field-5`} className="text-xs">
              Audience
            </Label>
            <Select value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
              <SelectTrigger id={`${formId}-field-5`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All active employees</SelectItem>
                <SelectItem value="departments">Specific departments</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {scope === "departments" && (
            <div className="grid grid-cols-1 gap-2 rounded-md border p-3 sm:grid-cols-2">
              {departments.map((d) => {
                const checked = selectedDepts.includes(d.id);
                return (
                  <label key={d.id} className="flex min-h-11 items-center gap-2 text-sm">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => {
                        setSelectedDepts((s) =>
                          v ? [...s, d.id] : s.filter((id) => id !== d.id),
                        );
                      }}
                    />
                    <span className="min-w-0 break-words">{d.name}</span>
                  </label>
                );
              })}
            </div>
          )}
          <InlinePanelFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                pending ||
                !title ||
                !message ||
                (scope === "departments" && selectedDepts.length === 0)
              }
            >
              {pending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Send
            </Button>
          </InlinePanelFooter>
        </form>
      </InlinePanelContent>
    </InlinePanel>
  );
}
