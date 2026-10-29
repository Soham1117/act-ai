# Combined paystub PDF import

Status: implemented and deployed October 28, 2026. See [release notes](PAYSTUB_BATCH_RELEASE_2026-10-28.md) for the shipped behavior, tests, backups, and preservation proof. The proposal below records the original design; the subsequent implementation request also added explicit, bounded Textract fallback for scanned pages. No real paystubs were published during deployment.

## Outcome

An admin can select a combined payroll-provider PDF, review an individual document and employee match for each paystub, resolve exceptions, and publish only the intended employee's pages to their Payroll area.

Use the existing Payroll -> Upload pay stubs entry point, employee access controls, private storage, matching helpers, duplicate review, and notifications. This is document distribution, not payroll calculation or processing.

## Direct text extraction versus OCR

Read-only checks on the current Paystubs folder found 21 PDFs containing 686 pages. Every page has extractable text. Twenty files contain 666 pages with the expected employee-paystub markers; the remaining 20-page file is a different report type.

The October 29 sample has 40 pages. The application's existing parser extracted a name, masked SSN last four, and pay period from all 40 when tested separately. Matching against the current roster returned 20 high-confidence suggestions, 10 medium-confidence suggestions, one ambiguous result, and nine unmatched results. These are baseline observations, not permanent expected counts: the roster can change.

The February 19 file is a payroll summary. Its inspected first page presents several employees in columns. It must not be distributed as an individual paystub or split into employee documents simply by page number.

Use embedded PDF text with the existing PDF.js library by default. The supplied samples do not need OCR. Image-only pages stop with an OCR-required message and offer an explicit Textract action, limited to 10 scanned pages per review. Poor matching and unsupported report layouts are separate problems from unreadable images: re-running OCR does not fix missing employee records, conflicting names, or a multi-employee summary layout.

Do not promise complete financial-data extraction: the folder scan checked text availability and paystub markers; the detailed matching experiment covered the October 29 sample. Amounts are not required to sort or distribute documents.

## Existing behavior and immediate guard

- `src/lib/paystub-parser.ts` reads only `doc.getPage(1)`.
- `previewPaystub` returns one proposed employee and pay period per source file.
- `upload-paystubs-dialog.tsx` creates one row per selected file and submits the entire source PDF.
- `uploadPayrollDocument` saves the supplied bytes under one employee without determining whether later pages contain other employees.

First deliverable: close that first-page-only path. The server must reject a combined or mixed-employee paystub submitted through the legacy single-document action and direct admins to the reviewed batch flow. Do not rely on a client warning or a filename/category label. Known paystub/summary signatures must not bypass the guard by changing category text. Preserve valid non-paystub payroll documents and existing single-paystub uploads.

## Admin workflow

1. Select one or more PDFs using the existing upload dialog. Analyze one source file at a time to bound memory, with file/page progress and cancellation.
2. Show the detected source type and page count. Reject payroll summaries and other unsupported reports with a specific explanation.
3. For a supported combined file, show one row per individual stub: source filename and page, extracted employee name, proposed employee, pay-period start/end, pay date, check reference, match confidence, and duplicate status. Show only the minimum identifying data needed for review; do not expose full SSNs or bank details in the grid.
4. Provide an admin-only preview of the exact pages that will be saved. Display high-confidence matches as suggestions; nothing publishes automatically.
5. Require explicit confirmation for medium-confidence matches. Ambiguous and unmatched rows require manual employee selection and confirmation, or explicit Skip. Do not silently create employees or change roster names/SSNs.
6. Surface a mismatch between the extracted pay period and the selected calendar period. Require an explicit correction/confirmation instead of silently changing the document's dates to match the calendar. Pay date and pay-period end are distinct.
7. Show a final review summary: ready, skipped, unresolved, duplicate, and unsupported counts. Only explicitly selected, resolved rows can be submitted; unresolved rows cannot publish accidentally.
8. Save only generated individual PDFs. Return saved/skipped/failed results by row. Retrying failed rows must not repeat successful uploads or notifications.

Version one supports the provider's observed one-stub-per-page layout. A continuation page without its own reliable identity, several employees on one page, mixed identities, or ambiguous boundaries is held for review/unsupported handling. Do not assume every arbitrary PDF page is a complete paystub or group all pages by a fuzzy name. Multi-page-stub support requires verified boundaries and remains outside this first version.

## Server flow and storage

