# Handoff — Onboarding packet + paystub/TCP roster sync

**Date:** 2026-10-28 → 2026-10-29  
**Prod:** `https://persona.americancompletiontools.com`  
**Compose:** `infra/docker-compose.prod-lite.yml`  
**Server path:** `/home/ubuntu/act-erp-ai/act-erp-ai`  
**Host:** Lightsail `3.134.179.142` (key: `D:/Deployed Projects/LightsailDefaultKey-us-east-2.pem`)

---

## What this session delivered

### A. Public new-hire onboarding packet (code + deploy)

Expanded the public invite wizard from a thin form into the full ACT new-hire packet.

**Product decisions locked in**
- Approach **B**: full ACT packet (not minimal)
- Direct deposit **structured (A)**: routing/account fields, not free text only
- Wizard **approach 1**: multi-step single form flow
- Consent version: `act-2026-new-hire-v1`

**Behavior**
- Multi-step onboard at `/onboard/[token]`
- Uniform native selects + date inputs (consistent field UX)
- Draft save/resume: `localStorage` + server draft on invite (no password stored)
- Readable draft-restored banner / save feedback
- Admin can review packet on employee profile via packet panel
- On successful submit: draft cleared (`Prisma.DbNull`)

**Schema**
- `OnboardingInvite`: `draftJson`, `draftStep`, `draftUpdatedAt`
- `OnboardingPacketSubmission`: `consentVersion`, `application`, `drugAlcohol`, `background`, `directDeposit` (sensitive — admin-only), `handbook`

**Key files**
| Path | Role |
| --- | --- |
| `apps/web/src/lib/onboarding-packet.ts` | Packet shape + consent version |
| `apps/web/src/lib/onboarding-draft.ts` | Draft parse/merge |
| `apps/web/src/lib/onboarding-options.ts` | Select options |
| `apps/web/src/app/onboard/[token]/onboarding-form.tsx` | Wizard UI |
| `apps/web/src/app/onboard/[token]/page.tsx` | Invite load + draft hydrate |
| `apps/web/src/server/actions/onboarding.ts` | `saveOnboardingDraft` + submit |
| `apps/web/src/components/onboarding-packet-panel.tsx` | Admin review |
| `apps/web/prisma/schema.prisma` | Invite draft + packet model |
| `apps/web/e2e/onboarding.spec.ts` | E2E updates |
| `apps/web/src/lib/portal-i18n/catalogs/auth.ts` | Copy / i18n |

---

### B. Roster: paystub names = source of truth (prod data change)

**Policy**
1. Paystub legal names win over TCP nicknames / Persona display names.
2. Anyone on paystubs but missing from Persona → create.
3. Anyone on TCP but missing from Persona → create (after paystub coverage).

**Script (uncommitted):** `apps/web/scripts/sync-paystub-tcp-roster.ts`  
Also copied on server to the same path under `/home/ubuntu/act-erp-ai/act-erp-ai/`.

**Sources used**
- Paystubs PDF: `Paystubs/Paystubs 10-29-2026.pdf` (on server: `.../persona-deploy-20261028-roster-sync/paystubs.pdf`)
- TCP people JSON derived from SpreadsheetML: `Paystubs/Employee Information-2026-10-28-11-29-59.xml` → `tcp-people.json`

**Prod apply result (2026-10-28 ~23:52–23:54Z)**
| Action | Count |
| --- | ---: |
| Renames to paystub spelling | 27 |
| Creates from paystubs | 4 |
| Creates from TCP | 43 |
| Final `Employee` count | **91** |

**Paystub creates**
- Aanchal Gupta, Tushar D Modi, Yajuvendra A Singh, Leonard C Tice  
- Include `ssnLast4` from stubs where parsed

**Notable renames (examples)**
- Jose Gonzalez → **Jose Gonzales**
- Alex Torres → **Alexandro Torres**
- Deepak Somarajan → **Deepak S Pillai**
- Tapan (TJ) Sinha → **Tapan J Sinha**
- Ron Schmidt → **Ronald Wayne Schmidt**
- Ken Stokley → **Kenneth W Stokley**
- Plus middle-initial / legal-form updates for many others

**New account defaults**
- Role `EMPLOYEE`, status `ACTIVE`
- Temp password: `{username}123!` (first letter uppercased in hash construction)
- `mustChangePassword: true`
- Default kiosk PIN hash
- TCP creates: address/hire/location (`jobTitle` = TCP location) when present
- TCP creates: **no SSN**

**Audit actions**
- `employee.name.paystub_sync`
- `employee.create.paystub_sync`
- `employee.create.tcp_sync`
- Actor: `system@roster-sync`

**Ops artifacts (server)**
- Dir: `/home/ubuntu/persona-deploy-20261028-roster-sync/`
- Plans: `dry-run.json`, `apply.json`, `apply2.json`
- DB backup before apply:  
  `backups/persona-pre-roster-sync-20261028T235200Z.sql.gz`  
  (`pg_dump -U act -d act`)

