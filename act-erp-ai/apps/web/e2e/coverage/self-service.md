# Employee self-service coverage (slot 2)

Specs: leave.spec.ts, leave-admin.spec.ts, reimbursements.spec.ts, reimbursements-admin.spec.ts, requests.spec.ts, requests-admin.spec.ts.
Seed: seed-parts/20-self-service.ts (13 dedicated employees, benefit plans, Olive's private rows).

| Item | Scenario | Status | Spec |
|---|---|---|---|
| `submitLeaveRequest` | happy path, half days, unlimited type, balance math | covered | leave.spec.ts |
| `submitLeaveRequest` | overlap (pending/approved), balance shortfall (stale dialog), past date, over one year, end before start, weekend only | covered | leave.spec.ts |
| `submitLeaveRequest` | server failure / 500 / stale deployment / double click | covered | leave.spec.ts |
| `submitLeaveRequest` | on behalf of another employee (admin) | not-testable | no UI calls it |
| `submitLeaveRequest` | read-only account | planned | needs Rory login spec |
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
| `upsertBenefitPlan` | create/edit/tier removal, validation | planned | benefits-admin.spec.ts not written (spend limit) |
| `deactivateBenefitPlan` | deactivate | planned | same |
| `upsertEnrollment` | enrol, waive, overlap, unpriced tier, SSN-like member id | planned | same |
| `confirmEnrollment` | confirm pending | planned | same |
| `changeEnrollmentTier` | tier change, date rule | planned | same |
| `endEnrollment` | end, before-effective, already ended | planned | same |
| `upsertRetirementElection` | percent/flat, over 100%, overlap | planned | same |
| `confirmRetirementElection` | confirm | planned | same |
| `endRetirementElection` | end | planned | same |
| `rollForwardPlanYear` | roll forward, already rolled, date rules | planned | same |
| `markAllVerifiedToday` | stamp open rows (global; restore Ben's dates) | planned | same |
| `/dashboard/benefits` | employee view of coverage, states, documents | planned | benefits.spec.ts not written |
| `uploadDocument` | employee/admin upload, type/size/empty validation | planned | documents.spec.ts not written |
| `uploadDocumentBulk` | bulk and ERISA consent skip | planned | same |
| `deleteDocument` | delete own/admin, visibility | planned | same |
| `listMyDocuments` | own rows only | planned | same |
| `/api/documents/[id]/file` | owner/other/anon | planned | same |
| `broadcastNotification` | dept targeting, no recipients, validation | planned | notifications.spec.ts not written |
| `markNotificationRead` | mark one | planned | same |
| `markAllNotificationsRead` | mark all, badge, pagination | planned | same |
| `/api/notifications/unread` | unread count | planned | same |
| `setMyKioskPin` | PIN rules (kiosk-pin.ts), wrong password | planned | settings.spec.ts not written |
| `changeMyPassword` | validation, wrong current, success | planned | same |
| `updateMyPersonalEmail` | validation, wrong password | planned | same |
| `consentToElectronicW2` / `withdrawW2Consent` / `consentToBenefitsEDelivery` / `withdrawBenefitsEConsent` | toggles | planned | same |
| `updateEmployeeProfilePic` | admin upload, bad type | planned | same |
| `/dashboard/my-details` | read-only page | planned | my-details.spec.ts not written |
