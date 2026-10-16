/** Constants shared by the self-service seed part and the specs (no Playwright imports: safe for the seed script). */
export type SsUser = { employeeId: string; name: string; email: string; password: string };

const user = (n: number, first: string, last: string): SsUser => ({
  employeeId: `EMP-2026-02${String(n).padStart(2, "0")}`,
  name: `${first} ${last}`,
  email: `${first.toLowerCase()}.${last.toLowerCase()}@e2e.test`,
  password: `E2e-${first}-Pass-1!`,
});

/** One dedicated employee per spec area, so state-changing tests never touch Erin. */
export const SS = {
  leah: user(1, "Leah", "Leave"), // leave.spec.ts (employee side)
  lou: user(2, "Lou", "Leaveadmin"), // leave-admin.spec.ts (admin reviews Lou's requests)
  reed: user(3, "Reed", "Reimburse"), // reimbursements.spec.ts
  rita: user(4, "Rita", "Reimburseadmin"), // reimbursements-admin.spec.ts
  quinn: user(5, "Quinn", "Request"), // requests.spec.ts
  ben: user(6, "Ben", "Benefits"), // benefits.spec.ts (employee view, seeded coverage)
  bea: user(7, "Bea", "Benefitsadmin"), // benefits-admin.spec.ts (admin enrols Bea)
  dana: user(8, "Dana", "Documents"), // documents.spec.ts
  nina: user(9, "Nina", "Notices"), // notifications.spec.ts
  sam: user(10, "Sam", "Settings"), // settings.spec.ts (PIN, email, consents)
  pam: user(11, "Pam", "Password"), // settings.spec.ts (password change only)
  olive: user(12, "Olive", "Other"), // "somebody else" whose data must stay private
  rory: user(13, "Rory", "Readonly"), // terminated a few days ago: read-only account
} as const;

export const SS_DEPARTMENT = "E2E Self-Service Dept"; // only Nina belongs to it
export const SS_EMPTY_DEPARTMENT = "E2E SS Empty Dept"; // nobody belongs to it
export const SS_PLAN_MEDICAL = "E2E Medical PPO"; // seeded, tiers EMPLOYEE_ONLY + FAMILY
export const SS_PLAN_DENTAL = "E2E Dental Basic"; // seeded, tier EMPLOYEE_ONLY only
export const SS_PLAN_401K = "E2E 401k Plan"; // seeded retirement plan
export const SS_OLIVE_RECEIPT = "olive-secret-receipt.pdf";
export const SS_OLIVE_DOC_TITLE = "Olive Private Document";
