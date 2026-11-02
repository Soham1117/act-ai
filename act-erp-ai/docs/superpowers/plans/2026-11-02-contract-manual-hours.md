# Contract crew manual + mass hours Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins can add single and mass closed time entries for contract workers (Active/Inactive/Ended), with an opt-in smart helper for assignment date/status adjustments.

**Architecture:** Pure proposal helpers in `lib/contract-workers.ts`; create/preview/commit server actions beside existing contract time admin actions; UIs on worker detail, Hours tab, and a new `/admin/contract-workers/mass` wizard mirroring employee Mass Hours. No schema change.

**Tech Stack:** Next.js server actions, Prisma `ContractTimeEntry`, Zod, Vitest, existing `time-rules` / `inline-panel` / `WizardSteps`.

## Global Constraints

- Contract tables only — never write `TimeEntry`.
- Approvals use admin **User** id/name (existing contract model).
- No payroll closed-period checks.
- Helper never mutates silently — only when the admin accepts the offer.
- Reason required (3–500). Approve now optional.

---

### Task 1: Pure smart-helper proposals

**Files:**
- Modify: `act-erp-ai/apps/web/src/lib/contract-workers.ts`
- Test: `act-erp-ai/apps/web/src/lib/contract-workers.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ContractAssignmentOffers = {
    shiftStartTo?: string; // YYYY-MM-DD
    extendEndTo?: string;
    reactivate?: boolean;
  };
  export type ContractAssignmentOfferDefaults = {
    shiftStart: boolean;
    extendEnd: boolean;
    reactivate: boolean;
  };
  export function proposeContractAssignmentOffers(
    worker: { startDate: Date; endDate: Date | null; status: "ACTIVE" | "INACTIVE" | "ENDED" },
    entryDate: Date, // date-only UTC midnight
  ): { offers: ContractAssignmentOffers; defaults: ContractAssignmentOfferDefaults };

  export function applyContractAssignmentOffers(
    worker: { startDate: Date; endDate: Date | null; status: "ACTIVE" | "INACTIVE" | "ENDED" },
    entryDate: Date,
    accepted: ContractAssignmentOffers,
  ): { startDate: Date; endDate: Date | null; status: "ACTIVE" | "INACTIVE" | "ENDED" } | { error: string };
  ```

- [ ] **Step 1: Write failing tests** for before-start, after-end, inactive/ended defaults, refuse when shiftStart unchecked, success when accepted.

- [ ] **Step 2: Implement helpers** (date-only compare via `.getTime()`).

- [ ] **Step 3: Run** `pnpm exec vitest run src/lib/contract-workers.test.ts` — pass.

---

### Task 2: Server actions — manual create + mass preview/commit

**Files:**
- Modify: `act-erp-ai/apps/web/src/server/actions/contract-workers.ts`
- Create: `act-erp-ai/apps/web/src/server/actions/contract-mass-hours.ts`
- Create: `act-erp-ai/apps/web/src/server/actions/contract-mass-hours.test.ts` (unit-test plan/middleBreak via exported helpers or thin pure extract if needed)

**Interfaces:**
- `adminCreateManualContractTimeEntry({ contractWorkerId, clockIn, clockOut, jobCode?, notes?, breaks?, reason, approve?, offers? })`
- `previewMassContractHours({ contractWorkerIds, date, clockInTime, clockOutTime, jobCode, breakMin, reason, approve? })`
- `commitMassContractHours({ ...same, perWorkerOffers: Record<id, ContractAssignmentOffers> })`

Behavior:
- Resolve job code: input → else worker.jobCode if active → else company default; fail if none.
- Lock with `withContractWorkerLock`; apply accepted offers then create entry; audit.
- Mass: mid-shift break like `mass-hours.ts`; skip overlaps on commit; return created/skipped counts.

- [ ] **Step 1: Implement actions** (reuse `parseLocal`, overlap, reasonSchema patterns from `contract-workers.ts`; extract shared overlap helper if needed rather than duplicating badly).

- [ ] **Step 2: Add focused tests** for offer application refusal path (pure) + any exported plan helper.

---

### Task 3: Single-entry UI

**Files:**
- Create: `act-erp-ai/apps/web/src/app/(admin)/admin/contract-workers/add-entry-panel.tsx`
- Modify: `act-erp-ai/apps/web/src/app/(admin)/admin/contract-workers/[id]/page.tsx`
- Modify: `act-erp-ai/apps/web/src/app/(admin)/admin/contract-workers/page.tsx` (Hours tab entry point)
- Modify: `act-erp-ai/apps/web/src/app/(admin)/admin/contract-workers/hours-table.tsx` or shared header actions as needed

- [ ] **Step 1: Build Add entry panel** with datetime-local, job code, optional breaks, reason, approve, and helper checkboxes when offers apply (compute client-side from worker dates + clock-in date, or call a tiny preview action). Prefer client-side proposal via exported pure helper for snappy UX; server re-validates.

- [ ] **Step 2: Wire into worker detail and Hours tab.**

---

### Task 4: Mass hours wizard page

**Files:**
- Create: `act-erp-ai/apps/web/src/app/(admin)/admin/contract-workers/mass/page.tsx`
- Create: `act-erp-ai/apps/web/src/app/(admin)/admin/contract-workers/mass/mass-contract-hours-wizard.tsx`
- Modify: `act-erp-ai/apps/web/src/components/hours-subnav.tsx` or contract Hours tab links
- Modify: `act-erp-ai/apps/web/src/server/queries/contract-workers.ts` if a roster query for the wizard is needed

- [ ] **Step 1: Wizard** — select workers → times → preview (overlap + offers) → commit with per-row offer toggles.

- [ ] **Step 2: Link from Contract workers Hours tab** (“Mass hours”).

---

### Task 5: Verify

- [ ] Run `pnpm exec vitest run src/lib/contract-workers.test.ts src/server/actions/contract-mass-hours.test.ts`
- [ ] `pnpm exec tsc --noEmit` for touched packages (or project usual check)
- [ ] Manual smoke: add entry before start with helper on; mass for Ended without reactivate
