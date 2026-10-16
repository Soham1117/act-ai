# People management (employees, onboarding, hire packet, departments, job codes)

Seed: `e2e/seed-parts/30-people.ts`. Helpers: `e2e/support/people.ts`, `people-data.ts`.

| Item | Scenario | Status | Spec |
|---|---|---|---|
| `createDepartment` | happy path, upper-case code, blank code allowed | covered | departments.spec.ts |
| `createDepartment` | duplicate name / duplicate code / too short / server failure / double click / stale deployment | covered | departments.spec.ts |
| `updateDepartment` | any | not-testable | no UI calls it (dead action); proposed: add an Edit dialog |
| `deleteDepartment` | with employees, with open invite, empty | not-testable | no UI calls it (dead action); proposed: add a Delete button |
| `createJobCode` | happy path, upper-case, rate NA, default clears old default | covered | job-codes.spec.ts |
| `createJobCode` | duplicate code, short/long values, failure, double click, stale | covered | job-codes.spec.ts |
| `updateJobCode` | edit fields, duplicate code, rename, default switch, retire, deleted meanwhile, failure, double click | covered | job-codes.spec.ts |
| `updateJobCode` | inactive code made default | covered (fixme, bug) | job-codes.spec.ts |
| `toggleJobCodeActive` | deactivate / activate, deleted meanwhile, failure; shift dialog follows | covered | job-codes.spec.ts |
| `toggleJobCodeActive` | deactivating the default leaves inactive default | covered (fixme, bug) | job-codes.spec.ts |
| `deleteJobCode` | unused, assigned (refused), failure | covered | job-codes.spec.ts |
| `deleteJobCode` | used by contract worker | covered (fixme, bug) | job-codes.spec.ts |
| `assignJobCode` | assign, primary switching, rate, stale employee/code | planned | not written yet (time) |
| `unassignJobCode` | unassign, primary cleared, stale | planned | not written yet (time) |
| kiosk job code fallback | no usable code stamps "ACT001" | covered (characterised + fixme, bug) | job-codes-fallback.spec.ts |
| `createEmployee` | happy path, EMP id, PIN 3214, mustChangePassword, login | covered | employees-create.spec.ts |
| `createEmployee` | username only, neither, invalid fields, duplicate email, duplicate username | covered | employees-create.spec.ts |
| `createEmployee` | failure, double click | covered | employees-create.spec.ts |
| `createEmployee` | 2FA on rules | not-testable | LOGIN_2FA_ENABLED is fixed at server start (false) |
| `createEmployee` | link to existing bootstrap user, bad department | planned | needs stale-page setup |
| `updateEmployee` | inline edit, DOB/hire date checks, supervisor loop, primary job code | planned | not written yet (time) |
| `changeEmployeePassword` | reset + mustChange login | planned | not written yet (time) |
| `setEmploymentStatus` | terminate / reactivate, login/kiosk effects | planned | not written yet (time) |
| `approveEmployee` | approve pending hire | planned | not written yet (time) |
| `rejectPendingHire` | reject pending hire | planned | not written yet (time) |
| `setUserRole` | promote / demote | planned | last-admin guard unreachable from UI (caller is always an admin) |
| `updateEmployeeProfilePic` | upload, bad type/size | planned | not written yet (time) |
| `updateMyPersonalEmail` | self-service | planned | belongs to the employee-settings area |
| `consentToElectronicW2` | self-service | planned | employee-settings area |
| `withdrawW2Consent` | self-service | planned | employee-settings area |
| `consentToBenefitsEDelivery` | self-service | planned | employee-settings area |
| `withdrawBenefitsEConsent` | self-service | planned | employee-settings area |
| `bulkDeleteEmployees` | confirm word, history, force | planned | not written yet (time) |
| `bulkTerminateEmployees` | selection, skipped admins | planned | not written yet (time) |
| `resetEmployeeKioskPin` | reset to 3214 | planned | not written yet (time) |
| `createOnboardingInvite` | create, bad dept/date | planned | not written yet (time) |
| `revokeOnboardingInvite` | revoke | planned | not written yet (time) |
| `submitOnboarding` | end to end, bad/expired/used/revoked token, file validation | planned | not written yet (time) |
| `uploadHirePacketZip` | upload, bad type/size | planned | not written yet (time) |
| `retryHirePacketImport` | retry failed | planned | not written yet (time) |
| `getHirePacketImportStatus` | polling | planned | not written yet (time) |
| `applyHirePacketImport` | apply selected fields | planned | not written yet (time) |
| `cancelHirePacketImport` | cancel | planned | not written yet (time) |
| `/admin/departments`, `/admin/departments/[id]` | pages | covered | departments.spec.ts |
| `/admin/job-codes`, `/admin/job-codes/[id]` | pages | covered | job-codes.spec.ts |
| `/admin/employees` | add dialog | covered | employees-create.spec.ts |
| `/admin/employees/[id]`, `/admin/onboarding`, `/onboard/[token]` | pages | planned | not written yet |
