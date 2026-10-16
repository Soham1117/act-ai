# E2E coverage matrix

This file is the index. Detailed rows (one per server action and scenario) live in
`e2e/coverage/<area>.md`, one file per area. Row format and statuses are in
`e2e/AUTHORING.md`. A vitest guard (`src/lib/e2e-coverage-guard.test.ts`) fails CI when a
server action or API route is not mentioned in this file or in `e2e/coverage/*.md`.

| Area | Fragment | Specs |
|---|---|---|
| Access control, file routes, smoke | `coverage/access.md` | `access-*.spec.ts`, `smoke.spec.ts` |
| Employee self-service (leave, reimbursements, requests, benefits, documents, notifications, my details) | `coverage/self-service.md` | `leave*`, `reimbursements*`, ... |
| Admin people (employees, onboarding, hire packet, departments, job codes) | `coverage/people.md` | `employees*`, `onboarding*`, ... |
| Payroll and time tracking | `coverage/payroll-time.md` | `payroll-*`, `time-*` |
| Schedules | `coverage/schedules.md` | `schedules*`, `my-schedule*` |
| Kiosk | `coverage/kiosk.md` | `kiosk-*` |
| Contract workers | `coverage/contract.md` | `contract-*` |
| Login and core flows (first suite) | this file, below | `login.spec.ts` and others |

## Items without a spec area

AI features are switched off in the test setup (`AI_ENABLED=false`), so they are not testable end to end.

| Item | Scenario | Status | Spec |
|---|---|---|---|
| `uploadKnowledgeDocument`, `retryKnowledgeDocument`, `setDocumentGrants` | knowledge base upload / retry / grants | not-testable | needs the AI worker, SQS and an agent service; `AI_ENABLED=false` in tests |
| `saveChatTurn`, `listChatSessions`, `getChatSessionMessages` | chat sessions | not-testable | chat is disabled when `AI_ENABLED=false`; page state is checked by the smoke suite |
| `api/chat` | chat endpoint | not-testable | requires the agent service |
| `api/knowledge/[id]/file`, `api/knowledge/[id]/view` | knowledge file proxy | not-testable | AI feature off; access rules covered in `coverage/access.md` |
| `api/v1/identity/jwks`, `api/v1/identity/[operation]` | customer portal identity adapter | not-testable | needs HMAC and private-key config that is not part of the test environment |
| `api/auth/[...nextauth]` | NextAuth handler | covered | `login.spec.ts` (sign-in) and `access-*` (sessions) |
| `api/health` | health check | covered | used as the web server readiness probe in `playwright.config.ts` |
| `api/version` | deployed build version (used by the kiosk to detect a stale page) | covered | `kiosk-session.spec.ts`, `smoke.spec.ts` (route reachable); logic in `src/lib/kiosk-version.test.ts` |