Keep this bounded and synchronous. Reuse the existing stack rather than adding an ingestion queue, import worker, or new OCR service.

### Preview

- Require admin authorization and run the existing extension/signature checks before parsing.
- Propose a shared 10 MB source-file limit, matching current paystub upload validation, plus a 200-page cap. Enforce both on the server and mirror them in the UI. The current parser's 5 MB auto-read limit must not conflict with the accepted batch limit.
- Load the PDF once, inspect every page's text and coordinates, classify it, and extract structured identifiers and dates. Validate actual calendar dates, not only date-string syntax.
- Reuse/refactor the current parser so it can parse a supplied page without repeatedly loading the whole document. Release PDF.js page/document resources after use.
- Derive PDF fragments using the existing `pdf-lib` package. Ensure it is declared as a runtime dependency if server imports need it; it currently appears under dev dependencies.
- Keep the original file in browser memory during review. Preview requests process it transiently on the server; do not store the combined source in an employee-accessible location. Opening/canceling preview creates no Payroll rows or employee notifications.
- Return bounded extracted metadata and source page references, not the whole payroll text or an SSN roster. If an on-demand page preview is generated in the browser, it remains an admin preview and is not trusted for saving.

### Confirm and save

- Submit the source PDF again once for that source file, together with selected page references, employee choices, dates, and explicit review decisions.
- Recheck admin authorization, size/page limits, source hash, classification, actual page ownership/boundaries, current employee eligibility, match evidence, and duplicates. Recompute extraction server-side; do not trust browser-provided PDF fragments, confidence scores, dates, or a previously selected employee ID alone.
- The server generates the saved PDF from the validated source pages. Never pass the combined original through the employee-document upload path.
- Validate manual employee overrides explicitly, require a reason for conflicting identity evidence, and audit the decision. SSN last four is never sufficient to guarantee identity.
- Save each item independently with its audit event, returning per-item outcomes. Stage a generated object before its database transaction and remove that object on a transaction failure. Report post-save notification/cleanup failures separately so a saved row is not falsely marked unsaved and retried as a new document.
- Keep existing employee eligibility and non-paystub/W-2 handling intact. This feature does not change eligibility or consent policy.

For version one, canceling a review or closing the tab discards the unsaved in-memory review. A durable resumable import service can be considered later; it is not needed for these small source PDFs.

## Matching rules

- Retain the confidence model: agreeing unique name and SSN last four may produce a high-confidence suggestion; name-only or conflicting evidence requires confirmation; collisions cannot be auto-selected and published.
- Improve deterministic name comparison only where justified by representative cases: punctuation, case, whitespace, and name order. Avoid substring matching that can turn a short name into a false positive.
- Preserve a masked identifier for disambiguation where necessary, not raw SSNs in logs or analytics.
- Missing or inconsistent roster data is an admin follow-up. Do not silently create aliases, overwrite SSNs, or link a payroll identity permanently as a side effect of one import.
- Re-evaluate the match at save time. If the roster or document differs from the reviewed values, return that row for review rather than using stale confidence.

## Duplicate handling and provenance

Add only the provenance needed to the existing Payroll model, with nullable fields so historical uploads still work:

- Source PDF hash and original source filename.
- Source page reference(s).
- Extracted check reference and pay date, when present.
- A nullable unique import key derived from the source hash and canonical source-page reference. This prevents the same source stub from being published twice, even if a later retry selects another employee.

Keep the existing hash for the generated employee PDF as well. Do not rely on generated-PDF byte equality alone because PDF serialization can change bytes.

At preview and again in a transaction, check exact source/page duplicates, generated content, and same-employee/period/check-reference candidates. Renamed copies must not evade exact-source detection. Re-exported PDFs with different hashes require semantic duplicate review.

Same employee and period does not automatically mean the same document: a supplemental check can be legitimate. Show Keep existing, Skip, and Replace this specific document; support a separately confirmed additional check where appropriate. Never reuse the current broad period overwrite to delete every document for that employee/period. Replacement identifies the exact target and checks that it has not changed since review.

Use a database unique import key plus transaction locking for duplicate/replacement checks, including concurrent requests. Both the existing single-stub uploader and the batch path must use the same responsible persistence service. Retry returns the already-saved receipt for an identical decision; a different employee/period decision for an existing import key is a conflict, not an unnoticed reassignment.

