# Contract workers coverage

Specs: contract-agencies, contract-workers, contract-hours-review, contract-hours-csv, contract-onsite, contract-kiosk (+ existing kiosk-contract, contract-hours).

| Item | Scenario | Status | Spec |
|---|---|---|---|
| `createAgency` | happy path, trimmed, nulls, audit | covered | contract-agencies.spec.ts "creates an agency..." |
| `createAgency` | empty name, duplicate name, bad email, over-long fields | covered | contract-agencies.spec.ts (create block) |
| `createAgency` | failure injection (abort/500/stale), double-click, concurrent duplicate | covered | contract-agencies.spec.ts |
| `updateAgency` | happy, duplicate name, empty name, deleted agency, failure | covered | contract-agencies.spec.ts (edit block) |
| `setAgencyActive` | deactivate with workers, reactivate, deleted agency, failure, double-click | covered | contract-agencies.spec.ts |
| `setAgencyActive` | inactive agency hidden from new-worker picker; its worker still clocks in | covered | contract-agencies.spec.ts |
| `createContractWorker` | happy (CW id format, all fields, audit), nulls, validation, dates, job code, agency, lengths | covered | contract-workers.spec.ts |
| `createContractWorker` | inactive agency refused by server | covered (fixme: server does not enforce) | contract-workers.spec.ts |
| `createContractWorker` | failure injection, double-click, concurrent creates get distinct ids | covered | contract-workers.spec.ts |
| `updateContractWorker` | happy, clear optionals, validation, bad refs, retired code kept, deleted, failure, double-click | covered | contract-workers.spec.ts |
| `endContractWorker` | now / future date, open shift closed, bad dates, deleted, failure, double-click, concurrent | covered | contract-workers.spec.ts |
| `reactivateContractWorker` | with/without end date, bad dates, deleted, failure | covered | contract-workers.spec.ts |
| `reviewContractTimeEntry` | approve, reject (reason required/trimmed), already reviewed, deleted, open, failure, double-click, concurrent | covered | contract-hours-review.spec.ts |
| `bulkReviewContractTimeEntries` | approve/reject all, skipped, none pending, empty reason, bad id list, failure, double-click, concurrent | covered | contract-hours-review.spec.ts |
| `adminEditContractTimeEntry` | happy, breaks kept, out<=in, >16h, future, empty/short reason, server reason limits, DST gap, overlap, reopened/deleted, rejected->pending, failure, double-click | covered | contract-hours-review.spec.ts |
| `adminClockOutContractWorker` | on-site clock-out, cancel, already out, ON_BREAK, 16h cap, failure, double-click, concurrent | covered | contract-onsite.spec.ts |
| `exportContractHoursCsv` | content, merge, rejected, range, agency filter, formula safety, empty range, invalid range, failure, double-click | covered | contract-hours-csv.spec.ts |
| `kioskListContractWorkers` | eligibility list, search, grouping, rate limit, not-activated kiosk | covered | contract-kiosk.spec.ts |
| `kioskContractAction` | clock in/out, already in/out, ended/future/past-end, clock-out after end, double-tap, concurrent, stale 16h shift, break actions rejected, crafted slug/worker, revoked kiosk, rate limit, photos, camera denied, failures | covered | contract-kiosk.spec.ts, kiosk-contract.spec.ts |
| `kioskContractAction` | job code: null / retired / deleted must not use made-up "ACT001" | covered (3 fixme: app bug) | contract-kiosk.spec.ts |
| `kioskContractTimings` | past-30-days list, empty state, unknown worker | planned | e2e spec not written |
| `kioskContractChangePin` | forced first-use PIN change, weak PIN, wrong temp PIN, already changed | planned | e2e spec not written |
| `resetContractWorkerKioskPin` | admin reset to 3214, non-admin refused | planned | e2e spec not written |
| `_contractClockIn`, `_contractClockOut`, `closeOpenContractEntry`, `withContractWorkerLock`, `reportContractAutoClosed`, `revalidateContractPages` (contract-time-core.ts, not "use server") | exercised through kiosk and admin flows above | covered | contract-kiosk.spec.ts, contract-onsite.spec.ts |
| `reportContractAutoClosed` | admin notification | not-testable | e2e admin has no Employee row, so notifyAdmins reaches nobody; audit entry is asserted instead |
| Delete a time entry / worker | no such action exists | not-testable | contract-hours-review.spec.ts asserts no delete control |
| Zod max-length of `reviewSchema.notes` etc. | UI limits typing | covered via crafted requests | contract-hours-review.spec.ts |
| Kiosk network (IP) rule for contract punches | contract actions only check the device cookie | not-testable | no IP check in code; reported |
| Pages `/admin/contract-workers`, `/admin/contract-workers/[id]` | tabs, filters, detail, not-found, anonymous and employee access | covered | contract-workers.spec.ts, contract-hours-review.spec.ts |
