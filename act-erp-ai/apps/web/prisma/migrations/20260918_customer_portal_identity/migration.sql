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
