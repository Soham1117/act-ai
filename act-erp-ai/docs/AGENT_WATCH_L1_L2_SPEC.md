# Persona Watch: L1 flags and L2 digest (plain code, no AI)

Proposed November 2, 2026. Spec only; nothing built. Source ideas: `AI_AGENT_USE_CASES.md` (numbers like #1 refer to it).

## Goal

A scheduled job reads existing data, raises **findings** (flags) for the manager, and sends a **daily digest**. Manager spends time on exceptions, not on hunting through pages.

## Non-goals

- No language model, no external API, no employee data leaves the server.
- No writes to punches, pay, leave, or employee records. Findings only. (L3/L4 come later.)
- No new login role. The job runs as a system process, not as a user. An `AGENT` role is deferred until L3.
- No emails or texts to employees.

## Fit with existing code

| Need | Reuse |
| --- | --- |
| Punches, breaks | `TimeEntry`, `TimeBreak`, `ContractTimeEntry` (has `autoClosed`, `source`, `approvalStatus`, photo keys) |
| Schedule | `Schedule`, `ScheduledWork` |
| Pay periods | `PayrollCalendar` (`closedAt`, `status`), `payroll-close.ts`, `payroll-overtime.ts` |
| Time zone and rounding rules | `BUSINESS_TZ` and helpers in `src/lib/time-rules.ts` |
| Notify manager | `Notification` and `NotificationRecipient` (types `TIME`, `PAYROLL`, `SYSTEM`) |
| Audit | `AuditLog` (action string, resource, diff) |
| Scheduled runner pattern | `runDueHoursExportSchedules` in `src/server/hours-export-runner.ts` |
| Page | New admin page next to Hours / Time tracking; reuse `hours-ui.tsx`, click-to-sort tables, `inline-panel.tsx` |

Scheduler: see Decisions. The existing hours-export runner is not scheduled in prod today.

## Data model (additive, one migration)

```
WatchFinding
  id            cuid
  ruleId        string        // "time.missing-clock-out"
  fingerprint   string        // ruleId + subject + period, e.g. "time.missing-clock-out:<entryId>"
  severity      INFO | WARN | CRITICAL
  status        OPEN | ACKNOWLEDGED | SNOOZED | RESOLVED | DISMISSED
  subjectType   string        // Employee | TimeEntry | ContractTimeEntry | PayrollCalendar | ...
  subjectId     string
  employeeId    string?       // for filtering; never contains SSN or pay amounts in text
  title         string        // short, plain English
  detail        text          // why it was flagged, with the numbers
  likelyCause   string?       // static text per rule
  suggestedFix  string?       // static text per rule
  fixLink       string?       // deep link to the page that fixes it
  evidence      json          // ids and numbers the rule used (no PII beyond ids)
  firstSeenAt, lastSeenAt, resolvedAt, snoozeUntil
  handledById   uuid?, handledNote text?

  unique (fingerprint)        // one row per issue; re-runs update lastSeenAt
  index (status, severity), (ruleId, status), (employeeId)

WatchRun
  id, startedAt, finishedAt, trigger (SCHEDULE | MANUAL), rulesRun json,
  created int, updated int, autoResolved int, errors json

WatchDigest
  id, forDate date, sentAt, recipientCount, summary json   // unique (forDate)

WatchRuleConfig
  ruleId (pk), enabled bool, params json, updatedById, updatedAt
```

Lifecycle:
- A rule run returns the set of currently true findings. New fingerprint: insert OPEN. Existing: update `lastSeenAt`/evidence.
- Fingerprint no longer returned: set RESOLVED, `autoResolved` count goes up. No manager action needed.
- DISMISSED stays dismissed for that fingerprint (the manager said "not a problem"). SNOOZED reopens at `snoozeUntil`.
- Every manager action (acknowledge, snooze, dismiss) writes an `AuditLog` row (`watch.finding.dismiss`, etc.). Dismiss and snooze counts feed rule quality later.

## Rule interface

```ts
type RuleContext = { now: Date; tz: "America/Chicago"; params: unknown; db: PrismaClient };
type FindingDraft = {
  fingerprint: string; severity: Severity; subjectType: string; subjectId: string;
  employeeId?: string; title: string; detail: string; likelyCause?: string;
  suggestedFix?: string; fixLink?: string; evidence: Record<string, unknown>;
};
type Rule = {
  id: string; group: "time" | "contract" | "payroll" | "hr" | "data" | "security";
  defaultParams: unknown;                 // thresholds, editable in admin
  run(ctx: RuleContext): Promise<FindingDraft[]>;   // read-only, no side effects
};
```

Rules are pure read-only queries plus arithmetic, one file each in `src/server/watch/rules/`, registered in one list. Each rule has a test file with fixtures. A rule that throws is logged to `WatchRun.errors` and skipped; it never blocks the others.

## Scheduling

- Every 15 minutes: time-sensitive rules (missing clock-in/out, impossible shifts, kiosk offline).
- Hourly: duplicates, schedule vs actual for the day.
- Nightly at 01:00 America/Chicago: payroll, HR, data, security rules.
- Daily digest at 07:00 America/Chicago.
- Concurrency lock (Postgres advisory lock) so two runs never overlap.
- "Run now" button on the admin page (admin-only, audited).

## Findings page: `/admin/watch`

- Table (sortable): severity, rule, who, title, first seen, status. Filters: status, severity, group, employee.
- Row opens an inline panel: detail, evidence, likely cause, suggested fix, **Open the fix page** link, and buttons Acknowledge / Snooze (1 day, 1 week) / Dismiss with note.
- Top counts: Critical, Warn, Info, "auto-resolved this week".
- Rules tab: enable/disable each rule and edit its thresholds. Every change audited.
- Employees never see this page. Admin only; same guard as other `(admin)` routes.

## Daily digest (L2)

Delivered as a `Notification` (type `SYSTEM`, link to `/admin/watch`) to admin recipients. Optional email later if email infrastructure exists (open question).

Content (template string, no generated prose):
1. Headline: "3 need you, 14 resolved on their own since yesterday."
2. **Needs you:** Critical and Warn findings, top 10 by severity then age, each one line with link.
3. **Yesterday:** punches, hours, overtime hours, open items count.
4. **This period:** pay period dates, days to close, close blockers count, hours vs previous period.
5. **Coming up (14 days):** pay date, benefit eligibility dates, 401(k) entry dates, expiring documents.
6. Quiet-day message when nothing needs attention ("All clear.") so silence is never ambiguous.

Weekly digest (Mondays): repeat offenders (same employee 3+ flags in 4 weeks), rule dismiss rates, overtime by department.

## Rule catalog (v1)

Thresholds are defaults, editable in `WatchRuleConfig`. "Employees" means active employees only unless noted.

### Time and attendance
| ID | Use case | Logic | Severity |
| --- | --- | --- | --- |
| `time.missing-clock-out` | #1 | `clockOut` null and (now > scheduled end + 60 min, or clockIn older than 12 h) and not `autoClosed` | WARN, CRITICAL if period closes within 2 days |
| `time.missing-clock-in` | #2 | `Schedule` shift started 30+ min ago, no `TimeEntry` that day, no approved leave | WARN |
| `time.overtime-pace` | #3 | Week hours so far + remaining scheduled hours > 40 (or 38 as a warning) | INFO to WARN |
| `time.break-missing` | #4 | Completed shift over 6 h with zero breaks (threshold from policy) | WARN |
| `time.break-length` | #5 | Break under 20 min for a meal break, or over 60 min | INFO |
| `time.impossible-shift` | #6 | Shift over 16 h, or overlapping entries for one employee | CRITICAL |
| `time.duplicate-punch` | #7 | Two entries for one employee with clock-ins within 2 min | WARN |
| `time.photo-missing` | #9 | KIOSK source with null photo key | INFO |
| `time.early-arrival-pattern` | #11 | 3+ clock-ins over 20 min before schedule in 14 days | INFO |
| `time.holiday-work` | #13 | Entry on company holiday or scheduled day off, no note | INFO |
| `time.schedule-variance` | #14 | Week total vs scheduled differs by over 4 h | INFO |
| `time.rounding-drift` | #12 | Rounded vs raw (`actualClockIn/Out`) differ in one direction in 80%+ of last 20 entries | INFO |
| `time.unapproved-aging` | new | `approvalStatus` PENDING more than 3 days | WARN |

### Contract crew
| ID | Use case | Logic |
| --- | --- | --- |
| `contract.missing-clock-out` | #21 adaptation | Same as time rule, on `ContractTimeEntry` |
| `contract.photo-or-code-missing` | #21, #23 | Entry with no photo key or empty `jobCode` |
| `contract.long-tenure` | #24 | Worker active more than a configured number of days |
| `contract.agency-hours-week` | #25 (L2) | Weekly hours per agency, shown in digest |

### Payroll
| ID | Use case | Logic | Severity |
| --- | --- | --- | --- |
| `payroll.close-blockers` | #31 | For the open `PayrollCalendar` period: count PENDING approvals, open punches, unresolved CRITICAL findings, employees with hours and no rate | CRITICAL within 2 days of period end |
| `payroll.missing-rate` | #32 | Hours > 0 and no rate on entry or employee | CRITICAL |
| `payroll.rate-change` | #33 | Rate differs from previous period with no `editReason` or note | WARN |
| `payroll.gross-variance` | #34 | Employee gross or hours changed by over 25% vs previous period (and over 4 h) | WARN |
| `payroll.total-spike` | #35 | Period total over 10% above the average of the last 4 periods | WARN |
| `payroll.terminated-with-hours` | #39 | Terminated employee with entries after termination date | CRITICAL |
| `payroll.new-hire-no-forms` | #40 | Hours exist and W-4 / I-9 checklist item not Accepted | WARN |
| `payroll.reimbursement-unpaid` | #43 | Reimbursement approved over 14 days ago, not marked paid | INFO |
| `payroll.period-gap` | #44 | Gap or overlap between consecutive `PayrollCalendar` periods | WARN |
| `payroll.overtime-forecast` | #50 (L2) | Projected overtime hours and cost this period, in digest |

Note: the digest and the rules must reuse the exact same overtime and hours functions the payroll export uses (`payroll-overtime.ts`), so the flag and the paycheck never disagree.

### HR and onboarding
| ID | Use case | Logic |
| --- | --- | --- |
| `hr.onboarding-stuck` | #76 | Checklist item not progressed in 3+ days |
| `hr.i9-late` | #77 | No accepted I-9 within 3 business days of hire date |
| `hr.handbook-unsigned` | #79 | No `HandbookAcknowledgment` for current version, 7+ days after hire |
| `hr.eligibility-upcoming` | #80, #81 | Proposed benefit or 401(k) date in next 30 days (from existing assessments) |
| `hr.terminated-active-login` | #85 | Terminated employee whose `User` is still enabled |
| `hr.temp-password` | #87 | Account still on an initial password after 7 days (if the app records this; else skip) |
| `hr.stale-admin` | #86 | Admin not logged in for 60 days |
| `hr.filing-deadline` | #89 | Configured quarterly filing dates within 14 days |

### Data quality
| ID | Use case | Logic |
| --- | --- | --- |
| `data.duplicate-employee` | #93 | Normalized name equality, or same last name plus first-name edit distance 1 plus same DOB or phone; never auto-merge |
| `data.missing-fields` | #95 | Active employee with empty department, location, manager, or `ssnLast4` |
| `data.placeholder-values` | #100 | Known placeholders (e.g. gender OTHER from imports) |
| `data.import-failures` | #96 | Failed or skipped rows from the last TCP import |
| `data.unknown-job-code` | #99 | Entry `jobCode` not in `JobCode` |
| `data.paystub-unmatched` | #97 | Paystub import rows with no employee match |

### Security and system
| ID | Use case | Logic |
| --- | --- | --- |
| `sec.failed-login-burst` | #103 | 10+ failed logins for one account or IP in 15 min (from existing auth tables or logs) |
| `sec.after-hours-admin` | #104 | Admin write actions between 22:00 and 05:00 (from `AuditLog`) |
| `sec.large-export` | #105 | Payroll or hours export run (`AuditLog`), listed in digest |
| `sec.sensitive-download` | #106 | Same user downloads 10+ sensitive documents in a day |
| `sys.kiosk-stale` | #107 | Kiosk with no heartbeat for 30 min during business hours |
| `sys.backup-stale` | #108 | Newest backup older than 26 h (needs a read of the backup status; if unavailable, defer) |

Total in v1: about 45 rules covering roughly 55 of the 120 use cases (the rest are L3/L4 or need AI).

## Privacy and safety rules

- Finding text carries names via `employeeId` lookup at display time, not stored in `detail`. Never SSN, pay amounts above what the viewing admin can already see, bank info, health info, or note contents.
- Pay amounts appear only in `payroll.*` findings and only on the admin page.
- All rule SQL runs with the app's existing DB role; no new credentials.
- Read-only: a test asserts rules never call create/update/delete on non-Watch tables.
- Every manager action is audited.
- A global kill switch (`WATCH_ENABLED` env or `CompanyDefault` flag) stops the scheduler.

## Build phases

| Phase | Scope | Done when |
| --- | --- | --- |
| 0 | Confirm scheduler trigger, manager recipients, thresholds with the manager and HR | Open questions answered |
| 1 | Migration, rule runner, lock, `WatchRun`, 5 starter rules (#1, #31, #34, #93, digest) | Rules run on prod data in shadow mode (no notifications), results reviewed by hand |
| 2 | `/admin/watch` page, acknowledge / snooze / dismiss, audit | Manager can work a full day from the page |
| 3 | Daily digest as notification, quiet-day message | Digest arrives for 5 working days and is accurate |
| 4 | Remaining time, contract and payroll rules | Each rule passes its fixtures plus a back-test |
| 5 | HR, data, security, system rules; rule config UI; weekly digest | Catalog complete |

Phase 1 runs in **shadow mode** for a week: findings are stored and reviewed with the manager, but no digest goes out. Back-test each rule on the last 8 weeks of prod data (read-only copy) and count hits. A rule that fires more than about 5 times a day for the whole company gets its threshold raised before going live, because a noisy flag list gets ignored.

## Verification

- Unit tests per rule: normal case, boundary values, null dates, DST changes (America/Chicago), employee on leave, terminated employee, contract vs employee.
- Runner tests: idempotent re-run (no duplicate findings), auto-resolve, dismiss stays dismissed, snooze reopens, one failing rule does not stop the others, lock prevents overlap.
- Read-only test as above.
- Back-test script reports hits per rule over the last 8 weeks and sample findings.
- Browser test: findings page filters, inline panel actions, admin-only access (employee gets redirected).
- Production: backup first, additive migration only, deploy through the existing overlay script, shadow mode first.

## Success measures (after 4 weeks)

- Manager acts on (not dismisses) at least 70% of Critical and Warn findings.
- Fewer than 10 new open findings per day on a normal day.
- Zero payroll corrections after close that a rule should have caught.
- Time the manager spends finding problems goes down (ask them).

## Decisions (Nov 2, 2026)

1. **Scheduler:** checked prod. `runDueHoursExportSchedules` has no caller anywhere in the app, and the server has no cron entry for it (only backups). So scheduled hours exports never fire on their own; only the "run now" button works. This is an existing gap to fix separately. Watch will use a **host cron on the Lightsail box** (same style as the backup cron, `CRON_TZ=America/Chicago`) that calls a secret-protected internal route in the web container. The same cron can also fire the hours-export schedules.
2. **Recipients:** Soham and Deepak (admin users). Stored as a setting, not hard-coded, so more people can be added later. No supervisor routing in v1.
3. **Email:** SES is set up (domain `americancompletiontools.com` verified, `noreply@` sender in `.env.example`, `src/lib/email.ts` exists) but the account is in **sandbox** (`ProductionAccessEnabled: false`, 200 mails/day). In sandbox it can only send to verified addresses. Today that is soham@americancompletiontools.com plus two gmail addresses. Deepak's address must be verified, or request SES production access. Entra is only the sign-in; it is not used for sending. v1 = in-app notification plus email digest to verified recipients.
4. **Policy numbers (editable, see below):** overtime over 40 hours per week, weekly only (no daily rule); 30-minute lunch; two paid 15-minute breaks (morning, afternoon). The kiosks log only the lunch; the 15-minute breaks are **not logged**, so rules check lunch only and never flag short breaks.
5. **Email recipients:** soham@americancompletiontools.com and deepak@americancompletiontools.com. Deepak's address still has to be verified in SES (sandbox).
6. **Holidays:** all major US federal holidays, seeded from a list and editable.

## Editable policy (new, because HR and the manager will change things)

A `WatchPolicy` settings screen (admin only, every change audited with who/when/old/new), stored in `WatchRuleConfig.params` plus a shared policy record:

| Setting | Default |
| --- | --- |
| Weekly overtime threshold (hours) | 40 |
| Lunch required if shift longer than (hours) | 6 |
| Lunch length (minutes) | 30 |
| Short breaks per shift (paid, not logged, informational only) | 2 |
| Short break length (minutes) | 15 |
| Max shift length (hours) | 16 |
| Missing clock-out grace (minutes) | 60 |
| Digest send time | 07:00 America/Chicago |
| Digest recipients | Soham, Deepak |
| Company holidays | list, editable |
| Per-rule on/off and thresholds | see rule catalog |

Rules read these at run time, never from code constants. Changing a setting takes effect on the next run and is recorded. Break rules (`time.break-missing`, `time.break-length`) check the lunch only: one logged lunch of at least 30 minutes on shifts over the lunch threshold. The two 15-minute breaks are paid and not logged, so they are never checked.

## Remaining open questions

1. Verify deepak@americancompletiontools.com in SES (sends him a confirmation link), or request SES production access.
2. How do we know a temp password is unchanged? Does the app record it? (otherwise skip `hr.temp-password`)
3. Backup status source for `sys.backup-stale`: the prod cron writes to `/home/ubuntu/act-backups/erp-backup.log`; decide in phase 5.

## Progress (updated Nov 2, 2026)

Legend: [x] done, [~] partly, [ ] not started.

### Phase 0: decisions
- [x] Scheduler: host cron on Lightsail (every 15 min), token-protected route
- [x] Recipients: Soham and Deepak
- [x] Policy numbers (40 h weekly OT, 30 min lunch, 2 paid unlogged 15 min breaks)
- [x] Holidays: all major US holidays (not yet seeded)
- [ ] Verify deepak@americancompletiontools.com in SES (or request production access)

### Phase 1: runner and starter rules
- [x] Tables: WatchFinding, WatchRun, WatchRuleConfig (live on prod)
- [x] Runner: store, update, auto-resolve, dismissed stays dismissed, overlap guard
- [x] Rules: missing clock-out, close blockers, hours variance, duplicate employee
- [x] Digest builder (template only, not sent yet)
- [x] Cron every 15 min on prod, shadow mode
- [ ] Back-test the rules on 8 weeks of data and tune thresholds
- [x] Hours variance was noisy (32 flags): it compared a half-finished period with a full one. Now runs only after the period ends
- [x] Duplicate flag: only ACTIVE employees are compared (the second Jose Gonzalez was inactive)
- [x] Close blockers: quiet until 3 days before period end; today's running shifts are not blockers

### Phase 2: findings page
- [x] /admin/watch: tabs, severity filter, search, details, acknowledge, snooze, dismiss, reopen
- [x] "Check now" button, audit log on every action
- [ ] Browser test (upload e2e spec)
- [ ] Rules tab: on/off per rule

### Phase 3: digest
- [ ] Send the daily digest as in-app notification to Soham and Deepak
- [ ] Email the digest (needs SES recipient verification)
- [ ] Weekly digest

### Phase 4 and 5: the rest of the L1 and L2 rules
- [x] Time, attendance and contract rules (batch A), payroll, leave and reimbursement rules (batch B)
- [x] HR, onboarding, benefits, data quality, security and system rules (batch C and D)
- [x] Eight weekly reports on the Reports tab (batch E)
- [x] 70+ rules and reports live on prod; see the coverage map below for what each one covers
- [ ] Rules list in the app: switch rules on or off and edit thresholds (today: database row in WatchRuleConfig)
- [ ] Policy settings screen (recipients, holidays, thresholds)
- [ ] Turn on `time.missing-clock-in` once everyone punches in Persona; turn on `time.lunch` once kiosks log lunch
- [ ] Watch what the manager dismisses for 2 weeks, then tune noisy rules (the flag quality report helps)

### Platform
- [x] One deploy script (infra/scripts/deploy.sh): local build, registry layer diff, rollback
- [x] 4 GB swap on the server
- [ ] Hours-export schedules are never triggered (no caller): wire into the same cron or retire

## Coverage map: all 81 L1 and L2 ideas (status Nov 2, 2026)

Numbers refer to `AI_AGENT_USE_CASES.md`. Employees do have a `supervisorId`, but 89 of 90 are blank, so the supervisor check is skipped.
Rules switched off by default (noisy on today's data): `time.missing-clock-in` (55 scheduled, 11 punched on day one, because most people still clock at the old TCP clock) and `time.lunch` (kiosks do not log lunch).

**Live (rule or report running on prod)**
- Time and attendance: 1, 2*, 3, 4*, 5*, 6, 7, 8, 9 (missing photo only), 11, 12, 13, 14   (* switched off for now)
- Contract: 21, 23, 24, 28, 25, 29 (hours only)
- Payroll: 31, 34 (hours based), 35 (hours total), 36, 37, 38, 39, 40, 43, 44, 48, 50
- Leave and reimbursements: 55, 56, 58
- HR: 74, 76, 77, 79, 80, 81, 83, 84, 85, 87, 89, 91, 92
- Data and security: 93, 95, 99, 100, 102, 104, 105, 106, 107 (idle kiosks only), 108 (database size only)
- Reports: 48, 52, 110, 113, 115, 116, 117

**Not built, with the reason**
- 10 buddy punching, 9 blurry or mismatched photo: need image analysis (AI)
- 22 agency invoice mismatch: no invoice data in the system
- 32, 33 missing pay rate and rate changes: payroll runs outside Persona, 80% of entries have no rate (only 28 of 78 hourly staff have a rate stored). Hours-based checks stand in for these
- 41 SSN last four: stored encrypted; checking would mean decrypting, skipped for privacy
- 42 deduction vs election: payroll deductions are not stored (paystubs are files)
- 78 expiring work authorization: no expiry date is stored anywhere
- 86, 103 admin and failed logins: login events are not recorded
- 94, 96, 97 import and paystub mismatches: unmatched rows are not saved anywhere (needs an import log table)
- 62 delegation: needs an "away" status for admins
- 109, 119 undo feedback and trust score: need L3/L4 actions first
- 111, 112 "ask the system" and plain-language explanations: need a language model (later, optional)
- 51 daily digest: the text builder exists; sending it (notification and email) is not built
