-- Additive L3 storage. Existing Watch findings and time entries are untouched.
DO $$ BEGIN
  CREATE TYPE "WatchProposalStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED', 'UNDONE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "WatchProposal" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "findingId" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "status" "WatchProposalStatus" NOT NULL DEFAULT 'PENDING',
  "before" JSONB NOT NULL,
  "after" JSONB,
  "proposedClockOut" TIMESTAMP(3) NOT NULL,
  "reason" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "createdById" UUID NOT NULL,
  "decidedById" UUID,
  "decidedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "WatchProposal_status_createdAt_idx" ON "WatchProposal"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "WatchProposal_entryId_idx" ON "WatchProposal"("entryId");

-- Rollback: ship the previous application; retain this additive table and its
-- audit history. Do not drop proposal records or undo time entries with SQL.
