-- Expand only. No employee values are changed by this schema step.
-- Deploy encrypted readers/writers and run encrypt-employee-private-data.ts next.
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "privateDetails" JSONB;

-- Stop old scripts from putting readable PII beside an encrypted payload.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Employee_private_details_no_plaintext'
      AND conrelid = '"Employee"'::regclass
  ) THEN
    ALTER TABLE "Employee" ADD CONSTRAINT "Employee_private_details_no_plaintext"
      CHECK ("privateDetails" IS NULL OR (
        "ssnLast4" IS NULL AND "dateOfBirth" IS NULL AND "personalEmail" IS NULL
        AND "phoneNumber" IS NULL AND "address" IS NULL AND "city" IS NULL
        AND "state" IS NULL AND "zipCode" IS NULL AND "emergencyName" IS NULL
        AND "emergencyPhone" IS NULL
      ));
  END IF;
END $$;
