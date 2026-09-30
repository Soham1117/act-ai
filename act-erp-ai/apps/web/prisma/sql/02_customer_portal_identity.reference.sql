-- REFERENCE ONLY -- do not run by hand on a database managed with `prisma db push`.
--
-- This used to live in prisma/migrations/. This project deploys with
-- `prisma db push` (there is no migration history: no migration creates the
-- LoginChallenge table, so `prisma migrate deploy` would fail on the ALTER
-- below). The same objects are declared in prisma/schema.prisma
-- (LoginChallenge.identityNonce / identityMfaRequired, IdentityServiceRequestNonce,
-- UsedIdentityAssertion), so `db push` creates them. Kept here only as a
-- record of the exact DDL the customer-portal identity adapter expects.

-- Private customer-portal identity adapter.
-- Existing login challenges remain authoritative; the nullable fields scope
-- the new binding to adapter-created challenges only.
ALTER TABLE "LoginChallenge"
  ADD COLUMN "identityNonce" TEXT,
  ADD COLUMN "identityMfaRequired" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX "LoginChallenge_identityNonce_key"
  ON "LoginChallenge"("identityNonce");

CREATE TABLE "IdentityServiceRequestNonce" (
  "id" TEXT NOT NULL,
  "nonceHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IdentityServiceRequestNonce_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IdentityServiceRequestNonce_nonceHash_key"
  ON "IdentityServiceRequestNonce"("nonceHash");

CREATE INDEX "IdentityServiceRequestNonce_expiresAt_idx"
  ON "IdentityServiceRequestNonce"("expiresAt");

CREATE TABLE "UsedIdentityAssertion" (
  "id" TEXT NOT NULL,
  "jtiHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsedIdentityAssertion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UsedIdentityAssertion_jtiHash_key"
  ON "UsedIdentityAssertion"("jtiHash");

CREATE INDEX "UsedIdentityAssertion_expiresAt_idx"
  ON "UsedIdentityAssertion"("expiresAt");
