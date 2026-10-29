# Full UI dialog and overlay audit

Date: 2026-10-29. Rescanned 2026-10-29 15:05 CT. Conversion checklist below; **Verify** boxes stay open until authenticated/device evidence exists.

## Requirement

No task dialogs on any screen size. Forms, reviews, viewers and confirmations render in their owning page or on a dedicated page. Do not replace task dialogs with sheets. Preserve validation, permissions, pending/error handling, reasons and destructive confirmations.

## Counts and coverage

- Baseline (pre-migration): 59 dialog/alert/command content sites across 41 consumer TSX files; 9 native confirms; 1 mobile Sheet.
- **Current source:** 0 consumer Dialog/AlertDialog/CommandDialog/Sheet task overlays; 0 `window.confirm` / `aria-modal` / `role="dialog"` outside unused `components/ui` primitives (`dialog`, `alert-dialog`, `sheet`, and `CommandDialog` inside `command.tsx`).
- All conversion items marked source-complete. Every **Verify** checkbox remains open.

## Forms, reviews, viewers and task confirmations

### D01. Command palette

- [x] Inline navigation search; Ctrl/Cmd+K focuses the search field; preserve role-filtered results and keyboard selection.
- Owners: `/admin/*; /dashboard/*`.
- Source: `src/components/command-palette.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D02. Punch photos: clock-in and clock-out

- [x] Expandable selected-record photo section; preserve timestamps, expired/missing states, retention text and image errors.
- Owners: `/admin/time-tracking; /admin/contract-workers (Hours, On site); /admin/contract-workers/[id]`.
- Source: `src/components/punch-photos.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D03. Upload document

- [x] Inline document upload form, preserving employee binding, category/title/file checks, progress and reset.
- Owners: `/dashboard/documents; /admin/employees/[id] Documents`.
- Source: `src/components/upload-document-form.tsx` (renamed from dialog).
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

- Source conversion implemented; browser/device verification remains pending.

### D04. Upload to employees

- [x] Dedicated /admin/documents/upload page; keep employee search, select-visible/all, selected counts and per-upload feedback.
- Owners: `/admin/documents`.
- Source: `src/components/upload-document-bulk-dialog.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D05. Upload knowledge document

- [x] Inline library upload section with status and retry.
- Owners: `/admin/knowledge`.
- Source: `src/components/knowledge/upload-dialog.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D06. Request leave

- [x] Inline form preserving balances, types, dates, days calculation, notes and translations.
- Owners: `/dashboard/leave`.
- Source: `src/app/(employee)/dashboard/leave/leave-request-dialog.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

- Current implementation: `src/app/(employee)/dashboard/leave/leave-request-form.tsx` (renamed from baseline dialog file).

- Source conversion implemented in this turn; browser/device verification remains pending.

### D07. New request

- [x] Inline request form preserving type-dependent fields and validation.
- Owners: `/dashboard/requests`.
- Source: `src/app/(employee)/dashboard/requests/request-dialog.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

- Current implementation: `src/app/(employee)/dashboard/requests/request-form.tsx` (renamed from baseline dialog file).

- Source conversion implemented in this turn; browser/device verification remains pending.

### D08. New claim

- [x] Inline claim form retaining category, amount, date, receipts and validation.
- Owners: `/dashboard/reimbursements`.
- Source: `src/app/(employee)/dashboard/reimbursements/reimbursement-dialog.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

- Current implementation: `src/app/(employee)/dashboard/reimbursements/reimbursement-form.tsx` (renamed from baseline dialog file).

- Source conversion implemented in this turn; browser/device verification remains pending.

### D09. Shift detail

- [x] Inline selected-shift detail below calendar/agenda, with clear dismiss and focus.
- Owners: `/dashboard/schedule`.
- Source: `src/app/(employee)/dashboard/schedule/employee-schedule-calendar.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

- Source conversion implemented in this turn; browser/device verification remains pending.

### D10. Plan code and documents

- [x] Move into existing /admin/benefits/[id]/edit page; preserve version checks and resource selection.
- Owners: `/admin/benefits`.
- Source: `src/app/(admin)/admin/benefits/plan-metadata-editor.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D11. Roll forward plan

- [x] Dedicated /admin/benefits/[id]/roll-forward page preserving dates, rate options and source-plan context.
- Owners: `/admin/benefits`.
- Source: `src/app/(admin)/admin/benefits/roll-forward-dialog.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D12. Add agency; edit agency

