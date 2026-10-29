-- Additive fencing token. Apply before deploying attempt-aware hire workers.
-- Existing jobs keep NULL until claimed by the new worker.
ALTER TABLE "HirePacketImport"
  ADD COLUMN IF NOT EXISTS "processingToken" TEXT;
