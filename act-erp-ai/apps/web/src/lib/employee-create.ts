/**
 * Decide how createEmployee should treat an existing User row for the
 * company-email being hired under.
 *
 * - no row → create User + Employee
 * - User with no Employee (bootstrap admin) → link Employee to that User
 * - User already has Employee → reject
 */
export function resolveEmailHireMode(
  existing: { employeeId: string | null } | null,
): "create" | "link" | "conflict" {
  if (!existing) return "create";
  if (existing.employeeId) return "conflict";
  return "link";
}
