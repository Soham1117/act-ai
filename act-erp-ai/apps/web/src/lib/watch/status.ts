export type FindingAction = "ACKNOWLEDGE" | "SNOOZE_1D" | "SNOOZE_7D" | "DISMISS" | "REOPEN";
export type FindingStatus = "OPEN" | "ACKNOWLEDGED" | "SNOOZED" | "RESOLVED" | "DISMISSED";

export const FINDING_ACTIONS: FindingAction[] = [
  "ACKNOWLEDGE",
  "SNOOZE_1D",
  "SNOOZE_7D",
  "DISMISS",
  "REOPEN",
];

const DAY_MS = 24 * 60 * 60_000;

/** Which manager actions make sense for a finding in this status. */
export function allowedActions(status: FindingStatus): FindingAction[] {
  switch (status) {
    case "OPEN":
      return ["ACKNOWLEDGE", "SNOOZE_1D", "SNOOZE_7D", "DISMISS"];
    case "ACKNOWLEDGED":
      return ["SNOOZE_1D", "SNOOZE_7D", "DISMISS", "REOPEN"];
    case "SNOOZED":
      return ["ACKNOWLEDGE", "DISMISS", "REOPEN"];
    case "DISMISSED":
      return ["REOPEN"];
    case "RESOLVED":
      return [];
  }
}

export function applyAction(
  status: FindingStatus,
  action: FindingAction,
  now: Date,
): { status: FindingStatus; snoozeUntil: Date | null } | null {
  if (!allowedActions(status).includes(action)) return null;
  switch (action) {
    case "ACKNOWLEDGE":
      return { status: "ACKNOWLEDGED", snoozeUntil: null };
    case "SNOOZE_1D":
      return { status: "SNOOZED", snoozeUntil: new Date(now.getTime() + DAY_MS) };
    case "SNOOZE_7D":
      return { status: "SNOOZED", snoozeUntil: new Date(now.getTime() + 7 * DAY_MS) };
    case "DISMISS":
      return { status: "DISMISSED", snoozeUntil: null };
    case "REOPEN":
      return { status: "OPEN", snoozeUntil: null };
  }
}
