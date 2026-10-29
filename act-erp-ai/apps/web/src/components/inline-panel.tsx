"use client";

import * as React from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { Slot } from "@radix-ui/react-slot";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PanelContext = {
  open: boolean;
  setOpen: (open: boolean) => void;
  trigger: React.MutableRefObject<HTMLButtonElement | null>;
};
const Context = React.createContext<PanelContext | null>(null);
function usePanel() {
  const panel = React.useContext(Context);
  if (!panel) throw new Error("Inline panel controls require an InlinePanel parent");
  return panel;
}

/** Task editor in normal document flow. No portal, overlay or focus trap. */
export function InlinePanel({
  open: controlledOpen, defaultOpen = false, onOpenChange, className, children,
  ...props
}: React.ComponentPropsWithoutRef<typeof Collapsible.Root>) {
  const [localOpen, setLocalOpen] = React.useState(defaultOpen);
  const open = controlledOpen ?? localOpen;
  const trigger = React.useRef<HTMLButtonElement | null>(null);
  const previousFocus = React.useRef<HTMLElement | null>(null);
  const wasOpen = React.useRef(open);
  const restoreFocus = React.useRef(false);
  const setOpen = React.useCallback((next: boolean) => {
    if (controlledOpen === undefined) setLocalOpen(next);
    onOpenChange?.(next);
  }, [controlledOpen, onOpenChange]);

  React.useLayoutEffect(() => {
    if (open && document.activeElement instanceof HTMLElement) {
      previousFocus.current = document.activeElement;
    }
  }, [open]);

  React.useEffect(() => {
    if (wasOpen.current && !open) restoreFocus.current = true;
    wasOpen.current = open;
    const destination = trigger.current ?? previousFocus.current;
    if (!open && restoreFocus.current && destination?.isConnected && !destination.matches(":disabled")) {
      restoreFocus.current = false;
      destination.focus();
    }
  });

  return (
    <Context.Provider value={{ open, setOpen, trigger }}>
      <Collapsible.Root
        open={open}
        onOpenChange={setOpen}
        className={cn("min-w-0 empty:hidden", open && "col-span-full w-full basis-full", className)}
        {...props}
      >{children}</Collapsible.Root>
    </Context.Provider>
  );
}

export const InlinePanelTrigger = React.forwardRef<
  HTMLButtonElement, React.ComponentPropsWithoutRef<typeof Collapsible.Trigger>
>(({ className, ...props }, ref) => {
  const { trigger } = usePanel();
  return <Collapsible.Trigger ref={(node) => {
    trigger.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  }} className={cn("min-h-11 md:min-h-9", className)} {...props} />;
});
InlinePanelTrigger.displayName = "InlinePanelTrigger";

export const InlinePanelContent = React.forwardRef<
  HTMLElement, React.ComponentPropsWithoutRef<"section">
>(({ className, children, ...props }, ref) => {
  const { open } = usePanel();
  const localRef = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (open) localRef.current?.focus();
  }, [open]);
  return (
    <Collapsible.Content asChild>
      <section tabIndex={-1} ref={(node) => {
        localRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }} className={cn("my-4 grid min-w-0 grid-cols-1 gap-4 rounded-lg border bg-card p-4 text-card-foreground sm:p-6 [&>*]:min-w-0", className)} {...props}>
        {children}
      </section>
    </Collapsible.Content>
  );
});
InlinePanelContent.displayName = "InlinePanelContent";

export function InlinePanelHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("min-w-0 space-y-1.5", className)} {...props} />;
}
export function InlinePanelTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return <h2 className={cn("break-words text-lg font-semibold", className)} {...props} />;
}
export function InlinePanelDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("break-words text-sm text-muted-foreground", className)} {...props} />;
}
export function InlinePanelFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end [&_button]:min-h-11 md:[&_button]:min-h-9", className)} {...props} />;
}

export const InlinePanelClose = React.forwardRef<
  HTMLButtonElement, React.ComponentProps<typeof Button>
>(({ asChild, onClick, ...props }, ref) => {
  const { setOpen } = usePanel();
  const Component = asChild ? Slot : Button;
  return <Component ref={ref} type="button" {...props} onClick={(event) => {
    onClick?.(event);
    if (!event.defaultPrevented) setOpen(false);
  }} />;
});
InlinePanelClose.displayName = "InlinePanelClose";

/** Confirms only through its caller; failed async actions must stay expanded. */
export const InlinePanelAction = Button;
export const InlinePanelCancel = React.forwardRef<HTMLButtonElement, React.ComponentProps<typeof Button>>(
  (props, ref) => <InlinePanelClose ref={ref} variant="outline" {...props} />,
);
InlinePanelCancel.displayName = "InlinePanelCancel";
