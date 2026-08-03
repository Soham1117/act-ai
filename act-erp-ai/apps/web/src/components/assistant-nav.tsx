"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronRight, MessageSquareText, Sparkles } from "lucide-react";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { listChatSessions } from "@/server/actions/chat-sessions";
import { CHAT_SAVED_EVENT } from "@/hooks/use-agent-chat";

interface SessionRow {
  id: string;
  title: string;
}

/**
 * The "Assistant" sidebar entry: the label opens a fresh chat; the chevron
 * expands the user's previous conversations (persisted ChatSessions). Titles
 * are truncated to the rail width; the full title lives in the tooltip.
 */
export function AssistantNav({ basePath }: { basePath: string }) {
  return (
    <Suspense fallback={<AssistantNavInner basePath={basePath} activeSession={null} />}>
      <AssistantNavWithParams basePath={basePath} />
    </Suspense>
  );
}

function AssistantNavWithParams({ basePath }: { basePath: string }) {
  const params = useSearchParams();
  return <AssistantNavInner basePath={basePath} activeSession={params.get("session")} />;
}

function AssistantNavInner({
  basePath,
  activeSession,
}: {
  basePath: string;
  activeSession: string | null;
}) {
  const pathname = usePathname();
  const onChat = pathname.startsWith(basePath);
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [open, setOpen] = useState(onChat);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      listChatSessions()
        .then((rows) => !cancelled && setSessions(rows))
        .catch(() => !cancelled && setSessions([]));
    load();
    window.addEventListener(CHAT_SAVED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(CHAT_SAVED_EVENT, load);
    };
  }, []);

  return (
    <Collapsible asChild open={open} onOpenChange={setOpen}>
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={onChat && !activeSession} tooltip="Assistant">
          <Link href={basePath}>
            <Sparkles className="h-4 w-4" />
            <span>Assistant</span>
          </Link>
        </SidebarMenuButton>
        <CollapsibleTrigger asChild>
          <SidebarMenuAction
            className="data-[state=open]:rotate-90 transition-transform"
            aria-label="Previous chats"
          >
            <ChevronRight className="h-4 w-4" />
          </SidebarMenuAction>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub className="mr-0 pr-1">
            {sessions === null && (
              <SidebarMenuSubItem>
                <span className="block px-2 py-1 text-xs text-sidebar-foreground/50">Loading…</span>
              </SidebarMenuSubItem>
            )}
            {sessions?.length === 0 && (
              <SidebarMenuSubItem>
                <span className="block px-2 py-1 text-xs text-sidebar-foreground/50">
                  No previous chats
                </span>
              </SidebarMenuSubItem>
            )}
            {sessions?.map((s) => (
              <SidebarMenuSubItem key={s.id}>
                <SidebarMenuSubButton asChild isActive={activeSession === s.id} title={s.title}>
                  <Link href={`${basePath}?session=${s.id}`}>
                    <MessageSquareText className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}
