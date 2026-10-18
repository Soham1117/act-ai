# People management (employees, onboarding, hire packet, departments, job codes)

Seed: `e2e/seed-parts/30-people.ts`. Helpers: `e2e/support/people.ts`, `people-data.ts`.

| Item | Scenario | Status | Spec |
|---|---|---|---|
| `createDepartment` | happy path, upper-case code, blank code allowed | covered | departments.spec.ts |
| `createDepartment` | duplicate name / duplicate code / too short / server failure / double click / stale deployment | covered | departments.spec.ts |
| `updateDepartment` | happy path, clear code/description, duplicate name/code, too short, deleted meanwhile, server failure, double click | covered | departments.spec.ts "admin departments: edit" |
| `deleteDepartment` | empty (with confirmation), cancel, with employees, with open invite, deleted meanwhile, server failure, double click | covered | departments.spec.ts "admin departments: delete" |
| `createJobCode` | happy path, upper-case, rate NA, default clears old default | covered | job-codes.spec.ts |
| `createJobCode` | duplicate code, short/long values, failure, double click, stale | covered | job-codes.spec.ts |
| `updateJobCode` | edit fields, duplicate code, rename, default switch, retire, deleted meanwhile, failure, double click | covered | job-codes.spec.ts |
| `updateJobCode` | inactive code made default | covered (fixme, bug) | job-codes.spec.ts |
| `toggleJobCodeActive` | deactivate / activate, deleted meanwhile, failure; shift dialog follows | covered | job-codes.spec.ts |
| `toggleJobCodeActive` | deactivating the default leaves inactive default | covered (fixme, bug) | job-codes.spec.ts |
| `deleteJobCode` | unused, assigned (refused), failure | covered | job-codes.spec.ts |
| `deleteJobCode` | used by contract worker | covered (fixme, bug) | job-codes.spec.ts |
| `assignJobCode` | assign, primary switching, rate, stale employee/code, failure, double click | covered | job-codes-assignments.spec.ts |
| `unassignJobCode` | unassign, primary cleared, stale | covered | job-codes-assignments.spec.ts |
| kiosk job code fallback | no usable code stamps "ACT001" | covered (characterised + fixme, bug) | job-codes-fallback.spec.ts |
| `createEmployee` | happy path, EMP id, PIN 3214, mustChangePassword, login | covered | employees-create.spec.ts |
| `createEmployee` | username only, neither, invalid fields, duplicate email, duplicate username | covered | employees-create.spec.ts |
| `createEmployee` | failure, double click | covered | employees-create.spec.ts |
| `createEmployee` | 2FA on rules | not-testable | LOGIN_2FA_ENABLED is fixed at server start (false) |
| `createEmployee` | link to existing bootstrap user, bad department | planned | needs a user without an employee record and a stale department |
| `updateEmployee` | inline edit, DOB/hire date checks, supervisor loop, primary job code, deleted department/code, failure, double click | covered | employees-access.spec.ts |
| `changeEmployeePassword` | reset, mustChange on/off, sessions revoked, mismatch, failure, double click | covered | employees-access.spec.ts |
| `setEmploymentStatus` | terminate / reactivate, login/kiosk effects, 60-day window, future/old date, failure, double click, stale | covered | employees-status.spec.ts |
| `approveEmployee` | approve pending hire, stale | covered | employees-status.spec.ts, onboarding.spec.ts |
| `rejectPendingHire` | reject pending hire, failure | covered | employees-status.spec.ts |
| `setUserRole` | promote / demote, session revoked, terminated meanwhile, failure | covered | employees-access.spec.ts |
| `setUserRole` | last-admin guard, self change | not-testable | caller is always an admin and has no employee page, so unreachable from the UI |
| `updateEmployeeProfilePic` | upload, bad type / fake / oversize, failure | covered | employees-access.spec.ts |
| `updateMyPersonalEmail` | self-service | planned | belongs to the employee-settings area |
| `consentToElectronicW2` | self-service | planned | employee-settings area |
| `withdrawW2Consent` | self-service | planned | employee-settings area |
| `consentToBenefitsEDelivery` | self-service | planned | employee-settings area |
| `withdrawBenefitsEConsent` | self-service | planned | employee-settings area |
| `bulkDeleteEmployees` | confirm word, history, force, failure, double click | covered | employees-status.spec.ts |
| `bulkTerminateEmployees` | selection, already terminated, failure | covered | employees-status.spec.ts |
| `bulkTerminateEmployees` | sessions revoked | covered (fixme, bug) | employees-status.spec.ts |
| `resetEmployeeKioskPin` | reset to 3214, cancel, failure, kiosk asks for temporary PIN | covered | employees-access.spec.ts |
| `createOnboardingInvite` | create with terms, bad date, deleted department, failure, double click | covered | onboarding.spec.ts |
| `revokeOnboardingInvite` | revoke, already used, failure | covered | onboarding.spec.ts |
| `submitOnboarding` | end to end with approval and login, pre-filled email, client checks, server checks, revoked/expired, bad document, failure, double click | covered | onboarding.spec.ts |
| `uploadHirePacketZip` | upload + process, wrong type, fake zip, oversize, failure | covered (processing with a text PDF = fixme in dev, bug) | hire-packet.spec.ts |
| `retryHirePacketImport` | retry a failed import | covered | hire-packet.spec.ts |
| `getHirePacketImportStatus` | polling / processing | covered | hire-packet.spec.ts |
| `applyHirePacketImport` | apply selected fields, nothing ticked, failure, stale | covered | hire-packet.spec.ts |
| `cancelHirePacketImport` | cancel | covered | hire-packet.spec.ts |
| `/admin/departments`, `/admin/departments/[id]` | pages | covered | departments.spec.ts |
| `/admin/job-codes`, `/admin/job-codes/[id]` | pages | covered | job-codes.spec.ts |
| `/admin/employees`, `/admin/employees/[id]`, `/admin/employees/[id]/hire-import/[jobId]` | pages | covered | employees-*.spec.ts, hire-packet.spec.ts |
| `/admin/onboarding`, `/onboard`, `/onboard/[token]` | pages and bad/expired/used/revoked tokens | covered | onboarding.spec.ts |
