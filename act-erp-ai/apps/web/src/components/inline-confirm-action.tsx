"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

/** Keeps destructive confirmation in the document flow beside its action. */
export function InlineConfirmAction({
  label,
  message,
  cancelLabel,
  onConfirm,
  children,
  variant = "ghost",
  className,
}: {
  label: string;
  message: string;
  cancelLabel: string;
  onConfirm: () => Promise<boolean>;
  children: React.ReactNode;
  variant?: React.ComponentProps<typeof Button>["variant"];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  useEffect(() => {
    if (open) cancel.current?.focus();
    else if (!pending && restoreFocus.current) {
      restoreFocus.current = false;
      trigger.current?.focus();
    }
  }, [open, pending]);

  function close() {
    restoreFocus.current = true;
    setOpen(false);
  }

  return (
    <div
      className={
        open
          ? "col-span-full w-full min-w-0 basis-full whitespace-normal"
          : "min-w-0 whitespace-normal"
      }
    >
      <Button
        ref={trigger}
        type="button"
        variant={variant}
        className={className ?? "min-h-11 md:min-h-9"}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={pending}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {children}
      </Button>
      {open && (
        <section
          id={id}
          aria-label={label}
          aria-busy={pending}
          className="mt-2 space-y-3 rounded-md border p-3 text-left"
        >
          <p className="break-words text-sm">{message}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              ref={cancel}
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={pending}
              onClick={close}
            >
              {cancelLabel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="min-h-11"
              disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  if (await onConfirm()) close();
                });
              }}
            >
              {label}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
