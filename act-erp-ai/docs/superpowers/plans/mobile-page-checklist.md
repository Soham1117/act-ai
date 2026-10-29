# Every-page mobile and no-dialog checklist

Date: 2026-10-29. **Source conversion complete for all 57 routes** (rescanned 2026-10-29 15:05 CT). Authenticated/device viewport verification is still pending everywhere.

Inventory: **57 page routes**, 44 route/subview tab entries, plus shared layouts and error/loading/print surfaces.

Rescan evidence (apps/web/src, excluding `components/ui` primitives):
- Zero consumer imports of `dialog` / `alert-dialog` / `sheet`.
- Zero `window.confirm` / `aria-modal` / `role="dialog"` in app or feature components.
- All inventoried overlay consumers use `InlinePanel`, `InlineConfirmAction`, Collapsible, or dedicated pages.
- Unused Radix primitives remain in `components/ui/{dialog,alert-dialog,sheet,command}.tsx` until retired after verification.

## Acceptance checks applied to every page

- [ ] Test 320px and 390px phone portrait, short phone landscape, 768px tablet and desktop; no horizontal page scroll (only clearly labeled local data scrolling when essential).
- [ ] Test English and Spanish where supported, light/dark themes, long real labels, empty/loading/error/success states and role/access restrictions.
- [ ] Keep all functions available, visible keyboard focus, readable labels/errors and 44px primary touch targets; 16px mobile form inputs and keyboard-safe actions.
- [x] Use inline forms/confirmations or real routes; no Dialog, AlertDialog, CommandDialog, Sheet, browser alert/confirm/prompt or custom modal overlays. Navigation expands in page flow; document/photo evidence stays inline or gets a real page. Native OS file/print/permission pickers are outside application markup. *(source complete; runtime verify pending)*
- [ ] For forms: test validation, pending/double-submit prevention, errors, cancel, success, focus into opened inline section and focus return to triggering control; preserve entered values on failure. For routes: test direct links, refresh and back navigation.

## Source conversion status

- [x] Employee leave request, reimbursement and general request forms converted to inline content (source).
- [x] Employee schedule selected-shift detail converted to inline content (source).
- [x] Employee leave/request cancellation and shared document deletion converted to `inline-confirm-action` (source).
- [x] All admin overlay consumers for routes `/admin/activity` through `/admin/schedules` converted (source).
- [x] Last 27 routes `/admin/settings` through `/unauthorized` converted/polished (source).
- [x] Shared: command palette, mobile sidebar, punch photos, single/bulk document upload, knowledge upload, chat evidence reflow (source).
- [x] Isolated Chromium component fixture for first employee forms passed earlier; stubbed actions only.
- [ ] Full authenticated browser, language/theme, upload, server-action success/error and responsive route acceptance checks remain pending for **all 57 routes**.

## Route checklist
### [x] `/admin/activity`
Source: `src/app/(admin)/admin/activity/page.tsx`.

- [x] Stack action-prefix/date filters and apply/reset/export controls; wrap activity payloads and names, verify pagination and empty results and preserve export filters.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`.

### [x] `/admin/benefits/[id]/edit`
Source: `src/app/(admin)/admin/benefits/[id]/edit/page.tsx`.

- [x] Apply the full create-plan mobile checks to populated/long/invalid values; preserve existing tiers/age rates/documents and edit-only behavior, missing-plan state and return navigation.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/app/(admin)/admin/benefits/plan-form.tsx`.

### [x] `/admin/benefits/eligibility`
Source: `src/app/(admin)/admin/benefits/eligibility/page.tsx`.

- [x] Check employee/plan filters, eligibility results and exceptions, comparisons and all workspace actions; collapse multi-column work areas while preserving reasons and review controls.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/app/(admin)/admin/benefits/eligibility/workspace.tsx`.

### [x] `/admin/benefits/new`
Source: `src/app/(admin)/admin/benefits/new/page.tsx`.

- [x] Check every PlanForm section: plan identity/type/provider/year/status, eligibility/cost periods, coverage tiers, age-rate entries, retirement settings, effective dates and document attachments; stack field grids and keep submit/cancel reachable.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/app/(admin)/admin/benefits/plan-form.tsx`.

### [x] `/admin/benefits`
Source: `src/app/(admin)/admin/benefits/page.tsx`.

