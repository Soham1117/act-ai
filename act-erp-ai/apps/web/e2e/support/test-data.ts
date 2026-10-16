/** Fixed identifiers created by e2e/seed.ts. Specs import these, never hard-code. */
export const E2E_PORT = 3100;
export const BASE_URL = `http://localhost:${E2E_PORT}`;

export const IP_INSIDE = "10.99.1.5"; // inside KIOSK_ALLOWED_NETWORKS
export const IP_OUTSIDE = "203.0.113.9"; // outside it (TEST-NET-3)

export const JOB_CODE = { code: "E2E100", title: "E2E Fabrication" };
export const INACTIVE_JOB_CODE = { code: "E2E999", title: "E2E Retired Code" };

export const KIOSK_ACTIVE_SLUG = "e2e-kiosk"; // pre-activated on the test device (employee tests)
export const KIOSK_CREW_SLUG = "e2e-kiosk-crew"; // pre-activated (contract crew tests; own rate limits)
export const KIOSK_NEW_SLUG = "e2e-new-kiosk"; // never activated; used by activation tests

export const EMPLOYEE = { employeeId: "EMP-2026-0001", name: "Erin Employee" };
export const INACTIVE_EMPLOYEE = { employeeId: "EMP-2026-0002", name: "Ivan Inactive" };
export const PIN_EMPLOYEE = { employeeId: "EMP-2026-0003", name: "Pia Pinless" };
export const WRONG_PIN = "9999";

export const AGENCY = { name: "E2E Staffing Co" };
export const CONTRACT_WORKER = { workerId: "CW-9001", name: "Casey Contract" };
export const CONTRACT_WORKER_APPROVE = { workerId: "CW-9002", name: "Avery Approve" };
export const CONTRACT_WORKER_REJECT = { workerId: "CW-9003", name: "Riley Reject" };

export const PAYROLL_PERIOD_TITLE = "E2E Pay Period"; // all hours present: ready to export
export const PAYROLL_BLOCKED_TITLE = "E2E Blocked Period"; // missing hours: needs an override

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}. Is .env.e2e loaded (see playwright.config.ts)?`);
  return v;
}

/** Saved admin session (created in global-setup.ts). */
export const ADMIN_STATE = "e2e/.auth/admin.json";
