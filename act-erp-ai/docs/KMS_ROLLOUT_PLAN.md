# KMS rollout plan

## What this rollout covers

The first release protects onboarding data stored as JSON in Postgres and can optionally use the same customer-managed KMS key for new S3 uploads. It does not encrypt every employee record or every historical S3 object. Phase 2 covers selected employee fields, hire-import proposals, and freeform employee notes after the first slice has a stable migration and restore process.

The web app currently uses the AWS SDK default credential chain. `AWS_REGION` already configures AWS clients. Do not point KMS at the LocalStack/MinIO endpoint: `AWS_ENDPOINT_URL` is for the existing S3/SQS local setup and must not be used for this KMS integration. Local development should use a separate test key/account configuration or an explicit development adapter; production encryption must fail closed if the key is missing or unusable.

## Phase 1: onboarding JSON

Use the AWS Encryption SDK (`@aws-crypto/client-node`) with a versioned JSON envelope format. Encrypt each packet section or draft as one payload rather than calling KMS for each form input. Bind it with authenticated context: `app=act-persona`, `purpose=onboarding-draft` or `onboarding-packet`, `recordId=<opaque invite ID>`, and `field=<JSON column name>`. Packet bindings use `inviteId`, not the submission ID. Context contains no names, emails, account numbers, or other PII; it is visible in message headers and CloudTrail. [AWS KMS encryption context](https://docs.aws.amazon.com/kms/latest/developerguide/encrypt_context.html)

Protect these fields:

- `OnboardingInvite.draftJson`
- All five `OnboardingPacketSubmission` JSON fields: `application`, `drugAlcohol`, `background`, `directDeposit`, and `handbook`

The new-write path always encrypts and fails closed when `SENSITIVE_DATA_KMS_KEY_ARN` is unset, permission is denied, or encryption fails. Never silently write plaintext as a fallback. Keep a short-lived dual-read path for the existing plaintext rows during backfill. New ciphertext must be distinguishable from legacy JSON by an explicit format/version marker; malformed or unknown versions must fail closed.

Configuration:

- `SENSITIVE_DATA_KMS_KEY_ARN`: required in production for sensitive JSON writes and decrypts.
- `SENSITIVE_DATA_KMS_PREVIOUS_KEY_ARNS`: optional comma-separated allowlist of prior key ARNs during key replacement/rotation. Accept only configured keys; do not let an envelope-selected arbitrary ARN trigger KMS access.
- `SENSITIVE_DATA_REQUIRE_ENCRYPTED`: defaults to `false` for the legacy read window; set to `true` after the strict verification pass. This does not control writes: new sensitive writes always require encryption.
- `AWS_REGION`: existing AWS region setting.
- SDK credentials: use the AWS SDK default provider chain. Do not place static credentials in browser code, source, or deploy artifacts.

### Public invite behavior

Return only the minimum fields needed to resume the form. Restore must strip bank account/routing numbers and reset bank-account consent so a user must re-enter and re-consent. Do not send the encrypted envelope or decrypted full packet to the browser. Preserve the existing safe draft shaping and validation as the allowlist boundary.

### Admin review behavior

Decrypt packet data only on the server after authorization. Return masked bank and license values to the admin UI; do not serialize full values into page props, logs, audit diffs, errors, or client state. If a business process later needs complete values, provide a narrowly scoped audited action instead of broadening the review response.

### Backfill and verification

Provide an idempotent dry-run and apply mode. The apply path should use compare-and-swap (CAS) against the row value/version read before encryption so a concurrent edit is not overwritten. Re-running must skip already encrypted values, leave malformed rows unchanged with a counted error, and never print payload contents. Report counts by table/field and outcome only.

Verify before removing dual-read:

1. Dry-run counts match the expected legacy population and identifies malformed/unsupported records without exposing values.
2. Apply encrypts every eligible legacy value and is safe to repeat.
3. A verification pass decrypts each new envelope with the expected opaque record context and compares it in memory to the source value; report only counts and mismatches.
4. New onboarding writes fail closed with missing key and denied KMS permission; valid invite restore and admin review still work.
5. Browser responses contain no bank/routing values, and admin responses contain only masked values.
6. Backups and restore drills retain access to the KMS key and all envelope versions needed to read restored rows.

Keep dual-read only for the bounded backfill window. Once verification and a backup/restore check pass, remove legacy plaintext reads and reject plaintext for the covered fields. Retain old KMS keys while any live data, backup, or exported snapshot may still contain ciphertext under them.

The implemented CLI is `apps/web/scripts/encrypt-onboarding-data.ts`. From `apps/web`, with the intended database and KMS credentials already supplied securely to the process:

```bash
# Inventory only: no KMS calls or database writes.
node --conditions=react-server --import tsx scripts/encrypt-onboarding-data.ts
# Encrypt legacy rows; checks round trips and concurrent edits.
node --conditions=react-server --import tsx scripts/encrypt-onboarding-data.ts --apply
# Authenticate every covered ciphertext; fail if any legacy JSON remains.
node --conditions=react-server --import tsx scripts/encrypt-onboarding-data.ts --verify
```

Use the tools image with the same command (`pnpm exec node ...`) when running through Compose. The image must include this release's scripts and sources. `react-server` selects the supported `server-only` condition for this maintenance process; it does not bypass authentication in web routes. The CLI does not load environment files automatically. It reports counts only and returns a failing exit status for invalid rows, crypto failures, or concurrent changes. Review failures before retrying; no plaintext dump is produced.

## Optional S3 SSE-KMS for new uploads

`S3_KMS_KEY_ARN` is optional for this phase. When configured, send new S3 writes with SSE-KMS using that key ARN and `BucketKeyEnabled: true`. Also configure bucket default encryption and a bucket policy that denies new object writes unless the required KMS key and SSE-KMS settings are used. Verify the bucket policy against every writer (web app, backup jobs, and any other upload process) before enabling the deny rule. S3 Bucket Keys reduce KMS request traffic and cost; they also change the KMS encryption context to the bucket ARN, which must be reflected in key-policy conditions. [S3 Bucket Keys](https://docs.aws.amazon.com/AmazonS3/latest/userguide/configuring-bucket-key.html)

This phase only covers new uploads. Existing objects and old versions remain under their current encryption until a separately planned rewrite/re-encryption operation is performed. Do not assume bucket default encryption rewrites old versions. S3 provides separate mechanisms to update existing object encryption; inventory versions and lifecycle/retention rules before choosing one. [Updating encryption for existing S3 data](https://docs.aws.amazon.com/AmazonS3/latest/userguide/update-sse-encryption.html)

## AWS deployment and permissions

Create a symmetric customer-managed KMS key in the same region as the app and S3 bucket. The reviewable CloudFormation template is `infra/aws/iam/persona-sensitive-data-kms.template.json`; supply the actual dedicated runtime principal ARN and private bucket name. It retains the key on stack removal/replacement and enables annual rotation. It does not change the bucket policy or create runtime credentials. Separate the app's data-encryption key from the S3 SSE-KMS key when independent access or incident containment is useful; sharing one key reduces initial setup but couples recovery. Automatic rotation of the same key ARN retains decryption of older ciphertext; `SENSITIVE_DATA_KMS_PREVIOUS_KEY_ARNS` is for replacing a key with another ARN. KMS pricing is per key, not per employee; request usage and retained rotation material can add charges. [KMS pricing](https://aws.amazon.com/kms/pricing/)

Grant only the web process the KMS operations needed by the selected Encryption SDK flow, constrained to the specific key and (where supported by the SDK/API path) the expected encryption-context values. For S3, grant the application principal only the required S3 object actions plus KMS use through S3 (`kms:ViaService` for the bucket's region), constrained to the bucket encryption context appropriate for S3 Bucket Keys. Keep key-administration permissions separate from application runtime permissions. Review KMS CloudTrail events and retain app-level audit events for who accessed or changed sensitive records; these logs answer different questions. AWS documents that KMS cryptographic calls are recorded in CloudTrail and that encryption context appears in those records. [KMS CloudTrail logging](https://docs.aws.amazon.com/kms/latest/developerguide/logging-using-cloudtrail.html)

Do not assume a Lightsail instance has an EC2 task role or instance profile. Inspect the actual deployed credential setup first. Prefer temporary credentials with a robust bootstrap/renewal path; never use the AWS root user, put long-lived access keys in the browser, or bake unrestricted keys into the image. If the current Lightsail setup relies on static credentials, plan and validate a credential migration before making production KMS access dependent on an unrenewable key.

Deployment order: create the key and policy; validate runtime credentials and KMS access from the actual host; deploy code that can read legacy and encrypted values; enable encrypted writes only after the key is present; backfill; verify; then remove legacy reads. A rolling deployment is unsafe for writes while any old app process can still write plaintext. Drain/stop old processes before enabling encrypted writes, or otherwise ensure no old writer remains. Keep the previous release available for rollback only if it can read the encrypted format; rolling back to a plaintext-only reader after encrypted writes is not safe.

## Phase 2: remaining sensitive data

After Phase 1 is stable, inventory and classify remaining data before expanding the encryption helper:

- Employee structured PII: SSN last-four digits, date of birth, home address, personal contact details, and emergency contact details. Preserve payroll reconciliation by decrypting only in authorized matching jobs or using a separately keyed lookup token where database lookup is required. Never use an unkeyed hash of four SSN digits: all 10,000 values are easy to guess.
- Structured compensation, benefit/retirement elections, reimbursement details, and other financial or health-related employee data. These need a reader/writer and reporting review before changing SQL numeric/date fields to encrypted payloads.
- `HirePacketImport.proposedFields` and any extraction payloads that can contain employee PII.
- Freeform employee notes and revisions, which may contain sensitive information not captured by typed fields.

For each field, map read/write paths, authorization, search/index requirements, exports, backup retention, and deletion behavior. Encryption will affect database filtering, sorting, uniqueness, and reporting; decide which fields need a keyed lookup token or application-side filtering before migration. Do not claim full database coverage after encrypting only these selected fields. Full SSNs are outside the current structured employee model, but uploaded onboarding forms and paystubs can contain full identifiers and bank details.

## Gaps and deferred work

- MFA is not yet a required gate for every sensitive-data read. Track this as an access-control gap; encryption at rest does not replace MFA or authorization checks.
- Payroll-only document allowlisting is a future access-hardening improvement. Current file authorization should remain in place, but do not claim the KMS work solves which document types an employee may read.
- Existing S3 object versions and historical plaintext database values need explicit migration and retention handling.
- KMS encryption does not prevent exposure after an authorized application process decrypts data. Minimize plaintext lifetime, response shape, logging, and runtime access.

## Rollback and operational acceptance

Rollback must preserve the ability to read encrypted data. Before rollout, retain the old key and key policy, back up the database, and record the envelope format/version. If encryption writes fail, stop or disable sensitive writes and repair KMS configuration; do not fall back to plaintext. If application code must be rolled back, use a version that understands encrypted envelopes. Never roll back to a plaintext-only reader once encrypted values exist.

Acceptance requires successful dry-run/apply/verification, no plaintext fallback, no saved bank numbers in public resume responses, masked admin bank/license values, no sensitive payloads in logs, least-privilege runtime credentials, KMS and app audit visibility, and a restore test using the retained key. Other draft answers are still returned to a valid open invite so the hire can resume. No production key creation, policy change, object rewrite, backfill, or deployment has been performed by this implementation.

## AWS Console checklist (do this before enabling encryption in prod)

Region: **us-east-2** (same as the Lightsail app and S3 bucket).

1. **Identify the runtime IAM principal**  
   On the Lightsail box, open `apps/web/.env.prod` and note `AWS_ACCESS_KEY_ID`. In IAM → Users, find the user that owns that access key. Copy its ARN (`arn:aws:iam::ACCOUNT:user/NAME`). Do **not** use the account root.

2. **Create the customer-managed key** (pick one path)  
   - **Preferred:** CloudFormation → Create stack → upload `infra/aws/iam/persona-sensitive-data-kms.template.json`. Parameters: `RuntimePrincipalArn` = the IAM user ARN above; `StorageBucketName` = the private uploads bucket (`S3_BUCKET`). After create, copy the **KeyArn** output (full `...:key/UUID`, not the alias).  
   - **Manual:** KMS → Customer managed keys → Create → Symmetric, Encrypt/decrypt → alias `act-persona-sensitive-data` → enable automatic key rotation → key administrators = your admin IAM users → key users = the Lightsail runtime IAM user. Then edit the key policy and restrict runtime use to `kms:GenerateDataKey` and `kms:Decrypt` with encryption-context conditions matching the template (`app=act-persona` and the listed purposes). Copy the key ARN.

3. **Confirm the IAM user can call KMS**  
   The same access keys already used for S3 must be allowed on this key (via the key policy and, if you use identity policies, matching allow statements). From a machine with those credentials:

   ```bash
   aws kms describe-key --key-id KEY_ARN --region us-east-2
   ```

   That must succeed. Do not put long-lived keys in the browser or bake them into the image.

4. **Do not set the env var on the live app yet**  
   Record the Key ARN offline. App deploy + `SENSITIVE_DATA_KMS_KEY_ARN` happens only with the encrypting code release, after a DB backup. Leave `SENSITIVE_DATA_REQUIRE_ENCRYPTED=false` until migration `--verify` passes. Optional later: set `S3_KMS_KEY_ARN` to the same ARN for new uploads (bucket default encryption / deny policy are separate).

5. **Cost**  
   About **$1/month per customer-managed key**, plus request usage. One key covers all employees.

Local development may use a real AWS test key, or `SENSITIVE_DATA_DEV_MASTER_KEY` (32-byte hex). The dev master is rejected when `NODE_ENV=production`.

## Build status (2026-10-29)

Implemented locally:

- Phase 1: Encryption SDK helper; onboarding draft + five packet sections; browser draft scrubbing; masked admin bank/license; migration CLI; optional SSE-KMS for new uploads; env examples; CloudFormation template; gated local Raw-AES adapter.
- Phase 2 (code): `Employee.privateDetails` schema + SQL; employee private readers/writers wired through create/update/auth/settings/paystub matching/benefits; hire-packet proposedFields/fileResults encryption; employee notes + revisions; migration CLIs for employee/hire-packet/notes; legacy script guard for plaintext seed/import scripts; create-admin seals employee personalEmail when present.

## Production activation (2026-10-29)

Completed on Lightsail:

- Key: `arn:aws:kms:us-east-2:865675170095:key/2efa5fa3-3fe1-4fb0-b11f-7f43223b2c72` (alias `act-persona-sensitive-data`)
- Runtime principal verified: `act-persona-app` (`GenerateDataKey` with encryption context succeeded)
- Release dir: `/home/ubuntu/act-releases/kms-rollout-20261029T142641Z/` (DB dump + source backup + build/switch logs)
- SQL applied: `Employee.privateDetails`, `HirePacketImport.processingToken`
- Web image switched healthy; public `/api/health` and `/login` = 200
- `SENSITIVE_DATA_KMS_KEY_ARN` set; `SENSITIVE_DATA_REQUIRE_ENCRYPTED=false` (compatibility window kept)
- Migrations: onboarding draft encrypted (1); employee private details updated 69 / empty 22 / verify 69; hire-packet and notes had 0 rows
- Prior web image retained as `act-erp-lite-web:before-kms-20261029`

Still open: flip `SENSITIVE_DATA_REQUIRE_ENCRYPTED=true` after smoke tests; tighten key policy to encryption-context conditions (console key-user grant is broader than the CFN template); optional `S3_KMS_KEY_ARN`; compensation/numeric fields; historical S3 re-encrypt; MFA gate on sensitive reads.