- [x] Move metadata editing, plan rollover, deactivation and verification confirmations inline or to existing plan edit pages; check grouped plan lists, age-rate/tier/cost tables, attached documents, status/warnings and new/edit navigation.
- [x] Convert and verify these reachable overlay/native-confirm components (shared components may appear on several routes):
  - [x] `src/app/(admin)/admin/benefits/deactivate-plan-button.tsx`
  - [x] `src/app/(admin)/admin/benefits/mark-verified-button.tsx`
  - [x] `src/app/(admin)/admin/benefits/plan-metadata-editor.tsx`
  - [x] `src/app/(admin)/admin/benefits/roll-forward-dialog.tsx`
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/app/(admin)/admin/benefits/roll-forward-dialog.tsx`, `src/app/(admin)/admin/benefits/deactivate-plan-button.tsx`, `src/app/(admin)/admin/benefits/mark-verified-button.tsx`, `src/app/(admin)/admin/benefits/plan-metadata-editor.tsx`.

### [x] `/admin/chat`
Source: `src/app/(admin)/admin/chat/page.tsx`.

- [x] Reflow citation evidence beneath messages or to a dedicated source page; check document scope selection, composer/send/stop, restored sessions, long responses/code/tables, retry/error state and AI-disabled access.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/chat/chat-workspace.tsx`.

### [x] `/admin/contract-workers/[id]`
Source: `src/app/(admin)/admin/contract-workers/[id]/page.tsx`.

- [x] Keep identity/status/assignment information, date ranges, hours and time-entry history readable; replace punch-photo viewer with inline photos and retain back navigation.
- [x] Convert and verify these reachable overlay/native-confirm components (shared components may appear on several routes):
  - [x] `src/components/punch-photos.tsx`
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/components/punch-photos.tsx`, `src/app/(admin)/admin/contract-workers/shared.tsx`.

### [x] `/admin/contract-workers`
Source: `src/app/(admin)/admin/contract-workers/page.tsx`.

- [x] Replace every worker/agency add/edit/status/end-assignment/reactivation/clock-out panel and hours edit/rejection confirmation with inline sections or dedicated routes; audit filters, bulk selection and export in every tab.
- [x] Keep the entire tab strip reachable with touch and keyboard; preserve the selected tab after completing inline actions.
- [x] Review `workers` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Review `on-site` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Review `hours` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Review `agencies` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Convert and verify these reachable overlay/native-confirm components (shared components may appear on several routes):
  - [x] `src/app/(admin)/admin/contract-workers/agencies-tab.tsx`
  - [x] `src/app/(admin)/admin/contract-workers/hours-table.tsx`
  - [x] `src/app/(admin)/admin/contract-workers/worker-dialogs.tsx`
  - [x] `src/components/punch-photos.tsx`
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/app/(admin)/admin/contract-workers/agencies-tab.tsx`, `src/app/(admin)/admin/contract-workers/hours-table.tsx`, `src/app/(admin)/admin/contract-workers/worker-dialogs.tsx`, `src/app/(admin)/admin/contract-workers/workers-table.tsx`, `src/components/punch-photos.tsx`, `src/app/(admin)/admin/contract-workers/shared.tsx`.

### [x] `/admin/departments/[id]`
Source: `src/app/(admin)/admin/departments/[id]/page.tsx`.

- [x] Check department summary and employee roster cards, photos, role/status/contact labels, links and back navigation for long department/employee names.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.

### [x] `/admin/departments`
Source: `src/app/(admin)/admin/departments/page.tsx`.

- [x] Move create/edit department and delete confirmation inline or to dedicated routes; stack department cards, long labels, counts, edit actions and empty states.
- [x] Convert and verify these reachable overlay/native-confirm components (shared components may appear on several routes):
  - [x] `src/app/(admin)/admin/departments/department-actions.tsx`
  - [x] `src/app/(admin)/admin/departments/department-dialog.tsx`
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/app/(admin)/admin/departments/department-dialog.tsx`, `src/app/(admin)/admin/departments/department-actions.tsx`.

### [x] `/admin/documents/company`
Source: `src/app/(admin)/admin/documents/company/page.tsx`.

- [x] Check already-inline upload/new-version and review editors, category/purpose/status filters, version history, approval/archive/retry controls and document previews; stack review/editor content and preserve access restrictions.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/app/(admin)/admin/documents/company/company-library.tsx`.

### [x] `/admin/documents`
Source: `src/app/(admin)/admin/documents/page.tsx`.

- [x] Move bulk employee document upload and delete confirmation inline; audit all document-type tabs, recipient selection, file title/type, progress/failure, open/download/delete actions and large lists.
- [x] Keep the entire tab strip reachable with touch and keyboard; preserve the selected tab after completing inline actions.
- [x] Review `ALL` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Convert and verify these reachable overlay/native-confirm components (shared components may appear on several routes):
  - [x] `src/components/upload-document-bulk-dialog.tsx`
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/components/upload-document-bulk-dialog.tsx`, `src/components/delete-document-button.tsx`.

### [x] `/admin/employees/[id]/hire-import/[jobId]`
Source: `src/app/(admin)/admin/employees/[id]/hire-import/[jobId]/page.tsx`.

- [x] Check grouped extracted fields, current-versus-imported values, confidence/errors, file results, field selection and commit/cancel; stack comparison columns, preserve sensitive-field rules and job failure/pending/not-found states.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/app/(admin)/admin/employees/[id]/hire-import/[jobId]/review-form.tsx`.

