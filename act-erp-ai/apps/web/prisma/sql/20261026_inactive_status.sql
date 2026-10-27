-- Additive and safe to run again. Apply before deploying the new app.
-- Existing employee/worker records and dates are not changed.
ALTER TYPE "EmploymentStatus" ADD VALUE IF NOT EXISTS 'INACTIVE';
ALTER TYPE "ContractWorkerStatus" ADD VALUE IF NOT EXISTS 'INACTIVE';

-- App rollback: reactivate INACTIVE people before running an older app that
-- does not understand this status. Leave the unused enum values in place;
-- removing enum values would require a destructive type rebuild.
