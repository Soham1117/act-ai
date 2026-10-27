import { Badge } from "@/components/ui/badge";

export const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

export type LiveStatus = "ACTIVE" | "ON_BREAK" | "OUT";

export type AgencyOption = { id: string; name: string; isActive: boolean };
export type JobCodeOption = { code: string; title: string };

export type WorkerRow = {
  id: string;
  workerId: string;
  name: string;
  phone: string | null;
  agencyId: string;
  agencyName: string;
  jobCode: string | null;
  project: string | null;
  startDate: string; // YYYY-MM-DD
  endDate: string | null;
  status: "ACTIVE" | "ENDED" | "INACTIVE";
  notes: string | null;
  liveStatus: LiveStatus;
  endingSoon: boolean;
};

export type AgencyRow = {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  isActive: boolean;
  workerCount: number;
};

export type HoursRow = {
  id: string;
  date: string; // YYYY-MM-DD
  workerDbId: string;
  workerCode: string;
  workerName: string;
  agencyName: string;
  project: string | null;
  jobCode: string;
  clockIn: string; // ISO
  clockOut: string | null;
  totalBreakMin: number;
  totalWorkMin: number;
  isOpen: boolean;
  approvalStatus: "PENDING" | "APPROVED" | "REJECTED";
  approvalNotes: string | null;
  editReason: string | null;
  autoClosed: boolean;
  fromKiosk: boolean;
  hasClockInPhoto: boolean;
  hasClockOutPhoto: boolean;
};

export function LiveBadge({ status }: { status: LiveStatus }) {
  if (status === "ACTIVE")
    return (
      <Badge variant="success" className="text-[10px]">
        On site
      </Badge>
    );
  if (status === "ON_BREAK")
    return (
      <Badge variant="warning" className="text-[10px]">
        On break
      </Badge>
    );
  return (
    <Badge variant="outline" className="text-[10px] text-muted-foreground">
      Off site
    </Badge>
  );
}

export function ApprovalBadge({ status, open }: { status: HoursRow["approvalStatus"]; open?: boolean }) {
  if (open)
    return (
      <Badge variant="outline" className="text-[10px]">
        Open
      </Badge>
    );
  return (
    <Badge
      variant={status === "APPROVED" ? "success" : status === "REJECTED" ? "destructive" : "warning"}
      className="text-[10px]"
    >
      {status === "APPROVED" ? "Approved" : status === "REJECTED" ? "Rejected" : "Pending"}
    </Badge>
  );
}
