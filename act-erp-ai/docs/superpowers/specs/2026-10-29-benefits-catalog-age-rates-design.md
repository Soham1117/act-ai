# Benefits catalog, age-banded medical rates, and plan create page — design spec

**Date:** 2026-10-29  
**Status:** Approved — implementing  
**Product:** ACT Persona / ACT ERP (`act-erp-ai/apps/web`)

## Goal

1. Seed ACT’s real **2026–2027 medical** plans (Silver base + Gold/Platinum buy-ups) with **age-banded employee costs** from the renewal letter, plus **Vision** with flat rates from the official Avēsis sheet (`image.png`).
2. Attach **official plan documents/images** so the catalog looks legitimate in-app.
3. Replace admin “New plan / Edit plan” **modals** with **full pages**.
4. Keep eligibility as already implemented: Medical/Vision = first of month after 60 days.

## Locked decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Medical premiums | **Structured age bands** from `Renewal_Ltr.pdf` (employee cost after ACT contribution) |
| Vision premiums | **Flat 4-tier monthly** from `PLANS_FOR_MEDICAL/image.png` |
| Medical dependent matrix | **Not modeled** yet — use enrollment cost override when needed |
| Medical tier `BenefitPlanTier` rows | Keep EE/spouse/children/family rows; medical EE cost still resolved from age table when present |
| Official artifacts | Upload/link SBCs + renewal letter + vision image as `BENEFIT_RESOURCE` / plan `resourceVersionId` |
| Plan year | **2026-07-01 → 2027-06-30** (renewal letter), not the 2025 calendar printed on older SBCs |
| Contribution rule (notes) | ACT pays **70% of Silver employee-only**; EE pays remaining 30% + **100% of dependent** coverage; letter costs are **already net of ACT contribution** |
| Gold rollover | Document in plan notes: Gold enrollees auto-move to Silver Jul 1 2026 unless new form by Jun 26 2026 |
| Create/edit UI | **Full pages** `/admin/benefits/new` and `/admin/benefits/[id]/edit` — remove create/edit `PlanDialog` modal |
| Roll-forward | Keep existing dialog for v1 (out of scope to page-ify) |
| Dental / 401(k) seed | **Out of scope** this change (no dental SBC rates in folder) |

## Approaches considered

### Age rates

1. **Image-only attachments** — rejected as sole solution: cannot compute paycheck cost.
2. **Fake single flat medical tiers** — rejected: BCBS quote is age-rated; wrong numbers.
3. **`BenefitPlanAgeRate` rows (recommended)** — `planId + ageFrom + ageTo + monthlyEmployeeCost + perPay26EmployeeCost`; enrollment resolves by employee DOB.

### Create UI

1. Keep modal — rejected (user request).
2. Full page create/edit (recommended) — reuse form fields from `plan-dialog.tsx` on dedicated routes.

## Data model

### New: `BenefitPlanAgeRate`

```prisma
model BenefitPlanAgeRate {
  id                    String      @id @default(cuid())
  planId                String
  plan                  BenefitPlan @relation(fields: [planId], references: [id], onDelete: Cascade)
  /// Inclusive lower bound of attained age for this band.
  ageFrom               Int
  /// Inclusive upper bound (use 120 for "64+").
  ageTo                 Int
  /// Employee cost AFTER employer contribution, monthly.
  monthlyEmployeeCost   Decimal     @db.Decimal(10, 2)
  /// Same cost on a 26-pay period (from renewal letter "26 PP" column).
  perPay26EmployeeCost  Decimal     @db.Decimal(10, 2)

  @@unique([planId, ageFrom, ageTo])
  @@index([planId])
}
```

Rules:
- Only used when `BenefitPlan.type === MEDICAL` and rows exist.
- Bands must be contiguous and non-overlapping per plan (validate on write).
- Letter bands: `<15`, single ages 15–20, `21–24`, then 25, 30, 35, … 60, `64+` as in the PDF (implement exactly as listed; ages between listed singles like 26–29 fall into nearest defined band by **ageFrom..ageTo** expansion — see seed table below).

### Existing `BenefitPlan` / `BenefitPlanTier`

Unchanged shape. For seeded medical plans:
- `planCode` = `S9J7ADT` / `G9E5ADT` / `P611ADT`
- `planDesignation` = `BASE` | `BUY_UP`
- `costPeriod` = `MONTHLY` for catalog display; enrollment UI shows both monthly and 26-pay from age row when present
- `BenefitPlanTier`: create standard four tiers with **0/0** employee/employer for medical (age table is source of EE cost); vision tiers get real monthly EE costs, employer 0

### Seed age bands (from renewal letter page 2)

Expand letter rows into inclusive ranges:

