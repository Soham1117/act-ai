# Mobile batch: checklist routes 1–10

Implementation date: 2026-10-29. Source work is implemented. Authenticated browser verification is coordinated separately in the main batch report; this file does not claim whole-route browser/device acceptance.

## 1. /admin/activity
- Search/action controls stack, have accessible names and mobile input sizing.
- Timestamp moves beneath activity content on phones. Long detail text wraps.
- Pagination wraps and links have touch-sized hit areas. Existing filter/query/export parameters preserved.

## 2. /admin/benefits/[id]/edit
- Uses updated PlanForm: one-column tier entry on phones, two-column age-band cards, desktop tabular columns retained.
- Primary form labels linked to stable per-instance IDs. Age-band fields and tier prices have explicit accessible names.
- Existing plan hydration, type edit restriction, pricing validation and return routing preserved.

## 3. /admin/benefits/eligibility
- Existing stacked filters, mobile result cards, two-column-wide-screen workspace and local comparison-table scrolling retained.
- Native selectors now use 44px/16px mobile controls and shrink within their containers.
- Existing policy/assessment inline editors and authorization/business actions preserved; no task dialog dependency remains in owned sources.

## 4. /admin/benefits/new
- Same PlanForm layout/label changes as edit. Tier and age-band controls stay within phone width and primary actions are touch sized.
- Existing plan-type branches and server payload/validation preserved.

## 5. /admin/benefits
- Metadata editor and rollover task are explicit InlinePanel sections in page flow.
- Card headings and task areas no longer share a constrained horizontal row. Actions wrap.
- Bulk verification moved below the page header and uses inline confirmation. Plan deactivation preserves its history warning and requires inline confirmation.
- Rollover dates and tier pricing stack on phones; failure keeps entered values and success behavior unchanged.

## 6. /admin/chat
- Document-scope selection is an inline Collapsible section rather than a task popover; search is labeled and selections expose aria-pressed.
- Evidence renders below conversation on phones, beside it only on wide screens; no fixed minimum 320px side panel on phones.
- Composer uses dynamic viewport height, 16px mobile text, explicit send/stop labels and 44px controls. Long messages/code/tables stay in their local content area.
- Role scope, session restore, streaming, source evidence requests and AI-disabled behavior unchanged.

## 7. /admin/contract-workers/[id]
- Existing phone entry cards and desktop table retained.
- Assignment label/value pairs stack and long values wrap instead of squeezing across a row.
- Shared punch-photo viewer conversion is owned by the shared batch and must also be verified here.

## 8. /admin/contract-workers
- Add worker form now sits below the page heading. Worker/agency create/edit, inactive/activate, end/reactivate and clock-out workflows use explicit inline sections.
- Native reset-PIN confirmation replaced with InlineConfirmAction, preserving warning and explicit confirmation.
- Hours reject and correction editors remain outside the data list/table in normal page flow, with required reasons and pending protection preserved.
- Workers/on-site/hours/agencies subviews keep existing mobile cards, filters, selection/review, export and server-refresh behavior.
- Worker/agency field IDs are unique across repeated records and mobile/desktop copies. Native selectors and primary controls support touch sizing.

## 9. /admin/departments/[id]
- Heading/code and member cards wrap; avatars retain size; long heading text wraps.
- Existing roster, status, profile links and not-found behavior preserved. No task dialog dependency.

## 10. /admin/departments
- Create form moved below heading. Edit and delete confirmations expand inline.
- Department actions moved from absolute positioning into a normal card footer so expanded editors remain in page flow.
- Form labels linked to unique IDs; pending cancellation blocked; deletion restrictions and failure feedback preserved.

## Verification
- [x] Scoped source scan: no ui/dialog, ui/alert-dialog, ui/sheet imports or native browser confirmation calls remain in the owned route trees/chat components.
- [x] Scoped ESLint run after conversion; final results reported to coordinating agent.
- [x] TypeScript passed after first conversion/label/layout batch; final run reported to coordinating agent.
- [ ] Authenticated route/action checks, seeded DB mutations, screenshots, physical device and print checks are tracked by the coordinating agent; not claimed here.

## Shared dependencies

The main batch owns InlinePanel/InlineConfirmAction, shared mobile shell/navigation/search, UI Input/Select/other primitives and punch-photo/upload replacements. Their changes affect these routes; they must be included in final route verification.