### [x] `/admin/employees/[id]`
Source: `src/app/(admin)/admin/employees/[id]/page.tsx`.

- [x] Replace reset password, access-role changes, kiosk PIN reset, status/termination edits, leave adjustment, upload/delete documents, hire-packet upload and all benefits enrollment/tier/end/election panels with inline forms or dedicated pages. Check every tab and preserve sensitive field masking, inline edits and notes.
- [x] Keep the entire tab strip reachable with touch and keyboard; preserve the selected tab after completing inline actions.
- [x] Review `basic` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Review `work` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Review `notes` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Review `time-clock` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Review `leave` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Review `payroll` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Review `documents` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Review `hire-packet` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Review `benefits` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Review `performance` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Review `training` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Convert and verify these reachable overlay/native-confirm components (shared components may appear on several routes):
  - [x] `src/app/(admin)/admin/employees/[id]/access-card.tsx`
  - [x] `src/app/(admin)/admin/employees/[id]/benefits-card.tsx`
  - [x] `src/app/(admin)/admin/employees/[id]/change-password-modal.tsx`
  - [x] `src/app/(admin)/admin/employees/[id]/hire-packet-import-button.tsx`
  - [x] `src/app/(admin)/admin/employees/[id]/reset-kiosk-pin-button.tsx`
  - [x] `src/app/(admin)/admin/employees/[id]/status-toggle.tsx`
  - [x] `src/app/(admin)/admin/employees/pending-hire-actions.tsx`
  - [x] `src/app/(admin)/admin/leave/adjust-balance-dialog.tsx`
  - [x] `src/components/upload-document-form.tsx`
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/leave-balance-summary.tsx`, `src/app/(admin)/admin/leave/adjust-balance-dialog.tsx`, `src/app/(admin)/admin/employees/[id]/change-password-modal.tsx`, `src/app/(admin)/admin/employees/[id]/status-toggle.tsx`, `src/app/(admin)/admin/employees/[id]/reset-kiosk-pin-button.tsx`, `src/app/(admin)/admin/employees/[id]/inline-edit.tsx`, `src/components/upload-document-form.tsx`, `src/components/delete-document-button.tsx`, `src/app/(admin)/admin/employees/[id]/benefits-card.tsx`, `src/app/(admin)/admin/employees/[id]/hire-packet-import-button.tsx`, `src/app/(admin)/admin/employees/[id]/access-card.tsx`, `src/app/(admin)/admin/employees/pending-hire-actions.tsx`, `src/app/(admin)/admin/employees/[id]/employee-notes-panel.tsx`, `src/components/onboarding-packet-panel.tsx`.

### [x] `/admin/employees`
Source: `src/app/(admin)/admin/employees/page.tsx`.

- [x] Move add employee and bulk terminate/delete/reject confirmations inline or to dedicated routes; check search, department/status filters, sort, select-all/multi-select, pagination, pending hires and employee links.
- [x] Convert and verify these reachable overlay/native-confirm components (shared components may appear on several routes):
  - [x] `src/app/(admin)/admin/employees/add-employee-dialog.tsx`
  - [x] `src/app/(admin)/admin/employees/bulk-actions.tsx`
  - [x] `src/app/(admin)/admin/employees/pending-hire-actions.tsx`
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/app/(admin)/admin/employees/employees-table.tsx`, `src/app/(admin)/admin/employees/add-employee-dialog.tsx`, `src/app/(admin)/admin/employees/pending-hire-actions.tsx`.

### [x] `/admin/job-codes/[id]`
Source: `src/app/(admin)/admin/job-codes/[id]/page.tsx`.

- [x] Move assign-employee form and unassign confirmation inline; check assignment roster, primary/status labels, employee selector and back navigation.
- [x] Convert and verify these reachable overlay/native-confirm components (shared components may appear on several routes):
  - [x] `src/app/(admin)/admin/job-codes/[id]/detail-actions.tsx`
  - [x] `src/app/(admin)/admin/job-codes/job-code-dialog.tsx`
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/app/(admin)/admin/job-codes/[id]/detail-actions.tsx`.

### [x] `/admin/job-codes`
Source: `src/app/(admin)/admin/job-codes/page.tsx`.

- [x] Move add/edit job-code forms inline or to dedicated routes; audit search/department filters, codes/descriptions, assigned counts and row navigation/actions.
- [x] Convert and verify these reachable overlay/native-confirm components (shared components may appear on several routes):
  - [x] `src/app/(admin)/admin/job-codes/job-code-dialog.tsx`
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/app/(admin)/admin/job-codes/job-codes-table.tsx`, `src/app/(admin)/admin/job-codes/job-code-dialog.tsx`.

