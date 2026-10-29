# Reviewed paystub import — October 28, 2026

## Admin workflow

Open [Payroll](https://persona.americancompletiontools.com/admin/payroll), choose **Upload pay stubs**, leave the category as **Pay Stub**, and select one or more PDFs. The application analyzes each source separately and shows one row per supported paystub page. No employee document or notification is created by analysis.

Preview the exact page, verify the employee and period, resolve any mismatch or duplicate, check **I reviewed this page**, and select it. **Review selected** opens the final list; only the explicitly confirmed selected pages are saved. Unselected, unsupported, and unresolved pages stay out of employee Payroll. Saved receipts remain visible; failed pages can be reviewed/analyzed again and retried.

- Source limit: 10 MB / 200 pages per PDF. Supported layout: one complete provider paystub per page. Continuations, multi-employee pages, summaries/registers, unreadable/encrypted/corrupt files, and unknown layouts are held or rejected.
- Text is read directly. Scanned pages offer **Use OCR for scanned pages**. This calls the existing AWS Textract account for individual pages, up to 10 scanned pages per review. Low-confidence or unsupported OCR stays excluded; every OCR employee assignment requires an explanation. Textract connectivity was verified using a synthetic document with no employee data. [AWS single-page synchronous support](https://docs.aws.amazon.com/textract/latest/dg/sync.html).
- Matches are suggestions. Name comparison uses complete normalized tokens, and SSN last four alone cannot produce high confidence. Ambiguous/manual assignments and date corrections require explicit reasons. Source/roster evidence is recomputed at confirmation and roster identity is checked again within the write transaction.
- Exact source/page repeats are skipped. Other period/check candidates require keeping the existing file, confirming an additional check, or selecting one particular replacement. Exact identities cannot be bypassed by choosing Additional or another employee. Replacement never deletes every document for a period.
- The server creates a new one-page PDF from the validated original; browser-generated previews/fragments are never trusted for saving. Source-page annotations, linked attachments/scripts, and metadata are removed before copying to prevent hidden cross-page objects. The combined original is not stored in an employee-accessible location.
- The grid returns minimal identity/date metadata, never full SSNs, bank information, raw extracted text, or pay amounts. Employee download authorization remains in the existing private Payroll file route.

The legacy uploader checks every PDF page even if its category is changed. Renamed combined paystubs and payroll summaries cannot bypass review. Valid other payroll documents retain their flow and electronic W-2 consent checks; manual generic uploads can **Check existing documents** and replace one explicitly identified version. Generic PDFs retain their 15 MB limit, with a 1000-page inspection cap. A corrupt PDF is rejected rather than treated as manually readable.

## Persistence and compatibility

Seven nullable Payroll fields record source hash/name/page, unique import key, semantic hash, pay date, and check reference. Historical rows remain compatible. Both the legacy uploader and batch flow use the same persistence service. A shared transaction lock and unique source/page key handle concurrent submissions. File staging occurs privately; a failed transaction removes its staged object. Creation/replacement, audit, and notification commit atomically; successful retries return the existing receipt without a second notification. Post-save object cleanup/cache problems are reported separately from document success.

The import reads employee identity/eligibility but does not create employees or change names, SSNs, employment status, time entries, breaks, kiosk settings, pay calendars, payroll calculations, or deductions. Real source documents were read locally for validation; none were published as part of deploying this feature.

## Verification

- 484 unit tests in 57 files passed, including classification, real calendar dates, conservative matching, source hashes, direct action authorization, roster changes, manual/OCR review, exact replacements, old-path category bypasses, cleanup/transaction failures, OCR adapter, and removal of cross-page PDF objects.
- Six new Playwright scenarios passed against a dedicated PostgreSQL database and fake private object store: two-employee isolation/owner-only access/reimport skip; selected-only publication and unchanged employment/calendar/time; summaries/mixed identities/continuations/scans/OCR bounds; stale roster recovery; multiple sources for the same period; and concurrent admin confirmation with exactly one document, audit, notification, and retained object.
- Seventeen existing Payroll document/download/delete/access and hours/overtime regression scenarios passed. Older upload-specific tests assume the superseded one-row-per-file flow and are replaced for this feature by `e2e/paystub-batch.spec.ts`; the full legacy browser suite is not claimed executed.
- TypeScript, relevant ESLint, `git diff --check`, the production Docker build, and the UI detector passed. Desktop/mobile review screenshots are under `D:/Deployed Projects/ACT Sprout/tmp/persona-paystub-release/qa`. Modal viewport/content checks passed; the pre-existing background payroll table's mobile overflow is outside this change.
- Read-only real sample validation: October 29 source produced 40 supported pages; February 19 source produced zero supported pages and all 20 pages were correctly classified as payroll summaries. No OCR was needed for these samples.

## Backup, schema rehearsal, and rollback

Remote release backup: `/home/ubuntu/backups/persona/paystub-batch-20261028T193107Z`.

Off-server database copies/reports: `D:/Deployed Projects/ACT Persona/data/backups/paystub-batch-20261028T193107Z`.

Backups contain the full initial database, source/configuration archive, original shared Caddy configuration, saved previous image ID/tag, a fresh pre-schema database dump, schema diffs, protected-data snapshots, and reports. The initial database was restored into an isolated PostgreSQL database and the schema rehearsed there; all existing rows were identical afterward.

Prisma reported its generic new-unique-index warning during rehearsal. No data-loss override was used. The verified two-step expansion first pushed nullable columns, then created the unique import-key index only after proving all values were null, then verified the final schema with `prisma db push`. Only Payroll columns/indexes were added. Production schema application likewise preserved every existing employee, payroll/calendar, attendance, break, and kiosk row exactly.

Deployment uses a warmed candidate and replaces only the Persona web container. Shared proxy configuration is restored byte-for-byte; live health and final protected-data results are retained in `rollout-report.json` and `verification-report.json` in the backup directory.

Final production verification passed: 41 health samples, zero errors, healthy login/version endpoints, and the running image/source matched the tested candidate. All 43 employee rows, the existing pay calendar, all 92 employee and 293 contract time entries, and all 2 employee and 56 contract breaks were exactly unchanged. Payroll remained empty because no real paystubs were published. Both kiosk configurations/cookies were unchanged; one normal forward `lastUsedAt` heartbeat was observed. The temporary restore database and dedicated local test database were removed after checks.

| Database backup | SHA-256 |
| --- | --- |
| database-initial.dump | 805400d3d48b7d3a79b89401415527f551aded44f7d698ccd67777b02bc8aa78 |
| database-before-schema.dump | f7fa4ad101072c2898f8a08ff8c3f9f00cd0234b7118cecb19d80f4e258b57e4 |
| database-after-release.dump | 2774f291f149b7f401a6ff7faacfe5a87f85ddd0195ca8d06d4a0018c3b32bae |

For application rollback, retag the saved previous image and recreate only web using `--no-deps`. Leave the compatible additive columns and imported records intact. Do not restore an old whole database over live punches; restore into an isolated database and reconcile any needed recovery with current attendance first. The new schema's unique import key must remain in place while any new-version writer is active.
