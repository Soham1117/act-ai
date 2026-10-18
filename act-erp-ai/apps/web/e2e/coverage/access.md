# Access control + smoke coverage

Specs: `access-routes.spec.ts` (matrix, rows in `support/access-routes.ts`), `access-session.spec.ts`,
`access-password.spec.ts`, `smoke.spec.ts`. Seed: `seed-parts/10-access.ts`.

## Auth server actions (`src/server/actions/auth.ts`)

| Item | Scenario | Status | Spec |
|---|---|---|---|
| `requestLoginChallenge` | success, wrong password, unknown user, lockout, server failure | covered | login.spec.ts |
| `requestLoginChallenge` | ended employee (past grace) refused with a clear message; also admin linked to an ended employee | covered | access-session.spec.ts "cannot sign in" / "kills the session" |
| `requestLoginChallenge` | `next=` open-redirect (https, //, /\, javascript:) ignored; same-site next honoured | covered | access-session.spec.ts "login next= redirect safety" |
| `requestLoginChallenge` | 2FA code path (LOGIN_2FA_ENABLED=true) | not-testable | switched off in the E2E environment |
| `verifyLoginChallenge` | any scenario | not-testable | only reachable with 2FA on (off in E2E) |
| `signOut` | logout, back button shows nothing, cookie gone | covered | access-session.spec.ts "sign out ends the session" |
| `signOut` | server failure | covered | access-session.spec.ts "server failure during sign out" |
| `changeMyPassword` | forced change: gate, mismatch, too short, wrong current, same password | covered | access-password.spec.ts |
| `changeMyPassword` | success: new password works, old refused, old session dead, tokenVersion +1, audit row | covered | access-password.spec.ts "success" |
| `changeMyPassword` | server failure (abort, 500) on forced page and on Settings | covered | access-password.spec.ts (found a real crash, fixed) |
| `changeMyPassword` | rate limit (8 per 15 min) | planned | needs 9 calls on one user; low value |

## Session rules

| Item | Scenario | Status | Spec |
|---|---|---|---|
| tokenVersion bump | page and API refuse an old session | covered | access-session.spec.ts |
| access ends mid-session | session dies, sign-in refused | covered | access-session.spec.ts |
| role change | promote and demote take effect next request (pages + punch-photo API) | covered | access-session.spec.ts |
| read-only (grace) | banner, can read own payslip, settings forms hidden | covered | access-session.spec.ts |
| read-only (pending review) | approval banner | covered | access-session.spec.ts |
| read-only | write on a stale open form is refused, nothing saved | covered | access-session.spec.ts |
| session 8h expiry | JWT age | not-testable | needs clock control of the server |

## Page routes (role x anon / employee / grace / ended / admin; see the table in `support/access-routes.ts`)

| Item | Scenario | Status | Spec |
|---|---|---|---|
| `/admin` and all `/admin/*` pages (26 incl. id pages), `/kiosk` | all five roles; 404 for unknown ids | covered | access-routes.spec.ts |
| `/dashboard` and all `/dashboard/*` pages (14) | all five roles | covered | access-routes.spec.ts |
| `/`, `/login`, `/onboard`, `/onboard/[token]`, `/unauthorized`, `/privacy`, `/auth/forgot-password`, `/change-password`, `/kiosk/[slug]`, unknown URL | all five roles | covered | access-routes.spec.ts |
| every page above | renders: status < 400, no console errors, heading/main, no error screen | covered | smoke.spec.ts |
| kiosk terminals | render with the device cookie | covered | smoke.spec.ts |
| chat + knowledge pages | AI off: "Page not found" | covered | access-routes.spec.ts, smoke.spec.ts |
| chat/knowledge pages with AI on | chat workspace | not-testable | AI is off in E2E |

## API routes

| Item | Scenario | Status | Spec |
|---|---|---|---|
| `/api/health`, `/api/auth/*`, `/api/v1/identity/jwks`, `/api/v1/identity/[operation]` | public to the Proxy; identity answers 503 without secrets | covered | access-routes.spec.ts |
| `/api/documents/[id]/file`, `/api/payroll/[id]/file`, `/api/reimbursements/receipts/[id]/file` | owner/admin 200 with the right bytes; other employee 403; grace user reads own; anon redirect; ended 401; missing 404 | covered | access-routes.spec.ts |
| `/api/employees/[id]/profile-pic` | any signed-in user; anon/ended refused; missing 404 | covered | access-routes.spec.ts |
| `/api/punch-photo` | admin only; 400 on bad params; 404 on no photo | covered | access-routes.spec.ts |
| `/api/knowledge/[id]/file`, `/api/knowledge/[id]/view` | AI off: 404 | covered | access-routes.spec.ts |
| `/api/knowledge/*` with AI on (scope 403) | owner/grant rules | not-testable | AI off in E2E |
| `/api/chat` | AI off: 503; anon redirect | covered | access-routes.spec.ts, smoke.spec.ts |
| `/api/notifications/unread` | signed-in 200, anon redirect; mustChangePassword gets 307 | covered | access-routes.spec.ts, access-password.spec.ts |
| `/admin/activity/export` | admin CSV; employee 403; anon redirect; ended 401 | covered | access-routes.spec.ts |
