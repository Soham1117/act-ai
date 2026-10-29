# Persona HR release — October 28, 2026

## Delivered

- [Company document library](https://persona.americancompletiontools.com/admin/documents/company): private company records, categories, dates/tax years, immutable versions, duplicate detection, approval, archive, and audited downloads. Uploaded payroll/tax archives remain admin-only.
- [Onboarding checklists](https://persona.americancompletiontools.com/admin/onboarding/checklists): assign approved template versions to a particular invite or employee, review submitted evidence, and retain explicit version-bound handbook receipts. Checklist completion does not change employment/account status.
- [Benefits eligibility](https://persona.americancompletiontools.com/admin/benefits/eligibility): typed policies and HR assessments, proposed eligibility dates, and plan code/Base/Buy-up metadata linked to approved resources. No automatic enrollment, deduction, or retirement election changes.
- Employee profile **Notes** tab: private general, termination, and resignation notes with date, author, immutable revision history, stale-edit protection, and archive reasons. Notes do not change employment status, termination date, or attendance.
- Privacy and onboarding copy distinguishes SSN last-four employee fields from sensitive identifiers that can occur inside uploaded forms.

Imported 30 supplied PDFs as private **HR_ONLY / DRAFT** records. A repeated import skipped all 30 by hash. Source ZIPs, email messages, extracted files, and manifests remain in `D:/Deployed Projects/ACT Persona/Paystubs`; three deferred job descriptions and two email messages were not published to the library.

## HR setup still required

Confirm current medical/vision summaries and forms, premium amounts, waiting-period boundaries, dental applicability, retirement service requirements, and employee eligibility classifications before approving resources or activating policies. Supplied medical summaries cover 2025 and the vision summary has a 2024 effective date. No current plan/pricing rows were invented.

Select approved onboarding items and assign them to hires. Existing hires are not retroactively blocked. Company W-2 batches/W-3 stay in the company archive; individual delivery continues through existing employee document/payroll controls. Upcoming eligibility is a review list; this release does not schedule automatic eligibility reminders.

Company introduction, safety training, and API/job-description requirements remain deferred for Deepak. Paystub splitting/OCR and structured agency daily hours remain separate plans.

## Preservation and rollback

Remote backup directory: `/home/ubuntu/backups/persona/hr-features-20261028T171113Z`.

Off-server database copies and verification reports: `D:/Deployed Projects/ACT Persona/data/backups/hr-features-20261028T171113Z`.

- Full database backups were taken initially, immediately before schema application, and after the HR import. The initial backup was restored into an isolated database and the additive schema rehearsed there; the temporary database was removed afterward.
- Source/configuration archive, original shared Caddy configuration, previous image IDs, schema diffs, raw attendance snapshots, and rollout/verification reports are retained remotely. The original image is tagged `act-erp-lite-web:hr-backup-hr-features-20261028T171113Z`.
- Production schema application added eight HR tables and nullable BenefitPlan metadata. No existing attendance table/column was altered. `prisma db push --skip-generate` ran only after diff inspection and backup verification, without a data-loss override.
- Immediately before/after schema application, all protected rows were identical. After feature deployment and import, all 92 employee punches, 293 contract punches, 2 employee breaks, and 56 contract breaks were exactly unchanged. Both kiosk configurations/cookies were unchanged; a normal forward `lastUsedAt` heartbeat was allowed.
- Only the Persona web container was replaced. The warmed rollout recorded 42 successful health samples and zero errors; shared Caddy configuration was restored byte-for-byte. The final privacy-copy rollout recorded another 41 successful samples and zero errors, with the proxy restored exactly. Its report and final attendance preservation verification are under `privacy-followup/`.

Database SHA-256:

| File | SHA-256 |
| --- | --- |
| database-before-schema.dump | ed3b3425195c5c29da77c527e8d17de5418189a6d2c390e8160b1b69e42e5991 |
| database-after-hr.dump | 737f78dd032a6274919d946dd4d1f587b57d44e8fd4787b01f7f96771f250bd4 |

For application rollback, use the saved previous image and recreate **only web** with `--no-deps`, preserving the additive schema/data and shared proxy configuration. Do not restore an old whole database over live attendance: that would discard punches received after the backup. If database recovery is necessary, first capture current data and reconcile attendance in an isolated restore. Company files are immutable private objects in existing storage; the import manifest retains their source hashes.

## Verification

- 387 unit tests across 52 files passed; TypeScript, relevant ESLint checks, and `git diff --check` passed.
- Nine new browser scenarios passed across focused runs: company library, three onboarding scenarios, two benefits scenarios, real contract PIN/punch/photo preservation, private notes, and desktop/mobile visual checks.
- Meaningful existing attendance scenarios passed, including full-day PIN flow, breaks, duplicate taps, retry recovery, and contract hours review. Existing onboarding, documents, and benefits checks were also exercised.
- Seven older browser expectations failed in broader runs: three stale status/punctuation expectations in `employee-time.spec.ts`, two contract kiosk cases missing the currently required PIN, one six-digit expectation for the current four-digit kiosk PIN, and one uppercase document-category expectation. These are recorded limitations; the full browser suite is not claimed green. Attendance implementation files were unchanged.
- Independent review found no remaining actionable issues. New action/route coverage is mapped in `apps/web/e2e/coverage/hr.md`.
- Desktop/mobile screenshots and detailed test logs are in `D:/Deployed Projects/ACT Sprout/tmp/persona-hr-release`.

Production health/login and authorization redirects were verified. Sensitive source documents, raw database dumps, and environment archives must remain outside source control.
