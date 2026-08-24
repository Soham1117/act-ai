"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { toastAction } from "@/lib/toast-action";
import { uploadKnowledgeDocument } from "@/server/actions/knowledge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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

const ACCEPT = ".pdf,.docx,.csv,.xlsx";

export function KnowledgeUploadDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [visibility, setVisibility] = useState<"PRIVATE" | "ORG">("ORG");
  const [file, setFile] = useState<File | null>(null);

  async function submit() {
    if (!file || !title.trim()) return;
    setBusy(true);
    try {
      const bytes = await file.arrayBuffer();
      const res = await uploadKnowledgeDocument(
        { title: title.trim(), visibility, grantUserIds: [] },
        { name: file.name, type: file.type, bytes },
      );
      if (!toastAction(res)) return;
      toast.success("Uploaded — ingestion queued");
      setOpen(false);
      setTitle("");
      setFile(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Upload className="mr-2 h-4 w-4" /> Upload document
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload knowledge document</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="kd-title">Title</Label>
            <Input id="kd-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Lathe BOM rev C" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kd-file">File (PDF, DOCX, CSV, XLSX)</Label>
            <Input id="kd-file" type="file" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="space-y-1.5">
            <Label>Visibility</Label>
            <Select value={visibility} onValueChange={(v) => setVisibility(v as "PRIVATE" | "ORG")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ORG">Everyone (organization-wide)</SelectItem>
                <SelectItem value="PRIVATE">Private (admins only for now)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Per-user / department grants for private docs are coming next.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={busy || !file || !title.trim()}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