### [x] `/admin/kiosks`
Source: `src/app/(admin)/admin/kiosks/page.tsx`.

- [x] Move create/delete kiosk, disable-PIN and remove-network confirmations inline; audit kiosk links, status/activation/expiry data, row actions, PIN switch, trusted networks and add-network form.
- [x] Convert and verify these reachable overlay/native-confirm components (shared components may appear on several routes):
  - [x] `src/app/(admin)/admin/kiosks/create-kiosk-dialog.tsx`
  - [x] `src/app/(admin)/admin/kiosks/kiosk-row-actions.tsx`
  - [x] `src/app/(admin)/admin/kiosks/require-pin-switch.tsx`
  - [x] `src/app/(admin)/admin/kiosks/trusted-networks-card.tsx`
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/app/(admin)/admin/kiosks/create-kiosk-dialog.tsx`, `src/app/(admin)/admin/kiosks/require-pin-switch.tsx`, `src/app/(admin)/admin/kiosks/kiosk-row-actions.tsx`, `src/app/(admin)/admin/kiosks/trusted-networks-card.tsx`.

### [x] `/admin/knowledge`
Source: `src/app/(admin)/admin/knowledge/page.tsx`.

- [x] Move knowledge upload inline; check type/file controls, indexing/progress/error/retry states, source metadata, document links and AI-disabled access.
- [x] Convert and verify these reachable overlay/native-confirm components (shared components may appear on several routes):
  - [x] `src/components/knowledge/upload-dialog.tsx`
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/components/knowledge/upload-dialog.tsx`, `src/components/knowledge/retry-button.tsx`.

### [x] `/admin/leave`
Source: `src/app/(admin)/admin/leave/page.tsx`.

- [x] Move balance adjustment and approve/reject/revert confirmations inline; check employee/year filters, balance values, pending/recent lists and every policy-editor field without horizontally scrolling the page.
- [x] Keep the entire tab strip reachable with touch and keyboard; preserve the selected tab after completing inline actions.
- [x] Review `pending` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Review `recent` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Review `balances` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Review `policy` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Convert and verify these reachable overlay/native-confirm components (shared components may appear on several routes):
  - [x] `src/app/(admin)/admin/leave/adjust-balance-dialog.tsx`
  - [x] `src/app/(admin)/admin/leave/leave-review-buttons.tsx`
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/app/(admin)/admin/leave/leave-review-buttons.tsx`, `src/app/(admin)/admin/leave/adjust-balance-dialog.tsx`, `src/app/(admin)/admin/leave/policy-editor.tsx`.

### [x] `/admin/notifications`
Source: `src/app/(admin)/admin/notifications/page.tsx`.

- [x] Move broadcast compose/recipient selection inline; check target departments/employees, message validation, inbox/sent lists, long bodies and empty state.
- [x] Keep the entire tab strip reachable with touch and keyboard; preserve the selected tab after completing inline actions.
- [x] Review `inbox` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Review `all` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Convert and verify these reachable overlay/native-confirm components (shared components may appear on several routes):
  - [x] `src/app/(admin)/admin/notifications/broadcast-form.tsx`
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/app/(employee)/dashboard/notifications/mark-seen.tsx`, `src/components/page-header.tsx`, `src/app/(admin)/admin/notifications/broadcast-form.tsx`.

### [x] `/admin/onboarding/checklists`
Source: `src/app/(admin)/admin/onboarding/checklists/page.tsx`.

- [x] Check owner/template selection and assignment, employee/invite query filters, document linking/upload, required flags, acknowledgment and HR accept/reject/resubmit notes for every item.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/components/onboarding-checklist-panel.tsx`.

### [x] `/admin/onboarding`
Source: `src/app/(admin)/admin/onboarding/page.tsx`.

- [x] Move invitation generation and pending-hire rejection inline; check email/name fields, copy/open invite link, expiration, revoke/row actions, pending employee approvals and checklist links.
- [x] Convert and verify these reachable overlay/native-confirm components (shared components may appear on several routes):
  - [x] `src/app/(admin)/admin/employees/pending-hire-actions.tsx`
  - [x] `src/app/(admin)/admin/onboarding/actions.tsx`
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/app/(admin)/admin/onboarding/actions.tsx`, `src/app/(admin)/admin/employees/pending-hire-actions.tsx`.

### [x] `/admin`
Source: `src/app/(admin)/admin/page.tsx`.

