/** Serializable row shapes passed from the server page to client components. */
export type EntryRowData = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  avatar: string;
  /** YYYY-MM-DD business date. */
  date: string;
  clockIn: string;
  clockOut: string | null;
  jobCode: string;
  /** Hourly rate stamped on the entry (or effective fallback). */
  rate: number | null;
  notes: string | null;
  status: string;
  approvalStatus: string;
  approvalNotes: string | null;
  editReason: string | null;
  autoClosed: boolean;
  source: "WEB" | "KIOSK" | "AUTO" | "MANUAL" | "TCP";
  kioskLabel: string | null;
  hasClockInPhoto: boolean;
  hasClockOutPhoto: boolean;
  totalWorkMin: number;
  totalBreakMin: number;
  breaks: { id: string; start: string; end: string | null }[];
};

export type JobCodeOption = { code: string; title: string };
export type EmployeeOption = { id: string; name: string; employeeId: string };

export const MAX_SHIFT_HOURS = 16;

/** PanelSlot / PanelSlotRow id for EntryActions edit / force-clock-out forms. */
export function entryPanelSlotId(entryId: string) {
  return `entry-${entryId}`;
}
