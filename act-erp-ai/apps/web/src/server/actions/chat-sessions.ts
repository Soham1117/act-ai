"use server";

import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import type { Prisma } from "@prisma/client";

/** Persisted Assistant conversations. Sessions are strictly per-user — every
 *  action checks ownership; titles derive from the first message. */

const TITLE_MAX = 60;

function titleFrom(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1)}…` : t || "New chat";
}

/** Append one completed turn (user + assistant message) to a session, creating
 *  the session on first save. Returns the session id for subsequent turns. */
export async function saveChatTurn(input: {
  sessionId: string | null;
  userText: string;
  assistantText: string;
  citations: Record<string, unknown>;
}) {
  const user = await requireUser();

  let sessionId = input.sessionId;
  if (sessionId) {
    const owned = await db.chatSession.findFirst({
      where: { id: sessionId, userId: user.id },
      select: { id: true },
    });
    if (!owned) sessionId = null; // stale/foreign id → start a fresh session
  }
  if (!sessionId) {
    const created = await db.chatSession.create({
      data: { userId: user.id, title: titleFrom(input.userText) },
      select: { id: true },
    });
    sessionId = created.id;
  }

  await db.$transaction([
    db.chatMessage.create({
      data: { sessionId, role: "user", content: input.userText },
    }),
    db.chatMessage.create({
      data: {
        sessionId,
        role: "assistant",
        content: input.assistantText,
        citations: input.citations as Prisma.InputJsonValue,
      },
    }),
    db.chatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } }),
  ]);

  return { sessionId };
}

/** The current user's sessions, newest first (for the sidebar list). */
export async function listChatSessions() {
  const user = await requireUser();
  return db.chatSession.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, updatedAt: true },
    take: 30,
  });
}

/** All messages of one owned session, oldest first. */
export async function getChatSessionMessages(sessionId: string) {
  const user = await requireUser();
  const session = await db.chatSession.findFirst({
    where: { id: sessionId, userId: user.id },
    select: {
      id: true,
      messages: {
        orderBy: { createdAt: "asc" },
        select: { role: true, content: true, citations: true },
      },
    },
  });
  return session;
}
