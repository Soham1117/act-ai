-- System-generated drafts have no human creator. Existing creator IDs remain.
ALTER TABLE "WatchProposal" ALTER COLUMN "createdById" DROP NOT NULL;
-- Application rollback is compatible with the nullable column; retain audit history.
