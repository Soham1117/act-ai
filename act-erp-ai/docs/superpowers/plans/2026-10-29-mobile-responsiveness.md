# Application-wide no-dialog and mobile implementation TODO

Date: 2026-10-29. Status: inventory complete; implementation started; full application migration and authenticated/device verification pending.

## Product rule

No application dialogs at any viewport size. Forms, record details, evidence viewers, reviews and confirmations belong in normal page flow or on dedicated routes. Do not substitute a Sheet, bottom sheet, portal or CSS-hidden modal. Navigation search and mobile navigation must also work without modal overlays. Ordinary select/date menus may remain controls, but must not host whole tasks. Browser/OS file selection, printing and permission prompts remain browser/OS functions.

Preserve all existing actions, business validation, authorization, translations, filtering, drafts, uploads, audit behavior and destructive confirmation. Keep user-entered values on failures. Never remove confirmation simply to remove a dialog.

## Exhaustive work lists

- [x] Audit every current page source and reachable UI component graph: **57 page routes**, **44 tab/subview entries**, and six loading/error/not-found surfaces.
- [x] Match source page routes against checklist routes exactly, with no missing or duplicate routes.
- [x] Audit task dialog primitives, native confirms, custom overlays, shared viewers, navigation and calendar integration hooks.
- [x] Create the [every-page TODO list](mobile-page-checklist.md): every route has its own section, source references, workflow tasks and pending verification.
- [x] Create the [dialog replacement TODO list](mobile-dialog-audit.md): 41 task groups cover 59 baseline dialog content sites, nine native confirmations and shared mobile Sheet navigation. One template may serve several actions; all variants need testing.
- [ ] Keep both inventories synchronized whenever routes or interactions change. New dedicated routes get their own mobile checklist section before completion.

## Phase 1 — remove overlays and establish shared mobile behavior

- [x] Revert the previous pass's dialog-sizing changes; the direction is removal, not modal polish.
- [x] Convert employee leave, request and reimbursement creation to expandable forms below page headers. Rename files/exports to Form rather than Dialog.
- [x] Convert selected employee schedule details to an inline section above the calendar with a close action and keyboard focus handling.
- [x] Replace native employee leave cancellation, request withdrawal and shared document deletion confirmation with an inline confirmation control. Keep explicit confirmation, pending lockout, failure retention, and focus restoration.
- [ ] Verify all first-batch flows against authenticated app data, server-action failure/success, translations, uploads and permissions. Isolated component checks do not close this item.
- [x] Replace shared single/bulk document upload, knowledge upload, and punch-photo viewer (source; verify pending).
- [x] Replace command search overlay with inline navigation search and keep Ctrl/Cmd+K focus behavior (source; verify pending).
- [x] Replace mobile sidebar Sheet with expanding in-page navigation (source; verify pending).
- [x] Ensure shell, header, filters, tabs, cards, table containers, inputs and action areas have no forced page width or keyboard-obscured controls (source pass; verify pending).

## Phase 2 — complete employee and public surfaces

Execute every employee/public route section in the every-page checklist, not just dashboard entry pages.

- [x] Complete leave/request/reimbursement lists source conversion (verify pending).
- [x] Complete employee dashboard, profile, payroll, documents, benefits, onboarding, notifications, schedule, team, settings, chat and time tracking source conversion (verify pending).
- [x] Complete login, forgot/change password, onboarding entry/token, root redirects, unauthorized and privacy pages source conversion (verify pending).
- [x] Reflow chat evidence panel and composers for mobile (source; full keyboard/device verify pending).
- [ ] Verify English/Spanish supported surfaces, theme variants, read-only/no-employee access, expired tokens and deep links.

## Phase 3 — complete every admin surface

Execute every admin route and tab section in the every-page checklist. Dialog audit destinations define placement.

