# Coverage: payroll, admin time tracking, employee time page (slot 4)

Seed: `e2e/seed-parts/40-payroll-time.ts`. Helpers: `e2e/support/payroll-time.ts`.

| Item | Scenario | Status | Spec |
|---|---|---|---|
| `createPayrollPeriod` | happy path, status follows dates, Mark completed | covered | payroll-periods.spec.ts |
| `createPayrollPeriod` | overlap (inside, touching last day) rejected; next day allowed | covered | payroll-periods.spec.ts |
| `createPayrollPeriod` | invalid dates (UI blocks); one-letter title (zod) | covered | payroll-periods.spec.ts |
| `createPayrollPeriod` | server failure / 500 / stale deployment / double click | covered | payroll-periods.spec.ts |
| `createPayrollPeriod` | server-side date check messages (end < start, pay date < end) | not-testable | UI disables Create; message only reachable by calling the action directly |
| `updatePayrollPeriod` | rename, change dates, mark completed | covered | payroll-periods.spec.ts |
| `updatePayrollPeriod` | overlap, invalid dates, deleted meanwhile, failure | covered | payroll-periods.spec.ts |
| `deletePayrollPeriod` | confirm/cancel, delete + audit, already deleted, failure, documents untouched | covered | payroll-periods.spec.ts |
| `generatePayrollSlipCsv` | CSV content for periods A and B, override audit, 9/10 char reason, cancel, failure, double click | covered | payroll-slip.spec.ts, payroll-csv.spec.ts |
| `generatePayrollSlipCsv` | period deleted meanwhile | covered | payroll-csv.spec.ts |
| `uploadPayrollDocument` | happy path (DB row, sha256, stored file, audit, notification) | covered | payroll-documents.spec.ts |
| `uploadPayrollDocument` | duplicate sha256, duplicate category+period, Replace, batch duplicate | covered | payroll-documents.spec.ts |
| `uploadPayrollDocument` | non-PDF, fake PDF, empty file, W-2 consent, pending-review employee | covered | payroll-documents.spec.ts |
| `uploadPayrollDocument` | "employee no longer exists", "end before start" server messages | not-testable | UI gives no path to them (dropdown lists current employees; Confirm disabled for bad dates) |
| `uploadPayrollDocument` | server failure / 500 during upload | planned | test.fixme: upload dialog stays stuck (no try/catch in `onConfirm`) |
| `uploadPayrollDocument` | double click, stale deployment | covered | payroll-documents.spec.ts |
| `previewPaystub` | provider-template PDF auto-match and pre-upload duplicate flag | planned | test.fixme: pdfjs fake worker not found under Next dev, parse always returns nothing |
| `previewPaystub` | unreadable file / preview failure falls back to manual entry | covered | payroll-documents.spec.ts |
| `deletePayrollDocument` | confirm/cancel, delete (row, stored file, audit), already deleted, failure | covered | payroll-documents.spec.ts |
| `/api/payroll/[id]/file` | admin view/download headers; 404 unknown/missing file; employee own 200, other employee 403, anonymous blocked | covered | payroll-documents.spec.ts |
| `adminCreateManualTimeEntry` | happy path with break, validation (order, 16h cap, future, break rules, missing reason/employee/break end), overlap, touching entries | covered | time-manual-entry.spec.ts |
| `adminCreateManualTimeEntry` | DST: spring-forward 7h, fall-back 9h, repeated 01:30, nonexistent 02:30 | covered | time-manual-entry.spec.ts |
| `adminCreateManualTimeEntry` | approve immediately: admin with and without an employee profile; ended employee | covered | time-manual-entry.spec.ts |
| `adminCreateManualTimeEntry` | failure / double click | covered | time-manual-entry.spec.ts |
| `adminUpdateTimeEntry` | reapproval on payable change, notes-only keeps approval, add break, overlap, future, deleted meanwhile | covered | time-corrections.spec.ts, time-entry-edit.spec.ts |
| `adminUpdateTimeEntry` | open-entry rules ("still open", "close first") | not-testable | the dialog hides clock-out and breaks for open entries |
| `adminDeleteTimeEntry` | reason required, confirm/cancel, breaks removed, audit, failure, double click | covered | time-corrections.spec.ts |
| `adminReopenTimeEntry` | happy path, reason, older than 16h, other open shift, failure | covered | time-corrections.spec.ts |
| `adminForceClockOut` | cap close, open break closed, empty reason, past cap, already closed, failure, double click | covered | time-corrections.spec.ts |
| `reviewTimeEntry` | approve, reject (reason rule), notification, deleted/already decided, no employee profile, failure, double click | covered | time-review.spec.ts |
| `reviewTimeEntry` | re-review of decided entries (`allowReReview`), open-entry message | not-testable | no UI path sends them |
| `bulkReviewTimeEntries` | approve, reject with shared reason, partial skip, all skipped, no employee profile | covered | time-review.spec.ts |
| (time-clock.ts web clock) | clock in / out / break from the web | not-testable | does not exist: punches are kiosk-only; employee page has no clock buttons (asserted in employee-time.spec.ts). Kiosk double clock-in belongs to the kiosk specs |
| Overtime and weekly math | 45h week, straddling week, Sunday/Monday boundary, breaks, pending/rejected excluded | covered | payroll-slip.spec.ts |
| Holiday pay math | n/a | not-testable | no holiday rules exist in payroll code |
| Readiness blockers | pending, rejected, open, auto-closed, zero hours | covered | payroll-slip.spec.ts |
| Page `/admin/payroll`, `/admin/payroll/[periodId]` | list, slip, print layout, Print button, unknown id | covered | payroll-periods.spec.ts, payroll-slip.spec.ts |
| Page `/admin/time-tracking` | Needs attention (stale + auto-closed), Pending, Entries (filters, totals), Clocked in, DST/overnight display, punch photos (recent, none, expired >30 days) | covered | time-corrections.spec.ts, time-views.spec.ts |
| Page `/admin/time-tracking` | photo missing from storage shows "Photo expired" | planned | test.fixme: broken image stays when the 404 arrives before hydration |
| Page `/dashboard/time-tracking` | own entries only, statuses, rejected/edited/auto-closed notes, week/month hours, no-employee message, signed-out redirect | covered | employee-time.spec.ts |
| Page `/dashboard/payroll` | own documents only, upcoming pay dates, empty state, admin page blocked | covered | payroll-documents.spec.ts |
| API `/api/punch-photo` | admin only, bad params 400, unknown id 404 | covered | time-views.spec.ts |
