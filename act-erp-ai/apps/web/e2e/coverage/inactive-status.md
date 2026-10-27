# Active / inactive status coverage

| Item | Scenario | Status | Spec |
|---|---|---|---|
| `setEmployeeActive` | inactive/active, read-only portal access, active-roster and kiosk exclusion, preserve employment/termination data and history, close open shifts and breaks for approval | covered | inactive-status.spec.ts |
| `setEmploymentStatus` | crafted INACTIVE request is rejected; inactive changes must use the guarded transition | covered | inactive-status.spec.ts |
| `setContractWorkerActive` | inactive/active, inactive filter, kiosk exclusion, preserve assignment dates and history, close open shifts and breaks for approval | covered | inactive-status.spec.ts |
| `accessLevelFor`, `requireWritableUser`, `requireAdmin` | inactive employees and linked admins remain read-only without expiry; self-service and admin writes blocked | covered | src/lib/access.test.ts, src/lib/auth/index.test.ts |
| `isContractWorkerEligible`, `contractWorkerIneligibleReason` | inactive workers cannot clock in; distinguish temporary inactivity from an ended assignment | covered | src/lib/contract-workers.test.ts |
| Existing termination / end-assignment flows | terminate and reactivate employees; end and reactivate contract assignments | covered | employees-status.spec.ts, contract-workers.spec.ts |
