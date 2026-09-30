# Production hardening plan & checklist

Owner decisions:
- Terminated employees: **read-only access for 60 days after the termination date, then login is refused.** Employee record and documents are kept forever.
- Terminated employees cannot punch at the kiosk.
- Admins get full edit of time entries (edit / add manual / force-close).
- Everything below gets fixed. Priority: bullet-proof.

## Foundations (done by coordinator)
- [x] Schema additions in `apps/web/prisma/schema.prisma`: `EmploymentStatus.PENDING_REVIEW`, extra `NotificationType` values (LEAVE/TIME/REIMBURSEMENT/REQUEST/SCHEDULE/BENEFITS/SYSTEM), `User.mustChangePassword`, `OnboardingInvite` prefill fields, `LeaveRequest.totalDays` Decimal + half-day flags, `LeavePolicy`, `LeaveAdjustment`, `TimeEntry.{lastEditedById,editReason,autoClosed}`, `BenefitPlan.rolledFromId` (unique), `Payroll.fileSha256`
- [x] `src/lib/access.ts` (FULL / READ_ONLY / NONE, 60-day grace) wired into `getSessionUser` and `auth.ts authorize`
- [x] `requireWritableUser()` in `src/lib/auth/index.ts` (use in every employee self-service WRITE action)
- [x] `src/lib/upload-validation.ts` (`validateUpload`, `downloadHeaders`) for every upload and every file download response
- [x] `src/lib/notify.ts` (`notifyEmployees`, `notifyAdmins`)
- [x] `next.config.ts` serverActions.bodySizeLimit 60mb

## Workstream A: auth, onboarding, employee admin
- [x] A1 Terminated: read-only 60d then no login; terminate requires terminationDate; read-only banner and disabled write UI; customer-portal identity adapter also refuses NONE
- [x] A2 Login email/username case-insensitive end to end (normalize on create/onboard/update; one-off normalization script)
- [x] A3 Onboarding: server-generated Employee ID; pay/department/title/hire date from admin invite prefill; account created `PENDING_REVIEW`; admin approve screen; atomic invite claim; upload failures surfaced; uploads validated; sign-in link on done/expired pages
- [x] A4 Bulk delete: confirm dialog, block self/admins, audit, transaction, handle User row; default to terminate; hard delete only with typed confirmation
- [x] A5 Admin-set password sets `mustChangePassword`; enforced redirect to change-password; password field not plaintext
- [x] A6 updateEmployee fixes (User.name sync, supervisor cycle, empty-string FKs, date validation, no SSN/DOB in audit diff); job-code primary flag; dept/job-code audit
- [x] A7 Hire-packet stuck PROCESSING recovery + retry; zip/profile-pic upload validation
- [x] A8 Promote/demote admin (not self, keep at least 1), admin reset password; fix `scripts/create-admin.ts`; forgot-password copy
- [x] A9 All self-service writes in A's files guarded with `requireWritableUser`

## Workstream B: time, kiosk, schedules
- [x] B1 Admin time tools: edit clock in/out/breaks/job code/notes, manual entry (source MANUAL), force clock-out, delete-with-reason, reopen; audited; employee notified
- [x] B2 Stale shift protection: max 16h shift, auto-close flagged `autoClosed`, needs review; admin sees stale entries with one-click fix
- [x] B3 Race-safe clock-in, transactional clock-out, review only PENDING completed entries, admin notes UI, reject reason shown, bulk approve
- [x] B4 Kiosk: refuse non-ACTIVE (lookup + action); forced PIN change when PIN equals the default (bcrypt-compare); rate limit counts failures only; idle timer only after PIN entry starts; year-agnostic ID entry
- [x] B5 Admin time page: date range, per-employee totals, history, no 25-row cap; employee weekly totals ignore REJECTED and use business TZ
- [x] B6 Schedules: overnight shifts, only ACTIVE employees, valid job code, warn on approved leave, past-month view + edit, notify
- [x] B7 Notifications for time approve/reject, corrections, schedule changes

## Workstream C: leave and requests
- [x] C1 `lib/leave-balance.ts`: policy-based balance per type/year; unit tests
- [x] C2 Admin UI: leave policy per type; per-employee balances and adjustment with reason (audited)
- [x] C3 Submit validation: no past dates (admin override), end >= start, business-day math, half days, server computes days, overlap check, per-type balance check
- [x] C4 Approve/reject/cancel in one transaction with balance + overlap re-check; admin can cancel approved; review notes shown to employee
- [x] C5 Dashboard donut and Leave page use the same balance lib; stop using cached Employee.leaves* fields
- [x] C6 Requests: transition rules, admin notes shown to employee, employee cancel, notifications
- [x] C7 Notifications: leave submitted/decided, request status
- [x] C8 Fix Decimal `totalDays` usages across app; data migration script

## Workstream D: payroll, benefits, reimbursements, documents
- [x] D1 Overtime week split fix in payroll-slip with tests
- [x] D2 Pay period status: edit + auto-derive; edit/delete UI
- [x] D3 Paystub duplicates blocked server-side; admin view/download/delete of payroll docs and periods; employee existence check; validated uploads; notify on upload
- [x] D4 Benefits: PENDING is not current coverage + confirm action; atomic plan+tiers with tier removal; idempotent roll-forward; enrollment guards; benefits docs listing fix
- [x] D5 Reimbursements: transitions; paidAmount validation; reject reason required and shown; receipt upload + view; amount > 0; totals fixed; notify
- [x] D6 Documents: company-wide docs reach employees; listing/download consistency; validated uploads
- [x] D7 Downloads use `downloadHeaders` with real extension; CSV quoting; date-only formatting; upcoming pay date includes today
- [x] D8 All self-service writes in D's files guarded with `requireWritableUser`

## Workstream E: platform, dashboards, ops
- [x] E1 TZ=America/Chicago in compose/Dockerfile; dashboards use business-time helpers
- [x] E2 Admin dashboard visible degraded state instead of silent zeros; exclude stale/auto-closed from "clocked in now"
- [x] E3 Notifications UI (link, full message, badge); activity filter covers all audit prefixes
- [x] E4 `/api/health` + compose healthcheck; chat route 502 on agent outage; knowledge upload marks FAILED if enqueue fails
- [x] E5 Backups script + restore doc; DEPLOY-LITE fixes (db push command, upgrade step, bootstrap args, second admin, Caddy warning)
- [x] E6 Migrations vs `db push` contradiction resolved; data-migration script for new columns
- [x] E7 Team page cap/anchor; employee dashboard non-leave fixes; 5 lint errors fixed
- [x] E8 Security headers in next.config (careful with PDF viewer)

## Gate (coordinator)
- [ ] typecheck clean, lint no errors, tests green
- [ ] New unit tests: access levels, upload validation, leave balance, overtime week split, reimbursement transitions, schedule overnight, PIN default detection
- [ ] Final review of every workstream diff