- [x] Employees: create, detail tabs, contact/access/password/PIN, bulk actions, benefits changes, hire import and status changes (source; verify pending).
- [x] Contractors: workers/agencies/hours/on-site tabs, create/edit, assignment, archive/reactivate/end, correction and record/photo details (source; verify pending).
- [x] Departments and job codes: create/edit/detail/assignment and confirmation workflows (source; verify pending).
- [x] Time tracking and schedules: edits, manual entries, force clock-out, reasons/review, deletion and shift create/edit/delete (source; verify pending).
- [x] Leave, requests and reimbursements: review/reject/adjust/reopen/pay flows and history (source; verify pending).
- [x] Payroll: periods, period details, import and batch paystub upload/review/matching/download/replacement actions (source; verify pending).
- [x] Benefits: catalog, create/edit, eligibility workspace, metadata, rollover, deactivate and verify actions (source; verify pending).
- [x] Documents/company library and knowledge: upload, bulk selection, metadata, evidence and deletion (source; verify pending).
- [x] Onboarding/checklists, notifications/broadcast, kiosks/security, settings, activity, admin dashboard and chat (source; verify pending).

## Phase 4 — kiosk, outputs and secondary states

- [x] Complete both kiosk routes source mobile polish (full camera/device verify pending).
- [x] Complete loading/error/not-found touch-target polish (full state verify pending).
- [ ] Verify print-only views, CSV/PDF/receipt downloads, upload progress and missing/expired evidence states.

## Phase 5 — acceptance and release

For each individual route, record implemented state separately from verified state.

- [ ] Exercise 320px and 390px portrait, short landscape, 768px tablet and desktop widths. No horizontal page scrolling; essential tabular scrolling stays inside a labeled region.
- [ ] Verify 44px primary touch targets, 16px mobile text inputs, associated labels, visible focus, long content, empty/error/loading/pending/success states and safe areas.
- [ ] For inline forms: opening/focus, draft retention, validation, pending lockout, cancel/focus return, successful reset and server errors. For dedicated pages: direct link, refresh, back and role access.
- [ ] Test keyboard navigation and real iPhone/Android behavior including date/file pickers and virtual keyboard.
- [ ] Run full typecheck, scoped lint, relevant business tests and isolated/authenticated Playwright checks.
- [ ] Rescan all application sources for task Dialog/AlertDialog/CommandDialog/Sheet, browser alert/confirm/prompt, custom modal roles/portals and third-party modal hooks. Trace remaining matches rather than merely renaming APIs.
- [ ] Verify no dialog or modal backdrop appears while exercising every audit action. Retire unused modal primitives and dead exports after consumers are gone.
- [ ] Review desktop and mobile captures together, fix verified defects once, and record remaining limitations.
- [ ] Prepare a reviewable release with validation evidence and rollback notes after all route checkboxes are complete. No deployment performed by this initial batch.

## Current completion boundary

**Source:** all **57** checklist routes + shared overlays converted. Rescan found no consumer Dialog/AlertDialog/CommandDialog/Sheet/`window.confirm` outside unused `components/ui` primitives.

**Not done:** authenticated browser verification for any route; Spanish/theme/device matrix; E2E selector updates; retirement of unused modal primitives; production deploy of this migration.


## Initial batch verification evidence

- Project TypeScript check and scoped ESLint passed for the first implementation batch.
- Isolated Playwright/Chromium fixture rendered the actual three form components and InlineConfirmAction with server actions stubbed; this is not a full authenticated app test.
- At 320, 390, 768 and 1440px: all three forms expand in normal page flow, later page content moves down, no task dialog/alertdialog/aria-modal is rendered, and no horizontal document overflow occurs.
- Inline confirmation: first activation does not call the action; cancel restores trigger focus; pending disables actions; failure retains confirmation; success closes and restores focus. Passed at all four widths.
- Local evidence: `C:/Users/soham/Documents/ChatGPT/ACT Persona/outputs/mobile-inline-20261029/results.json` plus viewport screenshots in that folder. Reproduction harness: `outputs/verify-mobile-inline.mjs` in that workspace.
- Shared action containers now wrap expanded confirmation content rather than squeezing adjacent download/status controls.
- Still pending: full authenticated integration, all other workflows/routes, Spanish/theme variants, real iOS/Android, keyboard/file upload and server authorization checks. Isolated fixture results do not mark whole-page tasks done.
