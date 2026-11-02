# Contract crew manual + mass hours — design spec

**Date:** 2026-11-02  
**Status:** Approved — implementing  
**Product:** ACT Persona / ACT ERP (`act-erp-ai/apps/web`)

## Goal

Admins can add missing **contract crew** history times through the portal:

1. **Single entry** — one worker, one closed shift (mirror employee “Add manual time entry”).
2. **Mass hours** — many workers, same calendar day and times (mirror employee Mass Hours wizard).

Employees stay unchanged. Contract time stays on `ContractTimeEntry` / `ContractTimeBreak` and never touches payroll closed-period locks.

## Locked decisions

| Decision | Choice |
|---|---|
| Scope | Contract workers only (Approach 1 — mirror employees, keep tables isolated) |
| Who can receive entries | Active, Inactive, and Ended |
| Approval on create | Optional “Approve now” (default off) |
| Outside assignment dates | Smart helper offers date shifts; not silent |
| Before `startDate` | Offer to shift `startDate` to the entry’s business date (default **on** when offered) |
| After `endDate` | Offer to extend `endDate` to the entry’s business date (default **on** when offered) |
| Inactive / Ended | Offer to reactivate to Active (default **off**) |
| If admin declines a needed date offer | Refuse create with a clear error |
| Job code | Default from worker assignment / company default; override allowed |
| Breaks (single) | Optional break editor (employee Add entry pattern) |
| Breaks (mass) | One mid-shift unpaid break in minutes |
| Provenance | `editReason` prefix (`Manual entry:` / `Mass hours:`) — no schema `source` field this round |
| Payroll closed periods | Do **not** apply to contract entries |

## Approaches considered

1. **Mirror employees, keep contract isolated (chosen)** — new contract actions + UIs; reuse shared time math.
2. Polymorphic employee Mass Hours / Add entry — rejected (couples payroll paths and different approver models).
3. Shared generic engine package first — rejected as overbuild for this gap.

## Data rules

### Create shape

- Always create a **closed** entry: `clockIn` + `clockOut`, `status = COMPLETED`, `date = businessDateOnly(clockIn)`.
- `approvalStatus = PENDING` unless Approve now → `APPROVED` with `approvedById` / `approvedByName` / `approvalDate` (admin **User**, same as existing contract review).
- Overlap: reject if another non-`REJECTED` entry for that worker overlaps the new window (same rule as `adminEditContractTimeEntry`).
- Validate with `validateEntryTimes` + `computeEntryTotals`; persist break rows when present.
- Required reason (3–500 chars). Stamp `lastEditedById` and `editReason`.

### Smart helper (pure proposal → opt-in apply)

Given worker `{ startDate, endDate, status }` and entry business date `D`:

| Condition | Proposal | Default checked |
|---|---|---|
| `D < startDate` | `shiftStartTo: D` | yes |
| `endDate != null && D > endDate` | `extendEndTo: D` | yes |
| `status` is `INACTIVE` or `ENDED` | `reactivate: true` | no |

Commit applies only proposals the admin accepted. Apply worker updates **in the same transaction** as entry create(s), under `withContractWorkerLock`. Audit both the entry create and any assignment/status change.

If after applying accepted offers the entry date would still fall before `startDate` or after `endDate`, fail (admin unchecked a required date offer).

**Note:** Reactivate is independent of date offers. Historical backfill for Ended crew can extend dates without putting the worker On Site.

### Mass hours

- One date + clock-in/out times (HH:mm Central) + optional mid-shift break minutes + job code + reason + approve.
- Preview returns per-worker: name, overlap, work minutes, and helper proposals.
- Commit creates entries for workers without overlap; workers with overlap are skipped/reported (same spirit as employee Mass Hours).
- Per-worker helper acceptances are independent.

## Surfaces

| Surface | Behavior |
|---|---|
| `/admin/contract-workers/[id]` | “Add entry” panel on the worker detail |
| `/admin/contract-workers?tab=hours` | “Add entry” (pick worker) and link to Mass hours |
| `/admin/contract-workers/mass` | Mass Hours wizard |

After create, entries appear on the existing Hours tab for approve/edit/export.

## Out of scope

- Employee Mass Hours / Add entry changes  
- Multi-day bulk in one commit  
- TCP import into `ContractTimeEntry`  
- Adding `source` enum to `ContractTimeEntry`  
- Payroll workbook / period export coupling  

## Success criteria

- Admin can create a historical closed shift for an Ended worker with helper extending `endDate` and without reactivating.
- Admin can create a shift before `startDate` only when the shift-start offer is accepted (or start was already early enough).
- Mass hours preview shows overlap + helper offers; commit is transactional per worker lock.
- Existing kiosk punch + approve/edit paths unchanged.
- Focused unit tests cover helper proposals and refuse-when-unchecked behavior.
