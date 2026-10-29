# Mobile responsiveness — full overhaul

**Date:** 2026-10-29  
**Status:** Approved for implementation (full surface, not essentials-only)

## Goal

Every employee and admin screen usable on ~390×844 phones: no page horizontal scroll, reachable controls, same features as desktop. Employees without home laptops; admins away from desk.

## Approach

One responsive web app + shared primitives (`ResponsiveDataList`, `StickyActionBar`, `MobileTabsList`, `FilterStack`). No native app, no `/m/*` dual routes. Kiosk shop-floor UI remains optimized for tablet use, with both kiosk routes also included in phone usability verification.

## Rules

- `md` (768) breakpoint aligns with `useIsMobile`
- Prefer stacked cards over wide tables on phone
- Touch targets ≥ 44px for primary actions
- Sticky bottom actions on long forms (safe-area)
- No dialogs on any screen: task forms, details, evidence, reviews and destructive confirmations render inline or on dedicated pages. No task Sheet/bottom-sheet substitution; mobile navigation/search expand in page flow.
- Scrollable tab chips on phone
- Preserve desktop layouts at `md+`

Full route and overlay inventories: [implementation TODO](../plans/2026-10-29-mobile-responsiveness.md), [every page](../plans/mobile-page-checklist.md), [dialog replacements](../plans/mobile-dialog-audit.md).

## Phases

1. Foundation: viewport metadata, shell, primitives, Playwright `mobile-chrome` (390×844)
2. Employee: all `/dashboard/*` + login / change-password / onboard
3. Admin: all `/admin/*`
4. Verify + Lightsail deploy

## Auth chrome note

Login/change-password/onboard/forgot-password use `AuthToolbar` (language + theme side-by-side). Fixed overlapping language button removed.
