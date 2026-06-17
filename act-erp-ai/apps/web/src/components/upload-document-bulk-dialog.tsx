"use client";

import { useMemo, useState, useTransition } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { uploadDocumentBulk } from "@/server/actions/documents";

const TYPES = ["PERSONAL", "COMPANY", "ONBOARDING", "BENEFITS", "TRAINING"] as const;
type DocType = (typeof TYPES)[number];

export function UploadDocumentBulkDialog({
  employees,
}: {
  employees: { id: string; name: string; email: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [docType, setDocType] = useState<DocType>("COMPANY");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return employees;
    return employees.filter(
      (e) =>
        e.name.toLowerCase().includes(s) || e.email.toLowerCase().includes(s),
    );
  }, [employees, search]);

  function reset() {
    setFile(null);
    setTitle("");
    setDescription("");
    setDocType("COMPANY");
    setSelected(new Set());
    setSearch("");
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const e of filtered) next.add(e.id);
      return next;
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return toast.error("Pick a file first");
    if (title.trim().length < 2) return toast.error("Title is required");
    if (selected.size === 0) return toast.error("Select at least one employee");

    startTransition(async () => {
      try {
        const bytes = await file.arrayBuffer();
        await uploadDocumentBulk(
          {
            title: title.trim(),
            description: description.trim() || undefined,
            documentType: docType,
            employeeIds: Array.from(selected),
          },
          { name: file.name, type: file.type || "application/octet-stream", bytes },
        );
        toast.success(`Uploaded to ${selected.size} employee${selected.size === 1 ? "" : "s"}`);
        setOpen(false);
        reset();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed");
      }
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
        <Button size="sm">
          <Upload className="mr-1.5 h-3.5 w-3.5" />
          Upload to employees
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload to employees</DialogTitle>
          <DialogDescription>
            One file, attached to every selected employee.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <Label htmlFor="bulk-file">File</Label>
            <Input
              id="bulk-file"
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="bulk-title">Title</Label>
              <Input
                id="bulk-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="bulk-type">Category</Label>
              <Select value={docType} onValueChange={(v) => setDocType(v as DocType)}>
                <SelectTrigger id="bulk-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="bulk-desc">Description (optional)</Label>
            <Input
              id="bulk-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <Label>Recipients ({selected.size} selected)</Label>
              <button
                type="button"
                onClick={selectAllVisible}
                className="text-[11px] text-primary hover:underline"
              >
                Select all visible
              </button>
            </div>
            <Input
              placeholder="Search employees…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mb-2"
            />
            <div className="max-h-56 overflow-y-auto rounded-md border">
              {filtered.length === 0 ? (
                <p className="grid h-20 place-items-center text-xs text-muted-foreground">
                  No matches.
                </p>
              ) : (
                <ul className="divide-y">
                  {filtered.map((e) => (
                    <li key={e.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <Checkbox
                        id={`emp-${e.id}`}
                        checked={selected.has(e.id)}
                        onCheckedChange={() => toggle(e.id)}
                      />
                      <label
                        htmlFor={`emp-${e.id}`}
                        className="flex-1 cursor-pointer truncate"
                      >
                        <span className="font-medium">{e.name}</span>
                        <span className="ml-2 text-[11px] text-muted-foreground">{e.email}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !file || selected.size === 0}>
              {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Upload to {selected.size || ""}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
