-- Additive: age-banded medical employee costs (BenefitPlanAgeRate).
CREATE TABLE IF NOT EXISTS "BenefitPlanAgeRate" (
  "id" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "ageFrom" INTEGER NOT NULL,
  "ageTo" INTEGER NOT NULL,
  "monthlyEmployeeCost" DECIMAL(10,2) NOT NULL,
  "perPay26EmployeeCost" DECIMAL(10,2) NOT NULL,
  CONSTRAINT "BenefitPlanAgeRate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BenefitPlanAgeRate_planId_ageFrom_ageTo_key"
  ON "BenefitPlanAgeRate"("planId", "ageFrom", "ageTo");

CREATE INDEX IF NOT EXISTS "BenefitPlanAgeRate_planId_idx"
  ON "BenefitPlanAgeRate"("planId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BenefitPlanAgeRate_planId_fkey'
  ) THEN
    ALTER TABLE "BenefitPlanAgeRate"
      ADD CONSTRAINT "BenefitPlanAgeRate_planId_fkey"
      FOREIGN KEY ("planId") REFERENCES "BenefitPlan"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