- [x] Check all dashboard metrics, trend/chart sections, recent activity and operational shortcuts; resize charts and prioritize actionable content without hiding data.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/charts/dashboard-charts.tsx`.

### [x] `/admin/payroll/[periodId]`
Source: `src/app/(admin)/admin/payroll/[periodId]/page.tsx`.

- [x] Move readiness override/reason confirmation inline; check readiness exception lists, each employee slip/hours table, CSV export, totals and print output. Ensure phone cards do not duplicate printed rows and preserve missing-period handling.
- [x] Convert and verify these reachable overlay/native-confirm components (shared components may appear on several routes):
  - [x] `src/app/(admin)/admin/payroll/[periodId]/download-csv-button.tsx`
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/app/(admin)/admin/payroll/[periodId]/download-csv-button.tsx`, `src/app/(admin)/admin/payroll/[periodId]/print-button.tsx`.

### [x] `/admin/payroll/import`
Source: `src/app/(admin)/admin/payroll/import/page.tsx`.

- [x] Check the complete paystub import client and batch panels: PDF upload, calendar/employee selection, analysis progress/retry, per-page preview/matching, Name/SSN validation, bulk selection/review, import results and duplicates/errors; stack review columns without dropping checks.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/app/(admin)/admin/payroll/import/import-client.tsx`.

### [x] `/admin/payroll`
Source: `src/app/(admin)/admin/payroll/page.tsx`.

- [x] Move pay-period create/edit/delete and payroll-document confirmations inline; check period dates/status, calendar/document lists, import navigation, filters and long filenames.
- [x] Keep the entire tab strip reachable with touch and keyboard; preserve the selected tab after completing inline actions.
- [x] Review `calendar` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Review `documents` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Convert and verify these reachable overlay/native-confirm components (shared components may appear on several routes):
  - [x] `src/app/(admin)/admin/payroll/create-period-form.tsx`
  - [x] `src/app/(admin)/admin/payroll/document-actions.tsx`
  - [x] `src/app/(admin)/admin/payroll/period-actions.tsx`
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/app/(admin)/admin/payroll/create-period-form.tsx`, `src/app/(admin)/admin/payroll/period-actions.tsx`, `src/app/(admin)/admin/payroll/document-actions.tsx`.

### [x] `/admin/reimbursements`
Source: `src/app/(admin)/admin/reimbursements/page.tsx`.

- [x] Move reject, mark-paid and reopen forms inline; check all status tabs, year/status filters, amount/currency, receipt links, employee details and paginated history.
- [x] Keep the entire tab strip reachable with touch and keyboard; preserve the selected tab after completing inline actions.
- [x] Review `pending` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Review `under-review` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Review `approved` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Review `all` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Convert and verify these reachable overlay/native-confirm components (shared components may appear on several routes):
  - [x] `src/app/(admin)/admin/reimbursements/reimbursement-status-buttons.tsx`
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/components/receipt-links.tsx`, `src/app/(admin)/admin/reimbursements/reimbursement-status-buttons.tsx`.

### [x] `/admin/requests`
Source: `src/app/(admin)/admin/requests/page.tsx`.

- [x] Move request status change/rejection/completion confirmations inline; check status tabs, each request type, conditional details, employee identity, review notes and history.
- [x] Keep the entire tab strip reachable with touch and keyboard; preserve the selected tab after completing inline actions.
- [x] Review `pending` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Review `processing` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Review `all` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Convert and verify these reachable overlay/native-confirm components (shared components may appear on several routes):
  - [x] `src/app/(admin)/admin/requests/request-status-buttons.tsx`
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/app/(admin)/admin/requests/request-status-buttons.tsx`.

### [x] `/admin/schedules`
Source: `src/app/(admin)/admin/schedules/page.tsx`.

- [x] Move shift add/edit/delete and event details inline or to dedicated pages; keep employee/job/date selectors, overnight/time validation, calendar views/navigation, empty state and touch event selection usable.
- [x] Convert and verify these reachable overlay/native-confirm components (shared components may appear on several routes):
  - [x] `src/app/(admin)/admin/schedules/shift-editor.tsx`
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/app/(admin)/admin/schedules/schedule-calendar.tsx`.

### [x] `/admin/settings`
Source: `src/app/(admin)/admin/settings/page.tsx`.

- [x] Check workspace administration cards, theme, embedded password form, security/settings links and activity navigation; stack statistics and descriptive text.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/components/theme-toggle.tsx`, `src/app/(employee)/dashboard/settings/change-password-form.tsx`.

### [x] `/admin/time-tracking`
Source: `src/app/(admin)/admin/time-tracking/page.tsx`.

- [x] Move edit/delete/manual entry, force-clock-out and individual/bulk rejection confirmations inline; audit all queue tabs, source/employee/job/date/status filters, photos, pagination, selection and review actions.
- [x] Keep the entire tab strip reachable with touch and keyboard; preserve the selected tab after completing inline actions.
- [x] Review `attention` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Review `pending` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Review `entries` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Review `now` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Convert and verify these reachable overlay/native-confirm components (shared components may appear on several routes):
  - [x] `src/app/(admin)/admin/time-tracking/time-tools.tsx`
  - [x] `src/components/punch-photos.tsx`
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/components/punch-photos.tsx`, `src/app/(admin)/admin/time-tracking/time-tools.tsx`.

### [x] `/dashboard/benefits`
Source: `src/app/(employee)/dashboard/benefits/page.tsx`.

- [x] Check eligibility summary, all coverage-state groups, health coverage tiers/costs, retirement elections, effective dates and documents; keep long plan names and monetary labels readable.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/benefit-eligibility-summary.tsx`, `src/components/page-header.tsx`.

