"use client";

import { useId, useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";
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
import { createKiosk } from "@/server/actions/kiosk";
import { runAction, toastAction } from "@/lib/toast-action";

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export function CreateKioskPanel() {
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState("");
  const [slug, setSlug] = useState("");
  const [slugDirty, setSlugDirty] = useState(false);

  // Slug auto-tracks the label until the user edits it manually.
  const effectiveSlug = slugDirty ? slug : slugify(label);

  function reset() {
    setLabel("");
    setSlug("");
    setSlugDirty(false);
  }

  return (
    <InlinePanel disabled={pending}
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <InlinePanelTrigger asChild disabled={pending}>
        <Button>
          <Plus className="mr-2 h-4 w-4" /> New kiosk
        </Button>
      </InlinePanelTrigger>
      <InlinePanelContent>
        <InlinePanelHeader>
          <InlinePanelTitle>New kiosk</InlinePanelTitle>
          <InlinePanelDescription>
            The slug becomes the URL. Send <span className="font-mono">/kiosk/&lt;slug&gt;</span>{" "}
            to the terminal, then activate it from there.
          </InlinePanelDescription>
        </InlinePanelHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const cleaned = slugify(effectiveSlug);
            if (!cleaned) {
              toast.error("Slug is required.");
              return;
            }
            startTransition(async () => {
              const res = await runAction(() => createKiosk({ slug: cleaned, label: label.trim() }));
              if (!toastAction(res)) return;
              toast.success("Kiosk created");
              setOpen(false);
              reset();
            });
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-1`} className="text-xs">Label</Label>
            <Input id={`${fieldId}-1`}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Fort Worth — Plant Floor"
              maxLength={80}
              autoFocus
              required
            />
            <p className="text-[10px] text-muted-foreground">
              Shown in the kiosk header so admins can recognise the terminal.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-2`} className="text-xs">URL slug</Label>
            <div className="flex items-center rounded-md border bg-muted/30 pl-2 font-mono text-sm">
              <span className="text-muted-foreground">/kiosk/</span>
              <Input id={`${fieldId}-2`}
                value={effectiveSlug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  setSlugDirty(true);
                }}
                onBlur={() => setSlug((s) => slugify(s))}
                className="h-9 border-0 bg-transparent pl-1 font-mono shadow-none focus-visible:ring-0"
                placeholder="fort-worth"
                maxLength={40}
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              Lowercase letters, numbers, hyphens. Must be unique.
            </p>
          </div>
          <InlinePanelFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !effectiveSlug || !label}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create kiosk
            </Button>
          </InlinePanelFooter>
        </form>
      </InlinePanelContent>
    </InlinePanel>
  );
}
