# Production readiness hardening plan

This plan supersedes the unchecked release gate in `HARDENING_PLAN.md` and reopens
items whose implementation is incomplete under real production conditions.

Owner decisions:
- Correct payroll is more important than permissive export. An unresolved payroll
  exception blocks finalization unless an administrator records an override reason.
- Finalized payroll is immutable and reproducible. Corrections require an audited
  reopen and a new version.
- Employment status limits every linked account, including administrators. An
  intentionally unlinked bootstrap account is the only exception.
- First-use credentials must establish the employee's identity; a shared enrollment
  secret is not sufficient.
- Infrastructure failures must never be represented as valid empty business data.
- Company calendar and payroll calculations use `America/Chicago`.

## Reconciliation of `HARDENING_PLAN.md`

Static review at baseline `9600073aef5ed5d4a2ef8e488d2a0e47cf5ef281` found the
majority of the original workstreams implemented. The following checked items are
reopened because the promised invariant is incomplete or regressed:

- [x] **A1 reopened:** fixed — linked administrators now obey employment status,
  and termination atomically revokes existing sessions.
- [x] **A5 reopened:** fixed — `mustChangePassword` is enforced by the standard
  server authorization boundary with a credential-change-only escape hatch.
- [x] **A8 reopened:** fixed — administrator role changes serialize and re-check the
  invariant inside the transaction.
- [ ] **B4 reopened:** the shared default kiosk PIN permits first-use identity
  takeover; the shared IP limiter can lock the whole kiosk and is process-local.
- [ ] **D1 reopened:** overtime splits separate entries across weeks, but does not
  split one overnight entry at midnight, a workweek boundary, or a pay-period
  boundary.
- [ ] **D2 reopened:** completed payroll periods are editable live queries, not
  finalized snapshots; overlapping pay periods are allowed.
- [ ] **E2 reopened:** only the admin dashboard distinguishes degraded data. Many
  operational pages still turn query failures into empty arrays or zero counts.
- [x] **E3 reopened:** fixed — complete counts and paginated history keep every unread
  item reachable.
- [ ] **E6 reopened:** production schema compatibility still depends on a manual
  `prisma db push`; deployment previously reached code/schema drift.
- [ ] **Original release gate remains open:** full typecheck, lint, test, build,
  workstream reconciliation, production-like concurrency/load, backup restore, and
  payroll parallel-run evidence have not all been recorded.

All other original A-E checklist items were found present by static inspection, but
remain subject to the final assembled release gate below. A checked source-level
implementation is not treated as production proof until that gate passes.

## Workstream F: payroll correctness and close control

- [x] **F1 Payroll readiness preflight:** show every active employee and block
  export/finalization for open, pending, rejected, auto-closed, missing, or zero-hour
  exceptions unless an audited override reason is recorded.
- [ ] **F2 Boundary-safe allocation:** calculate worked intervals after breaks and
  split them at Central midnight, Monday workweek boundaries, and pay-period
  boundaries. Cover overnight and DST cases with tests.
- [x] **F3 Reapproval after edits:** any material change to approved payable time
  returns it to `PENDING`, clears approval metadata, and clearly tells the admin why.
- [ ] **F4 Immutable finalization:** persist a versioned payroll snapshot, generated
  artifact hash, finalizer, and timestamp. Reopening is explicit and audited.
- [x] **F5 Pay-period exclusion:** reject overlapping or duplicate payroll periods
  transactionally and enforce the invariant at the database layer where possible.
- [ ] **F6 Provider and policy contract:** explicitly model overtime eligibility,
  PTO/holiday/sick earning codes, zero-hour handling, and the payroll provider's
  required schema. Do not silently apply weekly overtime to exempt employees.
- [ ] **F7 Transition bridge:** provide an idempotent, reviewed import/reconciliation
  path for legacy punches that fall inside the cutover payroll period.

## Workstream G: identity, authorization, and kiosk security

- [x] **G1 Terminated administrator enforcement:** employment access is evaluated
  before role privileges; termination revokes sessions and cannot leave a linked
  administrator with unrestricted access.
- [x] **G2 Forced-password authorization:** accounts requiring a password change may
  call only password-change and sign-out operations. All other protected server
  actions and routes return an explicit password-change-required result.
- [ ] **G3 Unique kiosk enrollment:** replace the shared first-use PIN with a unique,
  expiring, one-use enrollment process delivered privately or paired by an admin.
- [ ] **G4 Durable kiosk throttling:** use device-aware shared storage, avoid
  cross-employee kiosk lockout, display wait/unlock status, and preserve protection
  across restarts and multiple instances.
- [x] **G5 Atomic administrator invariant:** serialize role changes so at least one
  usable administrator remains.
