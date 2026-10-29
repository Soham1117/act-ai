export const CHECKLIST_STATUSES = [
  "NOT_STARTED", "SUBMITTED", "NEEDS_CORRECTION", "ACCEPTED", "NOT_APPLICABLE",
] as const;
export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number];

export const CHECKLIST_LABELS: Record<string, string> = {
  NOT_STARTED: "Not started", SUBMITTED: "Submitted", NEEDS_CORRECTION: "Needs correction",
  ACCEPTED: "Accepted", NOT_APPLICABLE: "Not applicable",
};

export const ONBOARDING_CATEGORIES = ["ONBOARDING", "HANDBOOK"];

export function canAssignTemplate(version: {
  status: string; purpose: string; document: { category: string; isArchived: boolean };
}): boolean {
  return version.status === "APPROVED" && version.purpose === "ONBOARDING_TEMPLATE" &&
    !version.document.isArchived && ONBOARDING_CATEGORIES.includes(version.document.category);
}

export function handbookReceiptText(title: string, version: number, language: "en" | "es" = "en"): string {
  if (language === "es") return `Confirmo que he recibido y puedo acceder a ${title}, versión ${version}. ` +
    "Este acuse confirma el recibo del manual; no firma ningún otro formulario ni acuerdo.";
  return `I acknowledge that I have received and can access ${title}, version ${version}. ` +
    "This acknowledges receipt of the handbook; it does not sign any other form or agreement.";
}

export function checklistComplete(items: Array<{ required: boolean; status: string }>): boolean {
  return items.every((item) => !item.required || item.status === "ACCEPTED" || item.status === "NOT_APPLICABLE");
}

export function assertChecklistOwner(item: { employeeId: string | null }, employeeId: string | null): void {
  if (!employeeId || item.employeeId !== employeeId) throw new Error("This checklist item does not belong to you.");
}

export function assertEvidenceOwner(document: { employeeId: string } | null, employeeId: string | null): void {
  if (!document || !employeeId || document.employeeId !== employeeId) {
    throw new Error("Choose a document from this employee's own files.");
  }
}
