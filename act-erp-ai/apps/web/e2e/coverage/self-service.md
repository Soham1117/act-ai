# Employee self-service coverage (slot 2)

Specs: benefits*.spec.ts, documents.spec.ts, notifications.spec.ts, settings*.spec.ts, my-details.spec.ts, leave.spec.ts, leave-admin.spec.ts, reimbursements.spec.ts, reimbursements-admin.spec.ts, requests.spec.ts, requests-admin.spec.ts.
Seed: seed-parts/20-self-service.ts (13 dedicated employees, benefit plans, Olive's private rows).

| Item | Scenario | Status | Spec |
|---|---|---|---|
| `submitLeaveRequest` | happy path, half days, unlimited type, balance math | covered | leave.spec.ts |
| `submitLeaveRequest` | overlap (pending/approved), balance shortfall (stale dialog), past date, over one year, end before start, weekend only | covered | leave.spec.ts |
| `submitLeaveRequest` | server failure / 500 / stale deployment / double click | covered | leave.spec.ts |
| `submitLeaveRequest` | on behalf of another employee (admin) | not-testable | no UI calls it |
| `submitLeaveRequest` | read-only account | covered | settings-readonly.spec.ts |
| `reviewLeave` | approve, reject (reason), overlap, balance override, stale, deleted, failures, double click | covered | leave-admin.spec.ts |
| `cancelLeaveRequest` | employee cancel pending/approved, not started rule, stale, deleted, failure | covered | leave.spec.ts |
| `cancelLeaveRequest` | admin cancel approved with reason | covered | leave-admin.spec.ts |
| `adjustLeaveBalance` | add, deduct, zero/too large/short reason, double click | covered | leave-admin.spec.ts |
| `saveLeavePolicies` | change days, unlimited, above 365, stale | covered | leave-admin.spec.ts |
| `submitReimbursement` | happy path with receipt via fake S3, no receipt, 2 receipts, cents | covered | reimbursements.spec.ts |
| `submitReimbursement` | empty fields, amount rules, future date, bad file type/size/content, empty file, 5 receipt limit | covered | reimbursements.spec.ts |
| `submitReimbursement` | failures, stale, double click, privacy of other employees' receipts | covered | reimbursements.spec.ts |
| `reviewReimbursement` | under review, approve, pay full/partial, reject, stale transitions, deleted, failures, double click | covered | reimbursements-admin.spec.ts |
| `reopenReimbursement` | reopen rejected, not-rejected refusal | covered | reimbursements-admin.spec.ts |
| `submitRequest` | each of the 12 types, validation, leave type blocked in UI, failures, double click | covered | requests.spec.ts |
| `cancelRequest` | withdraw, picked-up refusal, deleted, failure | covered | requests.spec.ts |
| `updateRequestStatus` | processing, complete, reject (note), stale, deleted, failures, double click | covered | requests-admin.spec.ts |
| `reopenRequest` | reopen terminal request, non-terminal refusal | covered | requests-admin.spec.ts |
| `createBenefitPlan` | legacy action, no UI caller | not-testable | superseded by `upsertBenefitPlan` |
| `updateBenefitPlan` | legacy action, no UI caller | not-testable | superseded by `upsertBenefitPlan` |
| `upsertPlanTiers` | legacy action, no UI caller | not-testable | superseded by `upsertBenefitPlan` |
| `upsertBenefitPlan` | create (tiers, 401k), edit, tier removal, in-use tier, validation, failures | covered | benefits-admin.spec.ts |
| `deactivateBenefitPlan` | deactivate, picker excludes it | covered | benefits-admin.spec.ts |
| `upsertEnrollment` | enrol, pending, waive, overlap, unpriced tier, SSN-like member id, failures, double click | covered | benefits-admin.spec.ts |
| `confirmEnrollment` | confirm, already confirmed, deleted | covered | benefits-admin.spec.ts |
| `changeEnrollmentTier` | tier change, date rule | covered | benefits-admin.spec.ts |
| `endEnrollment` | end, before-effective, already ended, stale failure | covered | benefits-admin.spec.ts |
| `upsertRetirementElection` | percent, flat, over 100%, overlap | covered | benefits-admin.spec.ts |
| `confirmRetirementElection` | confirm | covered | benefits-admin.spec.ts |
| `endRetirementElection` | end, before-effective | covered | benefits-admin.spec.ts |
| `rollForwardPlanYear` | roll, date rules, already rolled, double click | covered | benefits-admin.spec.ts |
| `markAllVerifiedToday` | stamps open rows | covered | benefits-admin.spec.ts |
| `upsertEnrollment` / `upsertRetirementElection` | update of an existing row (data.id) | not-testable | UI only creates; update path has no UI |
| `/dashboard/benefits` | cards, costs, states, past coverage, documents, empty state, privacy | covered | benefits.spec.ts |
| `uploadDocument` | employee/admin upload, type/size/empty/content validation, failures, double click | covered | documents.spec.ts |
| `uploadDocument` | 10-15 MB and over-15 MB files | covered-fixme | documents.spec.ts (app bug: page crashes) |
| `uploadDocument` | employee uploading COMPANY/BENEFITS type | not-testable | form does not offer those types |
| `uploadDocumentBulk` | bulk, ERISA consent skip, no consent, validation | covered | documents.spec.ts |
| `uploadDocumentBulk` | all active employees | planned | would notify every active employee in the shared DB |
| `deleteDocument` | own, admin, shared file kept, stale, failure | covered | documents.spec.ts |
| `listMyDocuments` | own rows only (same rule as the page) | covered | documents.spec.ts (via the page) |
| `/api/documents/[id]/file` | owner, other (403), anon, admin | covered | documents.spec.ts |
| `broadcastNotification` | department targeting, no recipients, validation, failures | covered | notifications.spec.ts |
| `broadcastNotification` | all active employees, explicit employeeIds | not-testable | all-active would hit every employee; no UI for employeeIds |
| `markNotificationRead` | mark one, failures | covered | notifications.spec.ts |
| `markAllNotificationsRead` | mark all, double click | covered | notifications.spec.ts |
| `/dashboard/notifications` | list, links, pagination | covered | notifications.spec.ts (found and fixed a crash) |
| `/api/notifications/unread` | count follows reads, anonymous | covered | notifications.spec.ts |
| `setMyKioskPin` | success, every weak-PIN rule, wrong password, form checks, failures | covered | settings.spec.ts |
| `changeMyPassword` | validation, wrong current, success and sign-out, rate limit, failures | covered | settings.spec.ts |
| `updateMyPersonalEmail` | success, wrong password, invalid, clear | covered | settings.spec.ts |
| `consentToElectronicW2` / `withdrawW2Consent` / `consentToBenefitsEDelivery` / `withdrawBenefitsEConsent` | toggles, failure, double click | covered | settings.spec.ts |
| `updateEmployeeProfilePic` | upload, bad type, mislabelled, empty, over 5 MB, serve | covered | settings-readonly.spec.ts |
| read-only account | leave, requests, documents, settings, reimbursements, benefits | covered | settings-readonly.spec.ts |
| `/dashboard/my-details` | read-only view of own record | covered | my-details.spec.ts |