Persist source references and review choices in the existing audit history; exclude raw payroll text, SSNs, bank details, and salary figures from routine logs. An import key contains no employee SSN.

## Integration points

- `src/lib/paystub-parser.ts`: page-level extraction, classification, date validation, and resource cleanup.
- `src/lib/paystub-match.ts`: conservative matching and confirmation requirements.
- New focused PDF-splitting/batch helpers beside those files; reuse `pdf-lib` and PDF.js.
- `src/server/actions/payroll.ts`: preview/confirm batch actions, server-side combined-file guard, shared persistence service, idempotency, and exact replacement handling.
- `src/app/(admin)/admin/payroll/upload-paystubs-dialog.tsx`: one review row per stub, exact-page preview, exceptions, selected rows, and retry results.
- `prisma/schema.prisma`: additive nullable provenance and unique import key. Follow Persona's existing production schema-update runbook rather than introducing a new migration/deployment system.
- Existing file-serving route: verify stored fragments remain employee-owned and privately served. No employee URL should expose a combined original or another worker's page.

## Verification

Use synthetic PDFs and fake identities in committed tests. Do not commit real paystubs, masked SSNs, salary information, source previews, or roster exports as fixtures.

1. Single stub: extraction and upload continue to work.
2. Combined file: multiple employee pages produce separate previews and separate saved PDFs; the old action refuses the unreviewed combined original.
3. Sample parity: a local read-only run on the October 29 source yields 40 distinct per-page candidates, with names, masked SSN evidence, and periods available. Compare confidence to the then-current roster; do not hardcode real identities into tests.
4. Payroll summary: the February 19-style multi-column report is blocked, including when its filename or category is changed. No partial employee document is fabricated.
5. Image-only, mixed, encrypted, corrupt, oversized, over-page-limit, unknown-template, and ambiguous-boundary inputs receive explicit bounded failures. Scanned pages are not falsely called a roster mismatch.
6. Matching: collisions, reordered names, punctuation, missing fields, wrong-employee selection, missing confirmation, roster changes, and invalid/mismatched dates cannot publish silently.
7. Access: a real employee can retrieve only their generated document; requesting another employee's document or a combined source fails. Non-admin callers cannot preview, confirm, override, or replace via direct action calls.
8. Retry/concurrency: repeated uploads, renamed copies, overlapping page choices, conflicting assignments, and two simultaneous confirms do not create duplicates or double-delete replacements.
9. Partial failure: an object-store, database, or notification failure does not expose unsaved pages or lose an existing replacement target. Retrying successful items returns saved receipts; unresolved items remain actionable.
10. Compatibility: existing payroll documents, document categories, private file delivery, calendar periods, employee eligibility, notifications, and single-file behavior retain their intended operation.

## Delivery sequence and stop condition

1. Implement the combined-file guard and pure extraction/classification/splitting helpers with focused tests.
2. Add additive provenance and shared persistence changes; implement authenticated preview/confirm actions and duplicate/override checks.
3. Add the review UI and exact-page preview using the existing design components; verify keyboard use and smaller-screen review.
4. Run focused unit/browser/access tests and the production build. Perform read-only local validation on the real samples without storing or publishing them.
5. Back up production and deploy only after those checks pass. Retain old documents and the previous image for rollback; do not drop provenance or remove newly saved documents as a rollback shortcut.

Complete when an admin can review and distribute a supported combined file into isolated employee documents, with no automatic publishing, no first-page misassignment, safe retries, and explicit exceptions. The shipped feature requires an admin's explicit page selection and final confirmation to publish actual paystubs. Optional OCR was added by the subsequent implementation request; bulk employee creation, summary-report-to-paystub conversion, and payroll calculations remain outside scope.

## Read-only evidence

- Folder scan: 21 files, 686/686 pages with extractable text; 666 pages with the expected employee-stub markers and 20 pages in the differently formatted February 19 report.
- October 29 per-page parser/matcher run: 40 readable pages; 40 names, 40 masked SSN values, and 40 pay periods extracted. Confidence at test time: 20 high, 10 medium, 1 low, 9 none.
- Production source check confirmed first-page parsing and full-source-byte upload in the existing implementation.
- The sampled February 19 page was rendered and visually inspected as a multi-employee payroll summary. Temporary rendered page images were removed after inspection.

Source PDFs are local, unchanged, and were not uploaded. These observations do not prove that every historical file has identical structure or every future scanned document will be readable without OCR.
