# Benefits Catalog + Age Rates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed ACT 2026–27 medical (age-banded) + vision plans with official docs, and replace plan create/edit modals with full pages.

**Architecture:** Add `BenefitPlanAgeRate`; resolve medical EE cost by attained age; persist resolved amount onto enrollment override at confirm. Vision uses existing tiers. Admin create/edit move to `/admin/benefits/new` and `/admin/benefits/[id]/edit`.

**Tech Stack:** Prisma/Postgres, Next.js App Router, existing `benefits.ts` actions, vitest.

**Spec:** `docs/superpowers/specs/2026-10-29-benefits-catalog-age-rates-design.md`

## Global Constraints

- Plan year medical/vision seed: `2026-07-01` → `2027-06-30`
- Medical codes: S9J7ADT (BASE), G9E5ADT / P611ADT (BUY_UP)
- Vision rates from image.png; medical age $ from Renewal_Ltr.pdf
- No dental/401k seed in this change
- Do not page-ify roll-forward dialog

## File map

| Path | Role |
|---|---|
| `prisma/schema.prisma` | `BenefitPlanAgeRate` |
| `src/lib/benefit-age-rates.ts` | attained age + band lookup |
| `src/lib/benefit-age-rates.test.ts` | unit tests |
| `src/lib/act-2026-benefit-seed-data.ts` | constant rate tables |
| `scripts/seed-act-2026-benefits.ts` | idempotent seed |
| `src/server/actions/benefits.ts` | upsert age rates; enrollment cost resolve |
| `src/app/(admin)/admin/benefits/plan-form.tsx` | shared form (ex-dialog) |
| `src/app/(admin)/admin/benefits/new/page.tsx` | create page |
| `src/app/(admin)/admin/benefits/[id]/edit/page.tsx` | edit page |
| `src/app/(admin)/admin/benefits/page.tsx` | link to new page; drop PlanDialog |
| `src/app/(admin)/admin/employees/[id]/benefits-card.tsx` | show resolved medical cost |

### Task 1: Schema + age resolver (TDD)

- [ ] Add `BenefitPlanAgeRate` to schema; `pnpm prisma migrate` / SQL for Lightsail
- [ ] Write failing tests for attained age + lookup
- [ ] Implement `benefit-age-rates.ts`
- [ ] Commit

### Task 2: Actions + seed data

- [ ] Extend `upsertBenefitPlan` with optional `ageRates`
- [ ] On enrollment confirm for MEDICAL with age rates, set `employeeCostOverride` from resolver when override empty
- [ ] Add seed constants + `scripts/seed-act-2026-benefits.ts` (plans, tiers, age rates; doc attach best-effort)
- [ ] Commit

### Task 3: Admin pages + enrollment UI

- [ ] Extract `plan-form.tsx`; add new/edit pages; remove create/edit modal usage
- [ ] Age-band editor section for MEDICAL
- [ ] Benefits card cost preview + official rates link when `resourceVersionId` set
- [ ] Commit

### Task 4: Deploy

- [ ] Apply migration + run seed on Lightsail
- [ ] Verify catalog lists 3 medical + vision; new plan is a page