| ageFrom | ageTo | label on letter |
|--------:|------:|-----------------|
| 0 | 14 | &lt;15 |
| 15 | 15 | 15 |
| 16 | 16 | 16 |
| 17 | 17 | 17 |
| 18 | 18 | 18 |
| 19 | 19 | 19 |
| 20 | 20 | 20 |
| 21 | 24 | 21–24 |
| 25 | 29 | 25 (through day before 30) |
| 30 | 34 | 30 |
| 35 | 39 | 35 |
| 40 | 44 | 40 |
| 45 | 49 | 45 |
| 50 | 54 | 50 |
| 55 | 59 | 55 |
| 60 | 63 | 60 |
| 64 | 120 | 64+ |

Dollar amounts: copy Silver / Gold / Platinum **Monthly** and **26 PP** columns from `Renewal_Ltr.pdf` into seed data (constants file, not hand-typed in UI).

Vision monthly EE (employer 0):

| Tier | Monthly |
|---|---:|
| EMPLOYEE_ONLY | 7.36 |
| EMPLOYEE_SPOUSE | 13.93 |
| EMPLOYEE_CHILDREN | 15.17 |
| FAMILY | 19.52 |

## Resolution algorithm

```
function employeeMedicalCost(plan, employeeDob, asOfDate):
  if plan has no age rates → fall back to BenefitPlanTier for selected tier
  age = attained age in years as of asOfDate (enrollment effectiveDate)
  row = age rate where ageFrom <= age <= ageTo
  if missing → require employeeCostOverride (fail closed with clear error)
  return { monthly: row.monthlyEmployeeCost, perPay26: row.perPay26EmployeeCost }
```

Enrollment create/edit:
- Pre-fill displayed cost from resolver when MEDICAL + DOB present.
- Persist using existing override fields when the resolved amount differs from tier table (medical tier table is 0) — **store resolved monthly (or per-pay matching plan.costPeriod) into `employeeCostOverride`** at confirm time so history stays correct if age bands change later.
- If no DOB: block confirm until override entered or DOB added.

## Documents / “official image”

- Seed/upload into company documents (`purpose: BENEFIT_RESOURCE`, category BENEFITS):
  - Vision `image.png` (Avēsis rate/summary sheet)
  - `Renewal_Ltr.pdf`
  - `SILVER.pdf` / `GOLD.pdf` / `PLAT.pdf` (or existing SBC copies)
- Set each plan’s `resourceVersionId` to the matching approved version when available.
- Admin plan detail and enrollment picker: show link/thumbnail to the attached resource (“Official plan sheet”).

## Admin UI

### Routes

| Route | Purpose |
|---|---|
| `GET /admin/benefits` | Catalog list (existing); **New plan** → link to `/admin/benefits/new` |
| `GET /admin/benefits/new` | Create plan page (form) |
| `GET /admin/benefits/[id]/edit` | Edit plan page (same form) |
| `GET /admin/benefits/[id]` | Optional detail: tiers + age table + document link (nice-to-have in same PR if cheap; else edit page hosts age table editor) |

### Form behavior (create/edit page)

- Same fields as today’s `PlanDialog` (type, name, carrier, year, cost period, tier grid, 401k text).
- **Additional section when type = MEDICAL:** editable age-band table (or read-only after seed with “Replace bands” admin action).
- Submit → existing `upsertBenefitPlan` extended to accept optional `ageRates[]`.
- Cancel → back to `/admin/benefits`.
- Remove `PlanDialog` usages for create/edit. Keep `RollForwardDialog` as dialog.

### Employee Benefits card

- When selecting a medical plan, show resolved cost line: “Age {n} → $X.xx/mo ($Y.yy / 26-pay)” using DOB.
- Link “View official rates” → resource file.

## Eligibility

No code change required for the waiting-period math (`INSURANCE_60_DAYS` already = +60 days then first of next month).

Ops: confirm Medical + Vision policies in `/admin/benefits/eligibility` as **confirmed** with that rule for the 2026 plan year (data/seed or one-time admin action in implementation plan).

## Out of scope

- Dental plan seed / dental premiums
- Full dependent age-rating matrix for medical
- Changing payroll deduction engine
- Page-ifying roll-forward
- Employee self-service enrollment

## Implementation sketch (not the plan yet)

1. Prisma migration + age-rate helpers + tests (band lookup, attained age).
2. Extend benefits actions for age rates; enrollment confirm writes override from resolver.
3. Seed script/idempotent upsert for 3 medical + 1 vision + document attach.
4. Replace modal with new/edit pages; wire age table UI + official doc link.
5. Deploy migration + seed on Lightsail; smoke admin catalog + one enrollment cost preview.

## Success criteria

- Admin opens Benefits and sees Silver/Gold/Platinum/Vision for 2026-07-01 plan year without using a modal to create them.
- “New plan” navigates to a full page.
- Picking Silver for an employee with DOB shows the letter’s age-band employee cost; official image/PDF is one click away.
- Vision enrollment shows the four monthly rates from `image.png`.
- Medical/Vision eligibility still proposes first-of-month-after-60-days.