- [ ] **G6 Device credential containment:** expose activation age and revocation,
  rotate kiosk credentials, and document the risk of a copied bearer cookie.
- [ ] **G7 Temporary credential rollout:** confirm MFA in production, privately
  distribute credentials, and report accounts that have not completed first login.

## Workstream H: reliable mutations and concurrency

- [ ] **H1 Committed-state responses:** a successfully committed punch is always
  reported as committed even when audit, notification, or cache refresh work fails.
  Secondary failures are observable and retryable without asking the employee to
  repeat the punch.
- [ ] **H2 Transactional side effects:** use a transactional outbox or equivalent
  durable retry mechanism for business-critical notifications and audit delivery.
- [ ] **H3 Bulk-review truthfulness:** notify and audit only rows actually changed by
  the transaction under concurrent review.
- [ ] **H4 Schedule overlap invariant:** serialize schedule writes or enforce a
  database range exclusion so concurrent requests cannot create overlaps.
- [ ] **H5 Open-entry invariant:** add database-backed protection against multiple
  open entries per employee, including scripts and future writers.
- [ ] **H6 DST-safe corrections:** reject nonexistent Central wall times and require
  explicit disambiguation for repeated fall-back times.

## Workstream I: truthful and refined user experience

- [ ] **I1 No false empty states:** required query failures render a degraded/error
  state with retry guidance, never `No employees`, `No documents`, or zero totals.
- [ ] **I2 Action result contract:** every action states what happened, whether data
  was saved, whether retry is safe, the next step, and an incident/reference ID for
  unexpected failures.
- [ ] **I3 Authoritative punch status:** after each kiosk action, display the stored
  state and timestamp; conflicts refresh status instead of presenting generic errors.
- [x] **I4 Central-date forms:** reimbursement and other date-only forms use the same
  Central business date on client and server.
- [x] **I5 Complete notification history:** unread and total counts are independent
  of pagination; every notification remains reachable and markable.
- [x] **I6 Honest clipboard feedback:** await clipboard writes, report rejection, and
  provide a selectable manual-copy fallback.
- [ ] **I7 Complete operational histories:** paginate onboarding, notifications,
  leave, and request history; labels and totals disclose their scope.
- [ ] **I8 Responsive and accessible critical flows:** verify kiosk, time review,
  leave, payroll preflight, and onboarding at supported phone/tablet/desktop sizes,
  with keyboard and screen-reader feedback for errors and status.

## Workstream J: deployment, recovery, and capacity

- [ ] **J1 Schema compatibility gate:** deployment fails before traffic switches if
  application and database schema are incompatible; schema changes are backed up,
  idempotent, and have a documented rollback path.
- [ ] **J2 Deep readiness and observability:** monitor database, storage, notification
  queue, schema version, backup freshness, and failed side effects without exposing
  secrets.
- [ ] **J3 Recovery proof:** automate backup success/freshness alerts and perform a
  recorded scratch restore at least monthly.
- [ ] **J4 43-user capacity proof:** simulate at least 43 near-simultaneous kiosk
  operations plus admin review, record latency/error budgets, connection-pool use,
  and behavior during dependency degradation.
- [ ] **J5 Availability and fallback:** document kiosk outage procedures, offline
  punch capture, recovery reconciliation, RPO/RTO, and the single-host limitation.
- [ ] **J6 AI enablement gate:** before AI is enabled, fix or disprove cross-owner
  checksum deduplication and independently review document authorization.

## Release gates

- [ ] All P1 items F1-F4, G1-G3, H1, and I1 are implemented and independently
  verified before this application becomes the sole source for payroll.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` pass from
  `apps/web`, with results retained.
- [ ] Boundary tests cover overnight shifts, pay-period edges, Monday workweek
  edges, both DST transitions, and edited-approved entries.
- [ ] Security tests cover terminated admins, forced-password action denial, unique
  kiosk enrollment, last-admin concurrency, device revocation, and rate limiting.
- [ ] Failure tests cover database/query failure, storage/email/outbox failure after
  commit, stale concurrent review, and truthful retry guidance.
- [ ] A 43-user production-like load test meets recorded latency and error targets.
- [ ] One complete payroll period runs in parallel with TimeClock+, reconciles every
  employee and earning code, and receives HR sign-off before cutover.
- [ ] A finalized export is byte-for-byte reproducible; an audited correction creates
  a new version without changing the original.
- [ ] Backup restore, rollback, schema gate, kiosk fallback, and monitoring alert
  procedures are exercised and recorded.
- [ ] Final independent security, payroll-integrity, UX/accessibility, and complete
  diff reviews pass with no unresolved P0/P1 findings.
