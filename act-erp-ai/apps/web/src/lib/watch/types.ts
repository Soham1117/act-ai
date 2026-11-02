export type Severity = "INFO" | "WARN" | "CRITICAL";

export type FindingDraft = {
  fingerprint: string;
  severity: Severity;
  subjectType: string;
  subjectId: string;
  employeeId?: string;
  title: string;
  detail: string;
  likelyCause?: string;
  suggestedFix?: string;
  fixLink?: string;
  /** Ids and numbers only. Never SSN, bank info or note text. */
  evidence: Record<string, unknown>;
};

/** Editable company policy. Rules read this at run time, never constants. */
export type WatchPolicy = {
  weeklyOvertimeHours: number;
  lunchRequiredAfterHours: number;
  lunchMinutes: number;
  maxShiftHours: number;
  missingClockOutGraceMin: number;
  hoursVariancePct: number;
  hoursVarianceMinHours: number;
  earlyArrivalMinutes: number;
  earlyArrivalCount: number;
  scheduleVarianceHours: number;
  contractTenureDays: number;
  newKioskMinPriorEntries: number;
  digestHourLocal: number;
  digestRecipientEmails: string[];
};

export const DEFAULT_POLICY: WatchPolicy = {
  weeklyOvertimeHours: 40,
  lunchRequiredAfterHours: 6,
  lunchMinutes: 30,
  maxShiftHours: 16,
  missingClockOutGraceMin: 60,
  hoursVariancePct: 25,
  hoursVarianceMinHours: 4,
  earlyArrivalMinutes: 20,
  earlyArrivalCount: 3,
  scheduleVarianceHours: 4,
  contractTenureDays: 90,
  newKioskMinPriorEntries: 5,
  digestHourLocal: 7,
  digestRecipientEmails: [
    "soham@americancompletiontools.com",
    "deepak@americancompletiontools.com",
  ],
};

export function mergePolicy(stored: unknown): WatchPolicy {
  const out: WatchPolicy = { ...DEFAULT_POLICY };
  if (stored && typeof stored === "object") {
    const s = stored as Record<string, unknown>;
    for (const key of Object.keys(DEFAULT_POLICY) as (keyof WatchPolicy)[]) {
      const v = s[key];
      if (typeof v === typeof DEFAULT_POLICY[key] && v !== null) {
        (out as Record<string, unknown>)[key] = v;
      }
    }
  }
  return out;
}