**Local helper / ops scripts (not product):**  
`apps/web/.foreman/portal-es-20261022/apply-roster-sync.sh`, `check-roster-state.sh`, `find-missing-tcp.sh`, `cleanup-orphans-and-finish.sh`, `verify-final-roster.sh`

---

## Incidents during apply (already fixed)

1. **Duplicate risk in dry-run** — TCP would have re-created Jose / Deepak / Tapan. Fixed with first+last rematch + anchored alias regexes (Jose must not cover Jamie Gonzales).
2. **Username unique constraint** mid-TCP create — `takenUsernames` only loaded employee-linked users; collided with existing `User` rows (e.g. `atorres`). Fixed: load **all** `User.username`; create path skips if employee name already exists (idempotent re-run).
3. **Orphan `User` rows** (Damon Roland / Kamylia Marcello) left without `Employee` after failed transaction edge. Deleted orphans; finished remaining 4 TCP creates (Damon, Jennifer Minier, Kamylia, Alondra Torres). Verified: 0 missing vs plan.

---

## Git / deploy state

- Branch: `main` **ahead of origin by 1** commit (kiosk-related; not this handoff’s focus).
- **Most session code is still uncommitted** (onboarding packet, draft fields, roster script, plus other in-tree HR/paystub work).
- Roster **data** is already on prod; script file is on prod web tree but not necessarily in a clean git commit.
- Do **not** re-run `--apply` casually without dry-run — script is mostly idempotent now, but still creates people if name matching misses.

---

## What next session should do

### Priority
1. **Commit** onboarding + roster script (and only related files) with a clear message; push when asked.
2. **Confirm schema on prod** for `draftJson` / `OnboardingPacketSubmission` if the onboarding deploy landed before this handoff was written — smoke-test one invite: save draft → refresh → submit → admin packet panel.
3. **New-hire password hygiene** — 47 new accounts use predictable temp passwords. Force reset / issue one-time invites / disable login until HR provisions, or rotate.
4. **SSN backfill** — plan listed empty-SSN fills from paystubs; rename path only fills when `ssnLast4` empty. Confirm whether a dedicated backfill loop is still needed (plan’s `ssnBackfills` was computed but not a separate write loop beyond rename).
5. **Data quality pass on TCP creates** — nicknames, typos (`Chance MIddleton`), empty location, missing SSN, `gender: OTHER` placeholder.
6. **Deduplicate people** — Jamie Gonzales vs Jose Gonzales are intentionally separate; watch for true duplicates (same person, different spelling) HR may still need to merge.
7. **Re-verify paystub matcher** after renames — earlier Gonzales/Alexandro/Ronald mismatches should now align; run `scripts/check-paystub-names.ts` or batch import dry-run if used.

### Do not
- Restore the pre-roster `sql.gz` over live DB without isolating attendance first (would wipe punches after backup time).
- Treat TCP nicknames as canonical over paystubs again.
- Commit `.env`, dumps, paystub PDFs, or `persona-deploy-*` secrets/PII into git.

### Useful commands

```bash
# Dry-run roster (tools profile)
cd /home/ubuntu/act-erp-ai/act-erp-ai/infra
docker compose -f docker-compose.prod-lite.yml --profile tools run --rm \
  -v /home/ubuntu/persona-deploy-20261028-roster-sync:/data \
  -v /home/ubuntu/act-erp-ai/act-erp-ai/apps/web/scripts/sync-paystub-tcp-roster.ts:/app/scripts/sync-paystub-tcp-roster.ts \
  tools tsx scripts/sync-paystub-tcp-roster.ts \
  --paystubs /data/paystubs.pdf \
  --tcp /data/tcp-people.json
# Add --apply only after reviewing JSON counts
```

---

## Quick verification checklist for next agent

- [ ] `Employee` count still ~91 (or explained growth)
- [ ] Spot-check: Jose Gonzales, Alexandro Torres, Deepak S Pillai, Tapan J Sinha, Jamie Gonzales (separate)
- [ ] Spot-check stub creates exist with SSN last4
- [ ] Orphan `User` where `role=EMPLOYEE` and no `Employee` → should be **0**
- [ ] Public onboard invite: draft persists across refresh; submit clears draft
- [ ] Admin employee page shows packet panel for completed hire
- [ ] Working tree: separate onboarding/roster commit from unrelated HR/paystub-batch dirty files if both exist

---

## Related local paths

- Paystubs / TCP XML: `D:/Deployed Projects/ACT Persona/Paystubs/`
- Local roster backup copy: `D:/Deployed Projects/ACT Persona/data/backups/roster-sync-20261028/` (if present)
- Prior HR release notes (adjacent, not this session’s core): `docs/HR_RELEASE_2026-10-28.md`
