# Writing E2E tests (read this first)

Next.js here is NOT the one you know: read `AGENTS.md` and `node_modules/next/dist/docs/` before changing app code.

## Layout
- `e2e/*.spec.ts` — specs, one file per area. Existing ones (login, schedules, kiosk-*, contract-hours, time-entry-edit, payroll-csv) must keep passing.
- `e2e/seed.ts` — base seed (do NOT edit). Your own data goes in `e2e/seed-parts/<NN>-<area>.ts`:
  `export default async function (ctx: import("../seed").SeedContext) { ... }` (use `import type`). Files run sorted, after the base seed. Use `ctx.db`, `ctx.makeEmployee`, `ctx.daysAgo`, `ctx.at`, `ctx.hash`, `ctx.admin`, `ctx.erin`, `ctx.pia`, `ctx.agency`.
- `e2e/support/test-data.ts` — base constants (do NOT edit). Put your own constants and helpers in `e2e/support/<area>.ts`.
- `e2e/support/helpers.ts` — shared: `failServerActions(page, "abort"|"500"|"stale", {times, match})`, `delayServerActions`, `collectConsoleErrors`, `expectNoCrash`, `toast`, `openKiosk`. `e2e/support/db.ts` — Prisma `db` for assertions, `businessYmd(daysAgo)`. `e2e/support/fake-s3.ts` — `fakeS3Keys()`; uploads (receipts, documents, punch photos) work against an in-memory fake S3.
- Base users (see seed.ts): admin `E2E_ADMIN_EMAIL`, employee Erin (PIN `E2E_EMPLOYEE_PIN`), ended employee Ivan, PIN-less Pia, job code E2E100 (default) + inactive E2E999. Admin session file: `ADMIN_STATE`. For an employee session, log in through the UI in a fresh context (create a helper in your own support file; login rate limit is 8 tries per identifier per 15 min, so log in once per spec file and reuse `storageState`, or create a dedicated user per area in your seed part).
- Coverage notes: write `e2e/coverage/<area>.md` (see below). Do not touch `e2e/COVERAGE.md`.

## Rules
- Deterministic: no `waitForTimeout`/sleeps (use web-first `expect`, `expect.poll`), no dependence on other spec files or run order. The DB is reset once per run (global setup), then specs run one worker, in file order. A spec must either use rows only it touches (own seed-part rows) or restore what it changes. Never rely on "today's" calendar week being a particular shape: pass explicit date ranges / compute dates in the business time zone (America/Chicago; `businessYmd`).
- Assert outcomes in the database too (not only toasts). Error paths must assert a clear message AND that nothing was saved. Do not weaken an assertion to make a test pass.
- Every mutating flow needs at least one failure-injection test (`failServerActions`) asserting message, no crash, nothing saved. Add double-click/double-submit tests (`delayServerActions` + click twice -> one row) where a duplicate would be harmful, and one "stale deployment" test (`"stale"` mode) for a representative flow, reporting how the app reacts.
- Prefer role/label selectors. If an element has no accessible name and you must add one, a small `aria-label` in app code is fine.
- Real app bug found: fix it only if the fix is small and clearly correct (say so in the commit); otherwise keep the test and mark it `test.fixme(...)` with a comment explaining the bug, file and proposed fix. List every bug in your final report. Never hide a bug.
- Files with apostrophes: create with the Write tool, not bash heredocs.
- Do not touch production, servers, `.env.prod*`, the CI workflow, `playwright.config.ts`, or the shared files above. If you need a change in a shared file, say so in your final report.
- Keep the area suite fast (target < 3 min).

## Running (each worker has its own DB + port so runs do not collide)
```
pnpm install            # once, in your worktree
export E2E_PORT=310N DATABASE_URL=postgresql://act:act@localhost:5433/act_e2e_N DIRECT_URL=postgresql://act:act@localhost:5433/act_e2e_N
pnpm exec playwright test <spec-file-or-pattern>
pnpm typecheck && pnpm lint
```
(N is your slot number. Postgres runs in docker at localhost:5433; the `act_e2e_N` databases already exist.)

## Coverage fragment format (`e2e/coverage/<area>.md`)
List EVERY exported server action in your area (from `src/server/actions/*.ts` and any `actions.ts` next to pages) by exact function name in backticks, plus page routes and API routes. One table per area:

| Item | Scenario | Status | Spec |
|---|---|---|---|
| `createLeaveRequest` | happy path | covered | leave.spec.ts "employee requests leave" |
| `createLeaveRequest` | overlaps existing request | covered | ... |
| `createLeaveRequest` | server failure | covered | ... |
| `someAction` | concurrent edit | not-testable | reason |

Status is `covered`, `planned` (explain) or `not-testable` (explain). For each action consider: happy path; every zod/validation failure and early `fail()` message; who may call it (admin/employee/anonymous/ended); state preconditions (inactive, ended, deleted, duplicate, already done); failure injection. A CI guard fails if an exported action name does not appear anywhere in `e2e/COVERAGE.md` or `e2e/coverage/*.md`.

## Done
Commit to your worktree branch in logical chunks (end commit messages with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`). Final report (short): branch name, test counts (passed/fixme), app bugs found (file, symptom, proposed fix), rows left planned/not-testable and why, shared-file changes you need.
