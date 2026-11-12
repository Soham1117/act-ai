-- Automatic 30-minute unpaid lunch (src/lib/lunch.ts). Additive; existing hours unchanged.
ALTER TABLE "TimeEntry" ADD COLUMN IF NOT EXISTS "lunchMin" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ContractTimeEntry" ADD COLUMN IF NOT EXISTS "lunchMin" INTEGER NOT NULL DEFAULT 0;
-- Application rollback is compatible with the new columns.
