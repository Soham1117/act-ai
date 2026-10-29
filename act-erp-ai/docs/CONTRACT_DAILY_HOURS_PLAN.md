# Structured contract hours and per diem

Status: proposed plan, October 27, 2026. Planning only; no application or production data changes.

## Outcome and scope

An admin can enter reported hours and per diem eligibility by worker and business date, without inventing clock-in/out times. The same screen shows existing kiosk hours, approval state, weekly totals, and an export.

First version applies to contract workers across agencies. Record per diem as a day entitlement, not a dollar amount. The current contract-worker module explicitly stores no pay rates. Per diem rates, payment processing, tax treatment, employee payroll changes, OCR, and automatic parsing of free-text notes are outside this release.

## Current behavior verified in the repository

- `ContractTimeEntry` requires a clock-in timestamp; its work minutes come from punches and breaks. There is no structured per diem field or reported-hours-only entry.
- `/admin/contract-workers` already provides Workers, On site, Hours, and Agencies tabs, agency/date filters, pending/approved/rejected review, and audit logging.
- The existing contract CSV merges punches by worker/date. It includes pending hours, excludes rejected hours, and has a fixed ten-column format covered by browser tests.
- Reuse date-only handling and the existing Monday-Sunday business week in America/Chicago.

## Admin workflow

1. Open Contract workers -> Hours -> Daily sheet.
2. Choose an agency and week. Show the actual Monday-Sunday dates; support a custom report range.
3. Show one row per worker with daily reported hours and per diem controls. Each day also exposes kiosk hours and the source being counted. Keep punch details available from the existing view.
4. Enter decimal hours such as 10, 9, or 7.5. A blank means no manual hours supplied; an explicit 0 means no hours worked. Per diem has Yes, No, and Not reviewed states.
5. Preview changed cells, duplicate records, overlaps with punches, per-worker totals, and agency totals before saving. Saving creates pending records and does not imply approval.
6. Review and approve or reject selected days. Show pending and approved totals separately. Allow a per-diem-only day with 0 hours and Yes.
7. Download a new daily-sheet CSV with approved-only as the default. An explicit review export may include other statuses, clearly labeled.

On smaller screens, use a daily list or worker/day editor rather than squeezing seven editable day columns into the viewport. Keyboard entry and clear save/error feedback are required.

## Data design

Add a separate `ContractDailyRecord` model; retain existing punch rows and their required timestamps.

| Field | Meaning |
| --- | --- |
| id, contractWorkerId, date | Identity; unique database constraint on worker + business date |
| agencyId, jobCode, project | Historical attribution captured when the record is created; no silent reassignment if the worker changes agency later |
| manualWorkMin, nullable integer | Net reported work minutes; null means use punches; 0 is an explicit zero-hour report |
| perDiemEligible, nullable boolean | Yes / No / Not reviewed; no inference from attendance |
| sourceReference, notes | Optional reference such as an agency timesheet or user-provided breakdown |
| approvalStatus | Reuse Pending / Approved / Rejected vocabulary |
| createdById, updatedById, approvedById | Acting admin identities |
| createdAt, updatedAt, approvalDate, approvalNotes | Change and review history |
| revision | Optimistic concurrency check to prevent one admin overwriting another admin's edits |

Use the existing audit log for create, edit, review, and removal, including before/after values. Edits to approved records return them to pending. Removing an approved record requires a reason and retains its audit history.

A daily record may add per diem to a kiosk day without supplying manual hours. Days represented only by punches can be computed for display; do not create empty records for every worker/date.

## Counting and conflict rules

- Without manual hours, retain the existing punch calculation; do not infer breaks from reported net hours.
- Without punches, use the reported minutes. Manual entries never affect the live On site count or create punch photos or timestamps.
- When manual hours and non-rejected punches both exist on a day, flag a conflict. Never add both together or silently select one. In version one, block approval and approved export for that day's hours until an admin clears the manual value to use punches, or resolves the punch records through their existing review workflow. Offer both values and a direct link to the punch details.
- Recheck conflicts at save, approval, and export, not just in the UI. Later punch creation or editing must make an overlap visible and exclude the conflicted day from approved totals. Display the exclusion; do not silently omit it from a report.
- An approved per diem flag can coexist with approved kiosk hours. Per diem-only days are included even with no punches.
- Count at most one per diem entitlement per worker/date. Unknown is visibly incomplete, not an assumed No. Rejected daily records contribute neither their manual hours nor their per diem; valid independent punch records retain their own review state.
- Store minutes as integers; parse decimal hours with explicit minute precision and reject unsupported precision rather than accumulating rounding differences. Validate 0-24 reported hours per date and flag unusually long days for review.
- Validate the worker, agency, job code, contract dates, and admin permission server-side. Do not reinterpret an inactive worker as absent from historical reports.
- Repeated submissions cannot create duplicate daily rows. Matching existing values are skipped; differing values require an explicit reviewed update. Enforce the unique key and revision in the transaction.
- This is a reported-hours ledger. Do not label submitted hours as observed attendance, calculate agency invoices, or infer overtime payment rules.