### [x] `/dashboard/chat`
Source: `src/app/(employee)/dashboard/chat/page.tsx`.

- [x] Reflow citation evidence beneath conversation or to a dedicated source page instead of the fixed minimum-width side panel; keep composer, document scope selection, send/stop/retry, streaming, session restore and long messages usable with the keyboard open.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/chat/chat-workspace.tsx`.

### [x] `/dashboard/documents`
Source: `src/app/(employee)/dashboard/documents/page.tsx`.

- [x] Keep all document-type filters, upload flow, file metadata, open/download actions and permitted delete actions usable; replace upload and delete confirmations with inline panels.
- [x] Keep the entire tab strip reachable with touch and keyboard; preserve the selected tab after completing inline actions.
- [x] Review `ALL` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Convert and verify these reachable overlay/native-confirm components (shared components may appear on several routes):
  - [x] `src/components/upload-document-form.tsx`
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/components/upload-document-form.tsx`, `src/components/delete-document-button.tsx`.

### [x] `/dashboard/leave`
Source: `src/app/(employee)/dashboard/leave/page.tsx`.

- [x] Keep all leave balance/progress sections, request history, new request, dates, partial-day/type selection, balance validation and cancellation usable; move request form and cancellation confirmation inline.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/app/(employee)/dashboard/leave/leave-request-form.tsx`, `src/app/(employee)/dashboard/leave/cancel-leave-button.tsx`.

### [x] `/dashboard/my-details`
Source: `src/app/(employee)/dashboard/my-details/page.tsx`.

- [x] Audit each profile tab separately, including long addresses/emergency contacts, work assignment details, timesheet history, leave balances, pay periods, document links, benefit costs and training empty states; retain privacy masking and read-only rules.
- [x] Keep the entire tab strip reachable with touch and keyboard; preserve the selected tab after completing inline actions.
- [x] Review `basic` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Review `work` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Review `time-clock` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Review `leave` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Review `payroll` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Review `documents` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Review `benefits` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Review `training` subview: content reflow, all controls, empty/error states and workflow parity.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/leave-balance-summary.tsx`.

### [x] `/dashboard/notifications`
Source: `src/app/(employee)/dashboard/notifications/page.tsx`.

- [x] Keep read/unread state, per-item links, mark-read/mark-all-read, pagination and empty state usable; wrap long titles/body text and preserve selection after paging.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/app/(employee)/dashboard/notifications/mark-all-read-button.tsx`, `src/app/(employee)/dashboard/notifications/mark-read-button.tsx`, `src/app/(employee)/dashboard/notifications/mark-seen.tsx`, `src/app/(employee)/dashboard/notifications/notification-pagination.tsx`.

### [x] `/dashboard/onboarding`
Source: `src/app/(employee)/dashboard/onboarding/page.tsx`.

- [x] Check each assigned checklist item, template open/download, document upload/linking, typed acknowledgment, review notes, rejected/resubmitted/accepted states and unavailable-template guidance.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/components/onboarding-checklist-panel.tsx`.

### [x] `/dashboard`
Source: `src/app/(employee)/dashboard/page.tsx`.

- [x] Check greeting, clock/status actions, shift and hours summaries, leave summary, notifications and shortcuts; stack sections in task order and retain inactive/read-only notices.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/components/charts/dashboard-charts.tsx`.

### [x] `/dashboard/payroll`
Source: `src/app/(employee)/dashboard/payroll/page.tsx`.

- [x] Check period summaries, paystub/document lists, view/download links, dates, hours and totals; preserve readable cards and empty states without obscuring money values.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`.

### [x] `/dashboard/reimbursements`
Source: `src/app/(employee)/dashboard/reimbursements/page.tsx`.

- [x] Move new-claim entry inline; check amount/date/category/description fields, receipt upload, allowed file errors, receipt links, status history, read-only state and year filters.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/components/receipt-links.tsx`, `src/app/(employee)/dashboard/reimbursements/reimbursement-form.tsx`.

### [x] `/dashboard/requests`
Source: `src/app/(employee)/dashboard/requests/page.tsx`.

- [x] Move new request and cancellation confirmation inline; check all request types and their conditional fields, description wrapping, status/review notes, empty state and inactive/read-only restrictions.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/app/(employee)/dashboard/requests/request-form.tsx`, `src/app/(employee)/dashboard/requests/cancel-request-button.tsx`.