- [x] Inline agency editor above the list, outside table rows, preserving contact and active fields.
- Owners: `/admin/contract-workers Agencies`.
- Source: `src/app/(admin)/admin/contract-workers/agencies-tab.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D13. Reject one/selected hours; edit times

- [x] Inline selected-record/batch review section retaining selected IDs, required notes, dates, breaks and validation.
- Owners: `/admin/contract-workers Hours`.
- Source: `src/app/(admin)/admin/contract-workers/hours-table.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D14. Add worker; edit worker; make active/inactive; end assignment; reactivate; clock out

- [x] Dedicated /admin/contract-workers/new and /admin/contract-workers/[id]/edit for long forms; inline lifecycle confirmations preserving dates, reasons and assignment semantics.
- Owners: `/admin/contract-workers Workers and On site`.
- Source: `src/app/(admin)/admin/contract-workers/worker-dialogs.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D15. New department; edit department

- [x] Inline create and detail-page edit sections preserving lead and field validation.
- Owners: `/admin/departments`.
- Source: `src/app/(admin)/admin/departments/department-dialog.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D16. Delete department

- [x] Inline selected-department confirmation retaining dependency errors and cancel.
- Owners: `/admin/departments`.
- Source: `src/app/(admin)/admin/departments/department-actions.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D17. New employee

- [x] Dedicated /admin/employees/new page retaining all fields, duplicate checks and assignments.
- Owners: `/admin/employees`.
- Source: `src/app/(admin)/admin/employees/add-employee-dialog.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D18. Terminate selected; delete selected employees

- [x] Inline batch review above list retaining names/count, dates/reasons, skipped records and typed deletion protection.
- Owners: `/admin/employees`.
- Source: `src/app/(admin)/admin/employees/bulk-actions.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D19. Reject pending hire

- [x] Inline selected-hire rejection confirmation preserving server state checks.
- Owners: `/admin/employees Pending hires`.
- Source: `src/app/(admin)/admin/employees/pending-hire-actions.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D20. Make admin; remove admin access

- [x] Inline access-card confirmation retaining last-admin/self guards and sign-out consequence text.
- Owners: `/admin/employees/[id]`.
- Source: `src/app/(admin)/admin/employees/[id]/access-card.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D21. New enrollment; change tier; end enrollment; new 401(k) election; end 401(k) election

- [x] Inline mutually exclusive benefit forms retaining effective/end dates, age rates, tier and election validation.
- Owners: `/admin/employees/[id] Benefits`.
- Source: `src/app/(admin)/admin/employees/[id]/benefits-card.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D22. Reset password

- [x] Inline security form preserving password rules, visibility and sensitive-field clearing.
- Owners: `/admin/employees/[id]`.
- Source: `src/app/(admin)/admin/employees/[id]/change-password-modal.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D23. Import hire packet

- [x] Inline upload section; link to existing /admin/employees/[id]/hire-import/[jobId] review after creation.
- Owners: `/admin/employees/[id]`.
- Source: `src/app/(admin)/admin/employees/[id]/hire-packet-import-button.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D24. Terminate employee; edit termination; make inactive

- [x] Inline employment-status form/confirmation preserving date, reason, inactive semantics and termination grace text.
- Owners: `/admin/employees/[id]`.
- Source: `src/app/(admin)/admin/employees/[id]/status-toggle.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D25. New job code; edit job code

- [x] Inline create or /admin/job-codes/new; edit on detail page preserving department and rate fields.
- Owners: `/admin/job-codes; /admin/job-codes/[id]`.
- Source: `src/app/(admin)/admin/job-codes/job-code-dialog.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D26. Assign employee

- [x] Inline searchable assignment section retaining edit entry point and unassign behavior.
- Owners: `/admin/job-codes/[id]`.
- Source: `src/app/(admin)/admin/job-codes/[id]/detail-actions.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D27. New kiosk

- [x] Inline creation section retaining slug validation, location and resulting kiosk link.
- Owners: `/admin/kiosks`.
- Source: `src/app/(admin)/admin/kiosks/create-kiosk-dialog.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D28. Delete kiosk

