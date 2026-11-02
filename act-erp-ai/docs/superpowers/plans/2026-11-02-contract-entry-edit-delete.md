# Contract entry edit + hard-delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hard-delete contract time entries and expose Edit + Delete on worker profile and Hours.

**Architecture:** New `adminDeleteContractTimeEntry` mirrors employee delete. Shared `ContractEntryRowActions` client component owns edit/delete panels; Hours and detail page consume it.

**Tech Stack:** Next.js server actions, Prisma, existing InlinePanel patterns.

## Global Constraints

- Reason ≥3 characters for edit and delete
- Hard-delete only (no soft-delete)
- Cascade breaks via Prisma relation
- Audit action `contract.time.delete`

---

### Task 1: Delete server action + test

**Files:**
- Modify: `apps/web/src/server/actions/contract-workers.ts`
- Create/Modify: `apps/web/src/server/actions/contract-workers-delete.test.ts` (or extend existing action tests)

- [x] Add `adminDeleteContractTimeEntry({ id, reason })`
- [x] Lock worker, load entry+breaks, delete, audit with before snapshot, revalidate
- [x] Verified via tsc (no DB mock suite for contract actions beyond helpers)

### Task 2: Shared row actions UI

**Files:**
- Create: `apps/web/src/app/(admin)/admin/contract-workers/entry-row-actions.tsx`
- Modify: `apps/web/src/app/(admin)/admin/contract-workers/hours-table.tsx`
- Modify: `apps/web/src/app/(admin)/admin/contract-workers/[id]/page.tsx`

- [x] Extract edit panel + add delete confirm panel
- [x] Minimal entry shape: id, workerName, clockIn, clockOut, isOpen
- [x] Wire Hours + detail desktop/mobile rows
- [x] Detail: Actions column / buttons on cards

### Task 3: Verify

- [x] tsc clean
- [x] lint clean for touched files