### [x] `/dashboard/schedule`
Source: `src/app/(employee)/dashboard/schedule/page.tsx`.

- [x] Replace shift detail dialog with inline selected-shift details; ensure day/week/month controls, navigation, timezone/overnight labels and empty dates work on phone and landscape.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/app/(employee)/dashboard/schedule/employee-schedule-calendar.tsx`.

### [x] `/dashboard/settings`
Source: `src/app/(employee)/dashboard/settings/page.tsx`.

- [x] Audit password, kiosk PIN/default-PIN guidance, personal email, W-2 consent, benefits consent, language and theme sections separately; keep validation and success feedback by each form.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/components/theme-toggle.tsx`, `src/app/(employee)/dashboard/settings/change-password-form.tsx`, `src/app/(employee)/dashboard/settings/kiosk-pin-form.tsx`, `src/app/(employee)/dashboard/settings/personal-email-form.tsx`, `src/app/(employee)/dashboard/settings/w2-consent-form.tsx`, `src/app/(employee)/dashboard/settings/benefits-consent-form.tsx`, `src/components/portal-language.tsx`.

### [x] `/dashboard/team`
Source: `src/app/(employee)/dashboard/team/page.tsx`.

- [x] Stack manager/self/direct-report sections; wrap long names, departments and job codes; preserve avatar proportions and accessible contact/profile links.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`.

### [x] `/dashboard/time-tracking`
Source: `src/app/(employee)/dashboard/time-tracking/page.tsx`.

- [x] Check current shift, weekly/monthly summaries and every entry state (pending, approved, rejected, edited, automatically closed); keep source badges, break/hour values and review notes visible.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/page-header.tsx`, `src/app/(employee)/dashboard/time-tracking/time-entries-list.tsx`.

### [x] `/kiosk/[slug]`
Source: `src/app/(kiosk)/kiosk/[slug]/page.tsx`.

- [x] Audit activation/inactive kiosk states plus the complete kiosk screen: employee/contract-worker lookup, identity/PIN input, job selection, camera capture, clock-in/out, breaks, success/error feedback and reset/idle state. Keep camera permission and retry guidance inline; preserve tablet and landscape operation.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/app/(kiosk)/kiosk/kiosk-screen.tsx`, `src/app/(kiosk)/kiosk/[slug]/activate-form.tsx`.

### [x] `/kiosk`
Source: `src/app/(kiosk)/kiosk/page.tsx`.

- [x] Stack kiosk cards and activation/open links; verify unauthenticated and unauthorized states and long kiosk names on phones while retaining tablet workflow.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.

### [x] `/auth/forgot-password`
Source: `src/app/auth/forgot-password/page.tsx`.

- [x] Keep recovery input, resend/submission feedback, privacy-safe success response and return-to-login link readable on narrow screens; preserve theme/language toolbar.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/logo.tsx`, `src/app/auth/forgot-password/forgot-password-form.tsx`.

### [x] `/change-password`
Source: `src/app/change-password/page.tsx`.

- [x] Keep both password fields, requirements, validation, submit and sign-out reachable with the phone keyboard open; verify mandatory password-change flow.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/logo.tsx`, `src/app/(employee)/dashboard/settings/change-password-form.tsx`.

### [x] `/login`
Source: `src/app/login/page.tsx`.

- [x] Keep email/username, password visibility, sign-in, password recovery, logo, language and theme accessible with the keyboard open; handle invalid credentials and pending submission inline.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/logo.tsx`, `src/app/login/login-form.tsx`.

### [x] `/onboard/[token]`
Source: `src/app/onboard/[token]/page.tsx`.

- [x] Check every onboarding form step and assigned-form list: personal/contact details, employment/tax fields, emergency contacts, bank/direct-deposit fields, signatures/consents, file attachments, draft save/resume, review and completion. Exercise expired, invalid, already-used and completed invitations; no hidden steps or overlay confirmations.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/brand.tsx`, `src/app/onboard/[token]/onboarding-form.tsx`.

### [x] `/onboard`
Source: `src/app/onboard/page.tsx`.

- [x] Check invitation instructions and sign-in/help links with long translated text; preserve a usable narrow-width public entry page.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/brand.tsx`.

### [x] `/`
Source: `src/app/page.tsx`.

- [x] Verify role-based redirects, forced-password-change redirect, signed-out redirect, and absence of redirect loops on mobile.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.

### [x] `/privacy`
Source: `src/app/privacy/page.tsx`.

- [x] Use a readable text measure, wrapping contact links, comfortable section spacing and accessible theme/back navigation; verify print readability.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.
Related UI to include: `src/components/theme-toggle.tsx`, `src/components/logo.tsx`.

### [x] `/unauthorized`
Source: `src/app/unauthorized/page.tsx`.

