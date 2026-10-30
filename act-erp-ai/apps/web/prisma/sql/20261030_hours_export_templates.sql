-- Hours period export templates + schedules (TCP Period Export replacement)

DO $$ BEGIN
  CREATE TYPE "ExportSplitBy" AS ENUM ('NONE', 'JOB_CODE', 'RATE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ExportSortOrder" AS ENUM ('EMPLOYEE_ID', 'NAME', 'EXPORT_CODE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "HoursExportTemplate" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "columns" TEXT[] NOT NULL,
  "splitBy" "ExportSplitBy" NOT NULL DEFAULT 'NONE',
  "includeHeader" BOOLEAN NOT NULL DEFAULT TRUE,
  "includeSalaried" BOOLEAN NOT NULL DEFAULT TRUE,
  "approvedOnly" BOOLEAN NOT NULL DEFAULT TRUE,
  "sortOrder" "ExportSortOrder" NOT NULL DEFAULT 'NAME',
  "isDefault" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "HoursExportTemplate_isDefault_idx"
  ON "HoursExportTemplate" ("isDefault");

CREATE TABLE IF NOT EXISTS "HoursExportSchedule" (
  "id" TEXT PRIMARY KEY,
  "templateId" TEXT NOT NULL REFERENCES "HoursExportTemplate"("id") ON DELETE CASCADE,
  "description" TEXT NOT NULL,
  "weekday" INTEGER NOT NULL,
  "minuteOfDay" INTEGER NOT NULL DEFAULT 360,
  "rangeDays" INTEGER NOT NULL DEFAULT 7,
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "lastRunAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "HoursExportSchedule_enabled_weekday_idx"
  ON "HoursExportSchedule" ("enabled", "weekday");
