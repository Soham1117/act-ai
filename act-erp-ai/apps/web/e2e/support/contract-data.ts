/** Pure constants for the contract-worker specs and seed part (no DB / no Playwright imports). */
export const CW_KIOSK_COUNT = 40;
/** Each test uses its own kiosk so the in-memory kiosk rate limits (20 roster loads/min) never collide. */
export const cwKioskSlug = (n: number) => `e2e-cw-kiosk-${n}`;
export const cwKioskSuffix = (n: number) => `-cw${n}`;

export const CW_AGENCY = {
  alpha: "CW Alpha Staffing",
  beta: "CW Beta Staffing",
  dormant: "CW Dormant Staffing", // inactive, has one worker
  existing: "CW Existing Name", // for duplicate-name tests
};

export const CW_JOB = {
  active: { code: "CWT100", title: "CW Test Active" },
  second: { code: "CWT200", title: "CW Test Second" },
  inactive: { code: "CWT900", title: "CW Test Retired" },
};

export const CW_SEED_DORMANT_WORKER = { workerId: "CW-7001", name: "Dora Dormant" };
export const CW_SEED_OLDCODE_WORKER = { workerId: "CW-7002", name: "Ivy Oldcode" };
