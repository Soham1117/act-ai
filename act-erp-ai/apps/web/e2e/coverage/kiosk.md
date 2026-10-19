# Kiosk (employee side) and kiosk administration

Specs: `kiosk-pin-flow`, `kiosk-pin-forced`, `kiosk-pin-lockout`, `kiosk-camera`, `kiosk-session`, `kiosk-admin` (+ older `kiosk-employee`, `kiosk-activation`). Seed: `seed-parts/60-kiosk.ts`; helpers: `support/kiosk.ts`.

| Item | Scenario | Status | Spec |
|---|---|---|---|
| `createKiosk` | happy path, audit row | covered | kiosk-admin "creates a kiosk" |
| `createKiosk` | duplicate slug | covered | kiosk-admin "duplicate slug" |
| `createKiosk` | invalid slug / blank label | covered | kiosk-admin "an unusable slug" (zod regex itself is unreachable: the form cleans the slug first) |
| `createKiosk` | failure (abort/500/stale), double submit | covered | kiosk-admin |
| `activateKiosk` | allowed network, denied network, failure | covered | kiosk-activation (existing) |
| `activateKiosk` | revoked kiosk refused | planned | UI copy says "Activating again will create a new session" but the server refuses; see bug list |
| `trustCurrentNetworkAndActivate` | happy path | covered | kiosk-activation (existing) |
| `trustCurrentNetworkAndActivate` | IPv6 connection | covered | kiosk-admin "IPv6" |
| `trustCurrentNetworkAndActivate` | kiosk deleted mid-way | planned | needs a second page state |
| `trustCurrentNetwork` | happy path, then shows allowed | covered | kiosk-admin "current IP" |
| `addTrustedNetwork` | IP, CIDR normalised, duplicate upsert | covered | kiosk-admin |
| `addTrustedNetwork` | invalid, /8, /15, /33, IPv6, blank | covered | kiosk-admin |
| `addTrustedNetwork` | server failure | covered | kiosk-admin |
| `removeTrustedNetwork` | cancel, remove, already gone | covered | kiosk-admin |
| `listKioskNetworks` | env list, current IP allowed/not allowed, last hop of X-Forwarded-For | covered | kiosk-admin |
| `getActiveKioskSession` | right/wrong/other-kiosk/made-up cookie, revoked, expired | covered | kiosk-session |
| `endKioskSession` | cookie removed, redirect, audit | covered | kiosk-session |
| `kioskListEmployees` | roster, refresh failure, 20/min limit, revoked | covered | kiosk-session, kiosk-pin-flow |
| `kioskLookup` | name/ID/digits, ambiguous, inactive, unknown, empty prefix, 30/min limit | covered | kiosk-pin-flow, kiosk-session |
| `kioskAction` | clock in/out, break, end break, wrong PIN, lockout (employee and device), stale shift, 16h cap, races, inactive, deleted | covered | kiosk-pin-flow, kiosk-pin-lockout |
| `kioskAction` | photo stored / no photo / camera denied | covered | kiosk-camera |
| `kioskAction` | failure (abort/500/stale), double tap | covered | kiosk-pin-flow |
| `kioskAction` | photo upload fails | not-testable | fake S3 cannot be told to fail (shared file) |
| `kioskChangePin` | success, weak PINs, mismatch, wrong temp PIN, already changed, failures, double submit | covered | kiosk-pin-forced |
| `kioskMyTimings` | past-30-days list, PIN check, empty state | planned | e2e spec not written |
| `revokeKiosk` | happy path, failure | covered | kiosk-admin |
| `deleteKiosk` | cancel, delete, failure-free path | covered | kiosk-admin |
| `setMyKioskPin` | employee settings form | planned | needs an employee login in a spec; not written |
| `resetEmployeeKioskPin` | confirm / cancel, audit | covered | kiosk-admin "reset an employee's kiosk PIN" |
| Camera | off on roster, on only on card, stops on cancel/idle/hidden/punch, late start, denied, no API | covered | kiosk-camera |
| Idle 30 s reset | camera released, activity restarts timer | covered | kiosk-camera (roster re-appearing not asserted: exit animation stalls under a fake clock) |
| Lockout expiry after 5 min | unlock after window | not-testable | server-side in-memory clock |
| Non-admin calling admin actions | direct call | not-testable | action ids are not reachable from the UI |
| `/kiosk` | admin list, anonymous to login | covered | kiosk-admin |
| `/kiosk/[slug]` | cookie, no cookie, 404, other kiosk | covered | kiosk-session, kiosk-employee |
| `/admin/kiosks` | states, create, revoke, delete, networks | covered | kiosk-admin |
| `/api/punch-photo` | admin 200 image/jpeg, anonymous redirect, 400, 404 | covered | kiosk-camera |
| `setKioskRequirePin` | OFF asks confirmation (cancel keeps), confirm saves + audit, ON saves at once, kiosk page follows after reload | covered | kiosk-nopin "admin: Require PIN switch" |
| `setKioskRequirePin` | server failure, kiosk deleted meanwhile | covered | kiosk-nopin |
| `setKioskRequirePin` | employee session and anonymous caller refused | covered | kiosk-nopin "employees and anonymous callers" |
| `kioskAction` | no-PIN kiosk: no PIN field, punches work, photos stored, forged client PIN ignored, 60/min limit, inactive refused | covered | kiosk-nopin |
| `kioskAction` | PIN turned on while a card is open: reload message | covered | kiosk-nopin |
| `kioskLookup` | PIN setting changed since page load: reload message | covered | kiosk-nopin |
| `kioskChangePin` | "PINs are not used at this kiosk." | covered | kiosk-nopin |

