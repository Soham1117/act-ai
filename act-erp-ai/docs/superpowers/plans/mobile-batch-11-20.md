# Routes 11–20 — implementation report

Date: 2026-10-29. This report covers source implementation and scoped static checks. Authenticated browser/device acceptance remains a separate gate; do not mark those checks complete from this report.

## Changes by route

| # | Route | Implementation |
|---|---|---|
| 11 | `/admin/documents/company` | Kept existing upload/new-version/review forms inline; native select font is 16px on phones; action groups wrap. Filters, archive/approval authorization, metadata and draft-upload behavior preserved. |
| 12 | `/admin/documents` | Moved employee bulk-upload entry below PageHeader, retaining company-library navigation in header. Open/download buttons now have phone-sized targets. Existing type tabs/list stacking and shared inline deletion retained. Shared bulk upload owned by root. |
| 13 | `/admin/employees/[id]/hire-import/[jobId]` | Existing inline grouped import review preserved; long current/proposed values wrap within min-width-zero comparison grids; failure/retry controls wrap. Selection, sensitive-value masking, pending/failed/committed states and commit/cancel server handlers preserved. |
| 14 | `/admin/employees/[id]` | Password reset, role change, status/termination, hire-packet upload and all five benefits edit/end/enrollment/election workflows explicitly migrated from modal primitives to in-flow InlinePanel. Native kiosk PIN prompt replaced with inline explicit confirmation. Upload and leave adjustment moved below card headings; benefits actions moved into card body. Toolbar open panels span full width; all eleven tabs retained. |
| 15 | `/admin/employees` | Add-employee form moved below PageHeader; bulk terminate/delete and pending-hire rejection now inline. Existing name/filter/status/select/pagination/mobile card behavior preserved. Typed deletion confirmation and force-deletion error handling retained. |
| 16 | `/admin/job-codes/[id]` | Edit/assign panels moved below summary; title wraps and assignment links can shrink. Unassign action now has inline confirmation, pending lockout and failure retention. All assignment fields and server business checks retained. |
| 17 | `/admin/job-codes` | Create form below PageHeader; controlled edit panel in page flow outside table markup. Phone editor code/rate grid stacks. Existing mobile cards/dropdown actions retained; small icon actions enlarged on phone. |
| 18 | `/admin/kiosks` | Create form below PageHeader. Delete kiosk, disable PIN and remove trusted network confirmations explicitly moved to inline panels. Warning text, pending state, failure retention, successful close and all security/server handlers retained. |
| 19 | `/admin/knowledge` | Upload entry moved below PageHeader to allow full-width inline expansion; existing phone document cards and indexing/failure states preserved. Shared upload conversion owned by root. |
| 20 | `/admin/leave` | Approval/rejection/revert and balance adjustment are inline panels; narrow action rows wrap and expanded panels use a full row. Override/reason requirements, audit behavior and negative-balance adjustments preserved. All four tabs/mobile balance cards retained. |

## Shared implementation details within this ownership

- Existing Radix dialog/alert-dialog components were not reinterpreted or CSS-hidden. Owned consumers now explicitly import the new in-flow `inline-panel` implementation.
- Migrated component exports are named Panel rather than Dialog/Modal; existing filenames remain to avoid unrelated path churn.
- Added unique `useId`/`htmlFor` associations for 44 previously unassociated labels across employee/benefit/access/status, job-code, kiosk and leave controls.
- Panel roots receive pending-disabled state; close controls avoid cancellation during mutations. Existing handlers only collapse on success.
- No owned source imports `ui/dialog` or `ui/alert-dialog`, and no browser confirm/alert/prompt calls remain in these six owned route directories.
- Existing dirty work was retained. Root owns shared navigation, command search, upload forms and punch photos; their verification applies to these routes too.

## Checks actually run

- Project `tsc --noEmit`: passed after source migrations.
- Scoped ESLint across documents, employees, job-codes, kiosks, knowledge and leave: no errors; two React Compiler compatibility warnings for existing React Hook Form `watch` and TanStack `useReactTable` APIs.
- Source scan for modal imports and native prompts in owned directories: zero matches.

## Remaining verification gate

Authenticated browser interaction, all role/data/error permutations, actual upload/server mutations, screenshots at 320/390/768/desktop and short landscape, English/Spanish where supported, theme checks, physical iOS/Android, and deep-link/back/refresh behavior must be run as part of root's integrated verification. This report does not claim those passed.
