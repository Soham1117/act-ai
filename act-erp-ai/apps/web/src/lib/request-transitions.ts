export type RequestStatusKey = "PENDING" | "PROCESSING" | "COMPLETED" | "REJECTED";

/**
 * Allowed admin status transitions. COMPLETED and REJECTED are terminal; the
 * only way out is the explicit, audited `reopenRequest` action (-> PENDING).
 */
export const REQUEST_TRANSITIONS: Record<RequestStatusKey, RequestStatusKey[]> = {
  PENDING: ["PROCESSING", "REJECTED", "COMPLETED"],
  PROCESSING: ["COMPLETED", "REJECTED"],
  COMPLETED: [],
  REJECTED: [],
};