- [x] Inline selected-kiosk confirmation retaining warning and session consequences.
- Owners: `/admin/kiosks`.
- Source: `src/app/(admin)/admin/kiosks/kiosk-row-actions.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D29. Turn off PIN requirement

- [x] Inline security confirmation; cancelling must not persist the switch.
- Owners: `/admin/kiosks`.
- Source: `src/app/(admin)/admin/kiosks/require-pin-switch.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D30. Remove network

- [x] Inline selected-network confirmation with identity, pending and failure states.
- Owners: `/admin/kiosks`.
- Source: `src/app/(admin)/admin/kiosks/trusted-networks-card.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D31. Adjust leave balance

- [x] Inline employee/type adjustment form preserving reason and balance refresh.
- Owners: `/admin/leave`.
- Source: `src/app/(admin)/admin/leave/adjust-balance-dialog.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D32. Approve leave; reject leave; cancel approved leave

- [x] Inline selected-leave review retaining optional/required notes, overrides, balances and notifications.
- Owners: `/admin/leave`.
- Source: `src/app/(admin)/admin/leave/leave-review-buttons.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D33. Send broadcast

- [x] Dedicated /admin/notifications/new retaining recipient selection, count, message and sent feedback.
- Owners: `/admin/notifications`.
- Source: `src/app/(admin)/admin/notifications/broadcast-form.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D34. Generate onboarding invite; generated link

- [x] Inline form and result preserving invite options, expiry, copy and reset.
- Owners: `/admin/onboarding`.
- Source: `src/app/(admin)/admin/onboarding/actions.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D35. New pay period

- [x] Inline title/date-range form.
- Owners: `/admin/payroll`.
- Source: `src/app/(admin)/admin/payroll/create-period-form.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D36. Edit pay period

- [x] Inline selected-period editor or existing period detail page, preserving attached documents.
- Owners: `/admin/payroll`.
- Source: `src/app/(admin)/admin/payroll/period-actions.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D37. Override payroll readiness

- [x] Inline export-readiness override preserving required reason, permissions, audit and gated download.
- Owners: `/admin/payroll/[periodId]`.
- Source: `src/app/(admin)/admin/payroll/[periodId]/download-csv-button.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D38. Reject claim; mark paid; reopen claim

- [x] Inline selected-claim review preserving reason, payment date/reference and transition rules.
- Owners: `/admin/reimbursements`.
- Source: `src/app/(admin)/admin/reimbursements/reimbursement-status-buttons.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D39. Mark processing; complete; reject; reopen

- [x] Inline selected-request review retaining transition rules, notes/reasons and notifications.
- Owners: `/admin/requests`.
- Source: `src/app/(admin)/admin/requests/request-status-buttons.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D40. New shift; edit shift; delete shift

- [x] Inline calendar editor or dedicated new/edit pages; inline deletion confirmation. Preserve employee multi-select, repeated weekdays, conflicts, recurrence and date/time controls.
- Owners: `/admin/schedules`.
- Source: `src/app/(admin)/admin/schedules/shift-editor.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### D41. Edit entry; delete entry; force clock-out; manual entry; reject single; reject selected entries

- [x] Inline selected-record/batch review outside tables, or dedicated new-entry page; preserve breaks, job codes, required reasons, reopen and audit trail.
- Owners: `/admin/time-tracking`.
- Source: `src/app/(admin)/admin/time-tracking/time-tools.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

## Native browser confirmations

### N01. Delete document

- [x] Inline document-row confirmation retaining translated title-specific warning and permission checks.
- Owners: `/dashboard/documents; /admin/documents; /admin/employees/[id]`.
- Source: `src/components/delete-document-button.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

- Source conversion implemented in this turn; browser/device verification remains pending.

### N02. Cancel pending/approved leave

- [x] Inline request confirmation retaining approved-vs-pending warning and balance behavior.
- Owners: `/dashboard/leave`.
- Source: `src/app/(employee)/dashboard/leave/cancel-leave-button.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

- Source conversion implemented in this turn; browser/device verification remains pending.

### N03. Withdraw request

- [x] Inline request confirmation retaining translation and pending lockout.
- Owners: `/dashboard/requests`.
- Source: `src/app/(employee)/dashboard/requests/cancel-request-button.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

- Source conversion implemented in this turn; browser/device verification remains pending.

### N04. Deactivate plan

- [x] Inline selected-plan confirmation retaining past-coverage and future-enrollment warning.
- Owners: `/admin/benefits`.
- Source: `src/app/(admin)/admin/benefits/deactivate-plan-button.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### N05. Mark all open enrollments/elections verified