## Reports and compatibility

Daily columns: agency, worker ID, worker name, business date, job code, kiosk hours, reported hours, counted hours, counted source, per diem Yes/No/Not reviewed, approval states, conflict indicator, and source reference.

Weekly summary: counted work hours and per diem days per worker and agency, with approved, pending, rejected, conflicted, and unreviewed-per-diem states identifiable. A per-diem-only Sunday must appear in both the screen and export.

Keep the existing punch CSV and its ten-column contract unchanged. Label it as the punch export and add a distinct daily-sheet export so downstream files do not silently change shape or start mixing unapproved and approved amounts. Reuse the existing formula-safe CSV helpers.

## Existing October 21-25 example

Use the seven existing worker IDs CW-0059 through CW-0065; do not create new workers or automatically parse other notes. Preview this exact backfill after the feature is deployed:

| Worker | Wed Oct 21 | Thu Oct 22 | Fri Oct 23 | Sat Oct 24 | Sun Oct 25 | Hours | Per diem days |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Jesus Alfredo Villafranca | 10 | 10 | 9 | 11 | 0 | 40 | 5 |
| Javier Villafranca | 10 | 10 | 9 | 11 | 0 | 40 | 5 |
| Daniel Cruz | 10 | 10 | 9 | 11 | 0 | 40 | 5 |
| Jesus Alfredo Sr. | 10 | 10 | 9 | 0 | 0 | 29 | 5 |
| Ricardo Garcia | — | — | — | — | 10 | 10 | 1 |
| Jorgie Galicia | — | — | — | — | 10 | 10 | 1 |
| Bairon Iracheta | — | — | — | — | 10 | 10 | 1 |
| Total | | | | | | 179 | 23 |

Every populated cell has per diem Yes. A dash means no supplied record, not an explicit zero or No. Expected: 23 daily records, 18 with work hours and 5 per-diem-only records. The business week is October 19-25, 2026.

Backfill through the authenticated application service as pending, with a stable source reference and a preview that skips existing matches and highlights differences. Keep the original worker notes as source evidence; they must never also count toward totals. Do not auto-approve historical entries.

## Implementation sequence

1. Add the model, constraints, and an additive migration in `apps/web/prisma`. Add calculation/validation helpers and focused tests for manual hours, zero, null, per diem, overlap, and integer-minute totals.
2. Add admin-only daily-record actions and queries beside `src/server/actions/contract-workers.ts` and `src/server/queries/contract-workers.ts`. Reuse audit, date parsing, approval vocabulary, and existing worker/punch locking conventions. Keep review and duplicate checks transactional.
3. Add the daily sheet within `src/app/(admin)/admin/contract-workers`, retaining existing punch editing and live kiosk behavior. Add approval summaries and the new export, using the same counting rules for UI and CSV.
4. Exercise the existing contract-worker, kiosk, hours review, and CSV tests plus focused new browser scenarios. Build and check permissions before deployment.
5. Back up production, deploy the additive feature, verify one manual-hours day and one per-diem-only day, then preview and backfill the confirmed seven-worker example. Verify totals and audit records after import.

Do not drop the new table to roll back a release containing entered records. Restore the previous application build if needed while retaining the new data and backup for recovery.

## Acceptance and stop condition

- The exact example is enterable without clock times and totals 179 work hours and 23 per diem days.
- Screen and daily export agree; per-diem-only records appear; pending records do not leak into approved totals.
- Adding the same breakdown twice leaves one record per worker/date and does not overwrite reviewed differences.
- Manual/punch overlaps are visible and never double-count, including after later punch changes.
- Approved edits require a reason and re-review; concurrent edits cannot silently overwrite each other.
- Non-admin users cannot create, change, approve, or export restricted records by calling the underlying actions directly.
- Existing kiosk attendance, punch editing, punch CSV, worker records, and historical notes retain their behavior.

Stop when these checks pass and the confirmed example has been previewed and verified. Dollar rates and broader payroll automation require a separate scope decision.
