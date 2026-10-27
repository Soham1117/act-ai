"use client";

import { useState, useTransition } from "react";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
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
export function UploadDocumentDialog({
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

  function reset() {
    setFile(null);
    setTitle("");
    setDescription("");
    setDocType(defaultType ?? allowedTypes[0]);
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
      setOpen(false);
      reset();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            {t("documentControls.upload.action")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("documentControls.upload.title")}</DialogTitle>
          <DialogDescription>
            {t("documentControls.upload.description")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <Label htmlFor="upload-file">{t("documentControls.upload.file")}</Label>
            <Input
              id="upload-file"
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div>
            <Label htmlFor="upload-title">{t("documentControls.upload.documentTitle")}</Label>
            <Input
              id="upload-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("documentControls.upload.titlePlaceholder")}
            />
          </div>
          <div>
            <Label htmlFor="upload-type">{t("documentControls.upload.category")}</Label>
            <Select value={docType} onValueChange={(v) => setDocType(v as DocType)}>
              <SelectTrigger id="upload-type">
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
            <Label htmlFor="upload-desc">{t("documentControls.upload.descriptionOptional")}</Label>
            <Input
              id="upload-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("documentControls.cancel")}
            </Button>
            <Button type="submit" disabled={pending || !file}>
              {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {t("documentControls.upload.action")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
