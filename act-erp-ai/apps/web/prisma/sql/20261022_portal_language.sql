-- Additive preference; existing app versions remain compatible.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "preferredLanguage" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "translationKey" TEXT;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "translationParams" JSONB;
