"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { uploadDocument } from "@/server/actions/documents";
import { runAction } from "@/lib/toast-action";
import { usePortalLanguage } from "@/components/portal-language";

const TYPES = ["PERSONAL", "COMPANY", "ONBOARDING", "BENEFITS", "TRAINING"] as const;
type DocType = (typeof TYPES)[number];

/**
 * Single-document upload. If `employeeId` is omitted the document attaches to
 * the current user's employee record (used by the employee dashboard). Admins
 * pass `employeeId` to upload on behalf of someone.
 *
 * `allowedTypes` lets callers narrow the category list — e.g. employees
 * shouldn't be uploading COMPANY docs.
 */
export function UploadDocumentForm({
  employeeId,
  trigger,
  allowedTypes = TYPES,
  defaultType,
}: {
  employeeId?: string;
  trigger?: React.ReactNode;
  allowedTypes?: readonly DocType[];
  defaultType?: DocType;
}) {
  const { t, enumLabel, toastAction } = usePortalLanguage();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [docType, setDocType] = useState<DocType>(defaultType ?? allowedTypes[0]);
  const formId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  useEffect(() => {
    if (!open && !pending && restoreFocus.current) {
      restoreFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [open, pending]);

  function reset() {
    setFile(null);
    setTitle("");
    setDescription("");
    setDocType(defaultType ?? allowedTypes[0]);
  }

  function closeForm() {
    restoreFocus.current = true;
    setOpen(false);
    reset();
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      restoreFocus.current = true;
      if (!pending) reset();
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      toast.error(t("documentControls.upload.pickFile"));
      return;
    }
    if (title.trim().length < 2) {
      toast.error(t("documentControls.upload.titleRequired"));
      return;
    }
    startTransition(async () => {
      const bytes = await file.arrayBuffer();
      const res = await runAction(() => uploadDocument(
        {
          title: title.trim(),
          description: description.trim() || undefined,
          documentType: docType,
          employeeId,
        },
        { name: file.name, type: file.type || "application/octet-stream", bytes },
      ));
      if (!toastAction(res)) return;
      toast.success(t("documentControls.upload.success"));
      closeForm();
    });
  }

  return (
    <Collapsible className="min-w-0 space-y-3" open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild disabled={pending}>
        {trigger ?? (
          <Button ref={triggerRef} size="sm" className="min-h-11 md:min-h-9">
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            {t("documentControls.upload.action")}
          </Button>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent asChild>
        <section
          aria-labelledby={`${formId}-heading`}
          className="min-w-0 space-y-3 rounded-lg border bg-card p-4 sm:max-w-md"
        >
          <div className="space-y-1">
            <h2 id={`${formId}-heading`} className="text-base font-semibold">
              {t("documentControls.upload.title")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("documentControls.upload.description")}
            </p>
          </div>
          <form onSubmit={onSubmit} className="space-y-3">
            <div>
              <Label htmlFor={`${formId}-file`}>{t("documentControls.upload.file")}</Label>
              <Input
                id={`${formId}-file`}
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div>
              <Label htmlFor={`${formId}-title`}>{t("documentControls.upload.documentTitle")}</Label>
              <Input
                id={`${formId}-title`}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("documentControls.upload.titlePlaceholder")}
              />
            </div>
            <div>
              <Label htmlFor={`${formId}-type`}>{t("documentControls.upload.category")}</Label>
              <Select value={docType} onValueChange={(v) => setDocType(v as DocType)}>
                <SelectTrigger id={`${formId}-type`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allowedTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {enumLabel(type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor={`${formId}-desc`}>{t("documentControls.upload.descriptionOptional")}</Label>
              <Input
                id={`${formId}-desc`}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end [&_button]:min-h-11">
              <Button type="button" variant="outline" disabled={pending} onClick={closeForm}>
                {t("documentControls.cancel")}
              </Button>
              <Button type="submit" disabled={pending || !file}>
                {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                {t("documentControls.upload.action")}
              </Button>
            </div>
          </form>
        </section>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** @deprecated Use `UploadDocumentForm` from `@/components/upload-document-form`. */
export const UploadDocumentDialog = UploadDocumentForm;
