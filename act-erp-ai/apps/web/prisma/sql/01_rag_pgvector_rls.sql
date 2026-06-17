-- =====================================================================
-- act-erp-ai: raw-SQL additions Prisma cannot express on vector columns.
-- Apply AFTER `prisma migrate dev` has created the RAG tables.
--   psql "$DIRECT_URL" -f prisma/sql/01_rag_pgvector_rls.sql
--
-- Table/column identifiers are quoted PascalCase/camelCase (Prisma defaults).
-- KnowledgeDocument.id is a cuid (text) → scope arrays are text[].
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- ── Full-text: generated tsvector column + GIN index on Chunk ──────────
ALTER TABLE "Chunk"
  ADD COLUMN IF NOT EXISTS tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS chunk_tsv_gin ON "Chunk" USING gin (tsv);

-- ── Vector (HNSW, cosine) indexes ─────────────────────────────────────
CREATE INDEX IF NOT EXISTS chunk_embedding_hnsw
  ON "Chunk" USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS recordrow_embedding_hnsw
  ON "RecordRow" USING hnsw ("rowEmbedding" vector_cosine_ops);

-- ── Read-mostly RLS role for the agent service ────────────────────────
-- The worker connects as the table OWNER (migration role) and bypasses RLS,
-- so ingestion can write any document. The agent connects as `act_rls` and is
-- bound by the policies below to current_setting('app.allowed_docs').
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'act_rls') THEN
    -- Change the password after creation: ALTER ROLE act_rls PASSWORD '...';
    CREATE ROLE act_rls LOGIN PASSWORD 'change-me-act-rls';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO act_rls;
GRANT SELECT ON
  "KnowledgeDocument", "Chunk", "DocImage",
  "RecordRow", "RecordTable", "StructureNode"
TO act_rls;

-- ── Enable RLS + scope policies (SELECT only) ─────────────────────────
-- ENABLE (not FORCE) so the owner/worker still bypasses for ingestion writes.
-- current_setting(..., true) is missing-ok → NULL → matches nothing (fail-closed).
ALTER TABLE "KnowledgeDocument" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kd_scope ON "KnowledgeDocument";
CREATE POLICY kd_scope ON "KnowledgeDocument" FOR SELECT TO act_rls
  USING ("id" = ANY (current_setting('app.allowed_docs', true)::text[]));

ALTER TABLE "Chunk" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chunk_scope ON "Chunk";
CREATE POLICY chunk_scope ON "Chunk" FOR SELECT TO act_rls
  USING ("documentId" = ANY (current_setting('app.allowed_docs', true)::text[]));

ALTER TABLE "StructureNode" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sn_scope ON "StructureNode";
CREATE POLICY sn_scope ON "StructureNode" FOR SELECT TO act_rls
  USING ("documentId" = ANY (current_setting('app.allowed_docs', true)::text[]));

ALTER TABLE "DocImage" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS di_scope ON "DocImage";
CREATE POLICY di_scope ON "DocImage" FOR SELECT TO act_rls
  USING ("documentId" = ANY (current_setting('app.allowed_docs', true)::text[]));

ALTER TABLE "RecordTable" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rt_scope ON "RecordTable";
CREATE POLICY rt_scope ON "RecordTable" FOR SELECT TO act_rls
  USING ("documentId" = ANY (current_setting('app.allowed_docs', true)::text[]));

ALTER TABLE "RecordRow" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rr_scope ON "RecordRow";
CREATE POLICY rr_scope ON "RecordRow" FOR SELECT TO act_rls
  USING ("documentId" = ANY (current_setting('app.allowed_docs', true)::text[]));
