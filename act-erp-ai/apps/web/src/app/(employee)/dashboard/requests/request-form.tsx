"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import Link from "next/link";
import { submitRequest } from "@/server/actions/requests";
import { runAction } from "@/lib/toast-action";
import { usePortalLanguage } from "@/components/portal-language";

const TYPES = [
  "DOCUMENT_REQUEST",
  "DETAILS_CHANGE",
  "PAYROLL_INQUIRY",
  "SCHEDULE_CHANGE",
  "ACCESS_REQUEST",
  "TRAINING_REQUEST",
  "EQUIPMENT_REQUEST",
  "LOCATION_CHANGE",
  "TEAM_REQUEST",
  "PROJECT_REQUEST",
  "LEAVE_REQUEST",
  "BENEFITS_INQUIRY",
  "OTHER",
] as const;

export function RequestForm({
  initialType,
}: {
  /** Pre-selects the type and expands the form on mount — used by the
   * "Something look wrong?" link from the Benefits page. */
  initialType?: (typeof TYPES)[number];
}) {
  const { t, enumLabel, toastAction } = usePortalLanguage();
  // Both initialized straight from the prop — it's only ever set once, from
  // the searchParams-derived value the server passed in on this page load,
  // so there's no need for an effect to sync it after mount.
  const [open, setOpen] = useState(!!initialType);
  const [pending, startTransition] = useTransition();
  const formId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  useEffect(() => {
    if (!open && !pending && restoreFocus.current) {
      restoreFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [open, pending]);

  function closeForm() {
    restoreFocus.current = true;
    setOpen(false);
  }
  const [type, setType] = useState<(typeof TYPES)[number]>(
    initialType ?? "DOCUMENT_REQUEST",
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await runAction(() => submitRequest({ type, title, description }));
      if (!toastAction(res)) return;
      toast.success(t("workspace.requests.submittedToast"));
      closeForm();
      setTitle("");
      setDescription("");
    });
  }

  return (
    <Collapsible className="mb-6 min-w-0 space-y-3" open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild disabled={pending}>
        <Button ref={triggerRef} className="min-h-11 w-full sm:w-auto md:min-h-9">
          <Plus className="mr-2 h-4 w-4" /> {t("workspace.requests.new")}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent asChild>
        <section
          aria-labelledby={`${formId}-heading`}
          className="min-w-0 space-y-4 rounded-lg border bg-card p-4 sm:p-6"
        >
          <div className="space-y-1.5">
            <h2 id={`${formId}-heading`} className="text-lg font-semibold">
              {t("workspace.requests.new")}
            </h2>
          </div>
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-type`} className="text-xs">
                {t("workspace.requests.type")}
              </Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as (typeof TYPES)[number])}
              >
                <SelectTrigger
                  id={`${formId}-type`}
                  aria-label={t("workspace.requests.type")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((requestType) => (
                    <SelectItem key={requestType} value={requestType}>
                      {requestType === "OTHER"
                        ? t("workspace.other")
                        : enumLabel(requestType)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {type === "LEAVE_REQUEST" && (
              <p className="rounded-md border bg-muted/50 p-3 text-xs">
                {t("workspace.requests.leaveHelpBefore")}{" "}
                <Link href="/dashboard/leave" className="font-medium underline">
                  {t("workspace.requests.leavePage")}
                </Link>
                {t("workspace.requests.leaveHelpAfter")}
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-subject`} className="text-xs">
                {t("workspace.requests.subject")}
              </Label>
              <Input
                id={`${formId}-subject`}
                aria-label={t("workspace.requests.subject")}
                placeholder={t("workspace.requests.subjectPlaceholder")}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-details`} className="text-xs">
                {t("workspace.requests.details")}
              </Label>
              <Textarea
                id={`${formId}-details`}
                aria-label={t("workspace.requests.details")}
                placeholder={t("workspace.requests.detailsPlaceholder")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                required
              />
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end [&_button]:min-h-11">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={closeForm}
              >
                {t("workspace.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={
                  pending ||
                  type === "LEAVE_REQUEST" ||
                  title.length < 2 ||
                  description.length < 2
                }
              >
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t("workspace.submit")}
              </Button>
            </div>
          </form>
        </section>
      </CollapsibleContent>
    </Collapsible>
  );
}
