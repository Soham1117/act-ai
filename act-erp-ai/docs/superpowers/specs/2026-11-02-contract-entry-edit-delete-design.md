# Contract entry edit + hard-delete on profile and Hours

**Status:** Approved 2026-11-02  
**Goal:** Admins can edit times and hard-delete contract time entries from the worker profile Recent entries list and from the Hours tab.

## Decisions

- **Edit:** Reuse `adminEditContractTimeEntry` (open or closed; reason required; closed/edited → PENDING).
- **Delete:** Hard-delete (`ContractTimeEntry` + cascaded breaks). Required reason (≥3 chars). Audit `contract.time.delete` with before snapshot. Allowed for open/closed/pending/approved/rejected. No employee pay-period gate.
- **UI:** Shared client actions component used by Hours table and worker detail page (Edit + Delete; Hours keeps Approve/Reject).

## Out of scope

- Bulk delete
- Soft-delete / reject-as-delete
- Editing breaks from this UI
- Assignment edit on the detail page

## Acceptance

1. Profile Recent entries: Edit times and Delete with confirm + reason.
2. Hours tab: Delete next to Edit times; edit unchanged.
3. Delete removes the row; refresh shows it gone; audit log has reason + before.
4. Overlap/validation rules for edit unchanged.
