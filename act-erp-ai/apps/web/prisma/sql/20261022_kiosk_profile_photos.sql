-- Additive and retry-safe. Old app images keep working; rollback leaves these nullable fields in place.
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "kioskProfilePhotoKey" TEXT;
ALTER TABLE "ContractWorker" ADD COLUMN IF NOT EXISTS "kioskProfilePhotoKey" TEXT;
