-- Pay period close: who closed it and when (additive, idempotent).
ALTER TABLE "PayrollCalendar"
  ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "closedById" UUID;
