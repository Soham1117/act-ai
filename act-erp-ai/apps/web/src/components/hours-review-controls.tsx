"use client";

import { useId } from "react";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  InlinePanelDescription,
  InlinePanelFooter,
  InlinePanelHeader,
  InlinePanelTitle,
} from "@/components/inline-panel";
import { hoursRowActionClass } from "@/components/hours-ui";

export function HoursReviewButtons({
  pending,
  onApprove,
  onReject,
  name,
  bulk = false,
  disabled = false,
}: {
  pending: boolean;
  onApprove: () => void;
  onReject: () => void;
  name?: string;
  bulk?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Button
        type="button"
        size="sm"
        variant="success"
        className={`${hoursRowActionClass} ${bulk ? "" : "md:w-9 md:p-0"}`}
        title={name ? `Approve entry for ${name}` : undefined}
        disabled={pending || disabled}
        onClick={onApprove}
        aria-label={name ? `Approve entry for ${name}` : undefined}
      >
        {pending ? (
          <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Check aria-hidden="true" className="h-3.5 w-3.5" />
        )}
        <span className={bulk ? undefined : "md:sr-only"}>
          {bulk ? "Approve selected" : "Approve"}
        </span>
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={`${hoursRowActionClass} text-destructive hover:text-destructive ${bulk ? "" : "md:w-9 md:p-0"}`}
        title={name ? `Reject entry for ${name}` : undefined}
        disabled={pending || disabled}
        onClick={onReject}
        aria-label={name ? `Reject entry for ${name}` : undefined}
      >
        <X aria-hidden="true" className="h-3.5 w-3.5" />
        <span className={bulk ? undefined : "md:sr-only"}>
          {bulk ? "Reject selected" : "Reject"}
        </span>
      </Button>
    </div>
  );
}

export function HoursSelectionToolbar({
  checked,
  onSelectAll,
  count,
  available,
  pending,
  onApprove,
  onReject,
  onClear,
}: {
  checked: boolean;
  onSelectAll: (checked: boolean) => void;
  count: number;
  available: number;
  pending: boolean;
  onApprove: () => void;
  onReject: () => void;
  onClear: () => void;
}) {
  if (!available) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 border-b bg-muted/30 p-3">
      <label className="flex min-h-11 items-center gap-2 text-xs text-muted-foreground md:min-h-9">
        <Checkbox
          checked={checked}
          onCheckedChange={(v) => onSelectAll(v === true)}
          aria-label="Select all pending entries"
        />
        Select all on this page
      </label>
      <span className="text-xs text-muted-foreground">{count} selected</span>
      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
        <HoursReviewButtons
          bulk
          pending={pending}
          disabled={!count}
          onApprove={onApprove}
          onReject={onReject}
        />
        {count > 0 && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={hoursRowActionClass}
            disabled={pending}
            onClick={onClear}
          >
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

export function HoursRejectEditor({
  title,
  description,
  reason,
  onChange,
  pending,
  onCancel,
  onConfirm,
  minimumLength = 1,
  reasonLabel = "Reason for rejection",
}: {
  title: string;
  description: string;
  reason: string;
  onChange: (value: string) => void;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  minimumLength?: number;
  reasonLabel?: string;
}) {
  const id = useId();
  return (
    <>
      <InlinePanelHeader>
        <InlinePanelTitle>{title}</InlinePanelTitle>
        <InlinePanelDescription>{description}</InlinePanelDescription>
      </InlinePanelHeader>
      <div className="space-y-1.5">
        <Label htmlFor={id} className="text-xs">
          {reasonLabel}
        </Label>
        <Textarea
          id={id}
          rows={3}
          value={reason}
          maxLength={1000}
          onChange={(e) => onChange(e.target.value)}
          disabled={pending}
        />
      </div>
      <InlinePanelFooter>
        <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={pending || reason.trim().length < minimumLength}
          onClick={onConfirm}
        >
          {pending && (
            <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />
          )}
          Reject
        </Button>
      </InlinePanelFooter>
    </>
  );
}
