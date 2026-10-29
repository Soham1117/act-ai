-- Additive: remembered paystub name spellings (PaystubNameAlias).
CREATE TABLE IF NOT EXISTS "PaystubNameAlias" (
  "id" TEXT NOT NULL,
  "aliasKey" TEXT NOT NULL,
  "aliasName" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaystubNameAlias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PaystubNameAlias_aliasKey_employeeId_key"
  ON "PaystubNameAlias"("aliasKey", "employeeId");

CREATE INDEX IF NOT EXISTS "PaystubNameAlias_employeeId_idx"
  ON "PaystubNameAlias"("employeeId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PaystubNameAlias_employeeId_fkey'
  ) THEN
    ALTER TABLE "PaystubNameAlias"
      ADD CONSTRAINT "PaystubNameAlias_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "Employee"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
