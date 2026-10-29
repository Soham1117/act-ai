# Mobile/no-dialog implementation — routes 21–30

Date: 2026-10-29. Source implementation complete for this batch. Authenticated whole-route and real-device acceptance remain separate pending gates coordinated by the parent agent. Existing business server actions, validation and permissions were retained.

| # | Route | Implementation / source review |
|---|---|---|
| 21 | `/admin/notifications` | Broadcast now expands below PageHeader using `broadcast-form.tsx`. Associated field labels, phone-first form and department checkbox grids, 44px audience labels, pending-safe trigger/cancel. Inbox/sent tabs retained; messages already wrap. |
| 22 | `/admin/onboarding/checklists` | Reviewed checklist route and its filtered employee/invite/template/item inputs, empty state and navigation. No task dialogs in route source. Shared checklist controls reviewed/updated by parent owner; do not count this source review as server/browser acceptance. |
| 23 | `/admin/onboarding` | Invite generation moved below PageHeader into inline form. Field labels, stacking, generated-link input, accessible copy/revoke labels, wrapped invite row actions and phone touch targets. Existing generated URL, expiry/account approval, manual clipboard fallback and permissions retained. |
| 24 | `/admin` | Reviewed all overview/operations dashboard chart cards, summaries, notices, employee/activity rows, action links and existing responsive layout. Existing min-width containment and responsive chart grids retained; no task dialogs in route source. |
| 25 | `/admin/payroll/[periodId]` | Payroll-readiness export override now inline below PageHeader, preserving minimum reason length and audited export action. Print action retained separately; readiness and slip mobile cards remain. Parent handles shared ResponsiveDataList print visibility. |
| 26 | `/admin/payroll/import` | Reviewed dedicated import workflow and pay-period locking. Batch table remains a local horizontal data region, now labeled and keyboard-focusable. Employee selector has mobile 44px height/16px type. Upload, OCR/retry, bulk selection/review, assignment/date reasons, duplicates and final status logic retained. |
| 27 | `/admin/payroll` | New period form below header, date fields stack on phone; edit panel sits below period summary rather than in an auto-width row. Edit/delete/open/download touch targets enlarged. Period/document deletion now explicit inline confirmation with existing consequence copy, pending lockout and failed-action retention. Document controls get full grid row. |
| 28 | `/admin/reimbursements` | Reject/partial-pay/reopen editors now in-page panels in a full-width row beneath the claim summary. Labels associated; paid amount/reason constraints and transition permissions retained; mobile review trigger enlarged. Long descriptions wrap. |
| 29 | `/admin/requests` | Processing/complete/reject/reopen notes now in-page review section in a full-width row. Required reason logic, state transitions, pending and errors retained; associated note label and larger action trigger. |
| 30 | `/admin/schedules` | New/edit shift task now `shift-editor.tsx`, inline above calendar. Nested delete confirmation is an inline section. Single/range date/time grids stack on phone; weekday/employee actions enlarged and wrap; search reserves room for Select all, labels associate with date/time/job/notes controls. Calendar responsive month/agenda/day/list behavior and Chicago/DST logic retained. |

## Completed checks

- Scoped ESLint for all owned route directories plus admin home: passed.
- Project TypeScript check after migration: passed.
- Source scan of owned route directories: no imports of Dialog/AlertDialog/Sheet APIs, browser confirm/alert/prompt calls, or task modal JSX remain.
- Isolated Playwright fixture renders the actual BroadcastForm, OnboardingActions, CreatePayrollPeriodForm, PeriodActions, DownloadCsvButton, RequestStatusButtons, ReimbursementStatusButtons and ShiftEditor. Server actions are stubbed; this is not authenticated integration coverage.
- Eight expanded panels tested at 320×844, 390×844, 768×1024, 1440×900 and 844×390: no task dialog/alertdialog/aria-modal, no horizontal document overflow. Opening the shift editor initially exposed min-content overflow; corrected with min-width containment and parent shared panel grid fix.
- Additional fixture checks cover request rejection required reasons and partial-payment required notes; failed stub actions keep notes and amount values.
- Harness: `apps/web/.foreman/verify-mobile-routes-21-30.mjs`. Results/captures: `apps/web/.foreman/mobile-routes21-30/`.

## Remaining verification limits

- Full authenticated route sweep, direct-link/back behavior, role/data combinations, actual server-action writes, uploaded PDF/OCR/receipt inputs, download contents, real printing and calendar event changes require integration evidence.
- Physical iPhone/Android checks, virtual keyboard/file picker behavior and device-specific printing remain pending.
- No deployment performed.