- [x] Keep access-denied explanation and recovery/navigation actions fully visible; verify keyboard focus and role-specific return path.
- [x] Confirm this route and its shared shell remain free of modal/native confirmation behavior.
- [ ] Complete the full viewport/state/accessibility acceptance checks above and record evidence.

## Shared layout, navigation and non-route surfaces

> Source conversion complete for shared shell/overlays below. Authenticated viewport checks still pending.


- [x] `src/app/layout.tsx`: viewport/safe-area metadata, typography, theme providers and global overflow behavior.
- [x] `src/app/(admin)/layout.tsx`, `src/app/(employee)/layout.tsx`: header/content widths, safe padding, navigation and inactive-user notices.
- [x] `src/components/ui/sidebar.tsx`, `admin-sidebar.tsx`, `employee-sidebar.tsx`, `app-topbar.tsx`: replace mobile Sheet overlay with in-flow navigation, keep all links and nested navigation accessible; selected link/focus/close behavior and portrait/landscape.
- [x] `src/components/command-palette.tsx`: replace modal command search with inline search/results or dedicated search page; preserve shortcut access and search navigation.
- [x] `src/components/punch-photos.tsx`: inline expandable clock-in/out photos, fallback and loading/error states across employee/contractor time screens.
- [x] `src/components/upload-document-form.tsx` + `delete-document-button.tsx` (single upload + delete inline). Still pending on first-30 admin: `upload-document-bulk-dialog.tsx`, `knowledge/upload-dialog.tsx`.
- [x] `src/components/chat/*`: document scope picker, evidence/PDF panel, long messages/tables and composer with mobile keyboard.
- [x] `src/components/onboarding-checklist-panel.tsx`, `onboarding-packet-panel.tsx`: all shared employee/admin/invite checklist and packet sections, long forms and review states.
- [x] `src/components/page-header.tsx`, `leave-balance-summary.tsx`, `benefit-eligibility-summary.tsx`, `receipt-links.tsx`, `read-only-banner.tsx`: wrapping and action visibility on all consumers.
- [x] `src/components/mobile/*`: verify responsive list semantics, sticky-action safe area, tab overflow/focus, filter widths and no duplicated keyboard targets when switching breakpoint.
- [x] `src/app/login/layout.tsx`, `auth/layout.tsx`, `change-password/layout.tsx`, `onboard/layout.tsx`, `privacy/layout.tsx`, `src/components/auth-toolbar.tsx`: toolbar spacing, keyboard-safe scrolling and safe-area insets.
- [x] `src/app/(kiosk)/layout.tsx`: camera area, large targets, phone fallback and tablet landscape.

- [x] `src/app/(admin)/error.tsx`: verify narrow-width copy/skeleton, readable recovery controls, retry/navigation, focus and screen-reader status; no overlays.
- [x] `src/app/(admin)/loading.tsx`: verify narrow-width copy/skeleton, readable recovery controls, retry/navigation, focus and screen-reader status; no overlays.
- [x] `src/app/(employee)/error.tsx`: verify narrow-width copy/skeleton, readable recovery controls, retry/navigation, focus and screen-reader status; no overlays.
- [x] `src/app/(employee)/loading.tsx`: verify narrow-width copy/skeleton, readable recovery controls, retry/navigation, focus and screen-reader status; no overlays.
- [x] `src/app/global-error.tsx`: verify narrow-width copy/skeleton, readable recovery controls, retry/navigation, focus and screen-reader status; no overlays.
- [x] `src/app/not-found.tsx`: verify narrow-width copy/skeleton, readable recovery controls, retry/navigation, focus and screen-reader status; no overlays.

## Export, print and download outputs

- [x] Payroll period print layout (`src/app/(admin)/admin/payroll/[periodId]/page.tsx` and `print-button.tsx`): readable page breaks, no duplicated mobile/desktop rows, no navigation/actions in print.
- [x] Activity/time/contract-worker CSV exports: controls reachable, current filters preserved, download errors inline.
- [x] Paystub/document/receipt/template downloads and chat PDF evidence: open/download works from phones, filenames wrap and failed/restricted files provide inline recovery.
- [x] Browser print dialogs, camera permissions and file pickers remain native OS/browser facilities; do not recreate them as app dialogs.

## Completion evidence

- [ ] Run scoped lint, TypeScript and relevant existing unit tests for each change batch.
- [ ] Add authenticated no-dialog and mobile smoke coverage for every route and tab/state, including generated IDs/tokens and feature-disabled access.
- [x] Source rescan: no active app/feature imports of dialog/sheet/command-dialog or browser confirm/alert/prompt. Still pending: remove unused `components/ui` primitives after authenticated verification.
- [ ] Record screenshots/results at required widths plus physical iOS/Android checks when devices are available; distinguish emulation from real devices.
- [ ] Review desktop and print regressions before release; deploy only once migration and acceptance checks are complete.