- [x] Inline batch confirmation with scope summary and explicit confirm/cancel.
- Owners: `/admin/benefits`.
- Source: `src/app/(admin)/admin/benefits/mark-verified-button.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### N06. Reset worker kiosk PIN

- [x] Inline security confirmation retaining temporary-PIN consequences.
- Owners: `/admin/contract-workers Workers`.
- Source: `src/app/(admin)/admin/contract-workers/worker-dialogs.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### N07. Reset employee kiosk PIN

- [x] Inline access/security confirmation retaining temporary-PIN consequences.
- Owners: `/admin/employees/[id]`.
- Source: `src/app/(admin)/admin/employees/[id]/reset-kiosk-pin-button.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### N08. Delete uploaded payroll document

- [x] Inline file confirmation retaining permanent deletion and employee-visibility warning.
- Owners: `/admin/payroll`.
- Source: `src/app/(admin)/admin/payroll/document-actions.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

### N09. Delete pay period

- [x] Inline period confirmation retaining period/slip removal versus unaffected uploaded documents.
- Owners: `/admin/payroll`.
- Source: `src/app/(admin)/admin/payroll/period-actions.tsx`.
- [ ] Verify trigger, cancel/back, success, validation/error and keyboard focus at phone and desktop widths.

## Navigation, primitives and controls

- [x] `src/components/ui/sidebar.tsx`: mobile Sheet replaced with nonmodal in-page expandable navigation region, preserving role links, active state, keyboard focus, close behavior, route changes and desktop sidebar. Owners: all admin and employee pages through group layouts.
- [x] `src/components/command-palette.tsx`: modal CommandDialog replaced with inline search; shortcut focuses the field. `command.tsx` primitive retained for cmdk.
- [ ] Remove unused Dialog, AlertDialog, Sheet and CommandDialog exports after verification (primitives still present, unused by app consumers).
- [x] Review `app-topbar.tsx`, `user-menu.tsx`, admin/employee sidebars and group layouts for navigation on touch; menu actions launch only inline/page tasks (source). Runtime touch verify pending.

Small dropdowns, selects, tooltips, date pickers and operating-system file pickers are controls rather than task dialogs. Keep them usable within the viewport. If a popover contains a task form or confirmation, move that task inline or to a page.

- [x] Calendar: admin `schedule-calendar.tsx` opens inline `ShiftEditor`; employee calendar uses inline selected-shift detail. No Schedule-X event-modal plugin. Runtime verify pending.
- [ ] Date picker in `schedules/shift-editor.tsx`: verify popover bounds on phone after inline move.
- [x] Review dropdown actions on employee rows, requests, kiosks and job codes for migrated destinations (source).
- [x] Kiosk pages use page-level steps; no additional bespoke task-modal implementation found. Test camera/file-permission and photo workflows without adding app dialogs.

## Other scan findings

No additional bespoke fixed-position/lightbox task overlays or custom `role="dialog"` / `aria-modal` surfaces were found outside shared primitives. `createPortalTranslator` is a translation helper, not a React portal. Company document library and batch-paystub workspace use page-level editors in the inspected source; still include their full mobile page checks. Native browser/OS permission prompts are outside application task-dialog rendering.

## Completion gates

- [x] Rescan source/imports (2026-10-29): no live task consumer of Dialog, AlertDialog or CommandDialog; no modal Sheet navigation (unused `components/ui` primitives remain).
- [x] Rescan native confirm/alert/prompt calls: none in app/feature TSX (local helpers named `confirm` excluded).
- [ ] Update E2E selectors that expect role=dialog or modal dismissal; assert inline regions, routes and return links.
- [ ] Test direct load, refresh/back, unsaved input, repeated triggers, focus, permissions and disabled/pending states.
- [ ] Verify every action variant above at 320px, 390px, 768px, desktop and short landscape height, including Spanish and long names.
- [ ] Destructive mutations still require explicit in-page confirmation; opening a section cannot execute the mutation. *(source uses InlineConfirmAction/InlinePanel — runtime prove pending)*
