import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";

/**
 * Compute the set of knowledge-document IDs a user may read. This is the single
 * authoritative scope used both for listing (the document picker) and for the
 * agent gateway (passed to apps/ai, which re-enforces it via SQL WHERE + RLS).
 *
 * Rules (ARCHITECTURE.md §6):
 *  - ADMIN sees everything (matches the existing ERP admin rule).
 *  - visibility = ORG is visible to everyone.
 *  - owner_user_id = self (employee self-uploads).
 *  - an explicit DocumentGrant for the user.
 */
export async function allowedDocumentIds(user: SessionUser): Promise<string[]> {
  if (user.role === "ADMIN") {
    const all = await db.knowledgeDocument.findMany({ select: { id: true } });
    return all.map((d) => d.id);
  }
  const docs = await db.knowledgeDocument.findMany({
    where: {
      OR: [
        { visibility: "ORG" },
        { ownerUserId: user.id },
        { grants: { some: { userId: user.id } } },
      ],
    },
    select: { id: true },
  });
  return docs.map((d) => d.id);
}

/** Documents the picker should show, with status, scoped to the user. */
export async function listAccessibleDocuments(user: SessionUser) {
  const ids = await allowedDocumentIds(user);
  if (ids.length === 0) return [];
  return db.knowledgeDocument.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      title: true,
      fileKind: true,
      status: true,
      visibility: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}
