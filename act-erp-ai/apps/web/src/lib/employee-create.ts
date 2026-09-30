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

/**
 * Next EMP-YYYY-NNNN from the highest existing suffix for the year — not a
 * row count, which undercounts after any deletion and collides with an ID
 * still in use.
 */
export function nextEmployeeIdFrom(existingIds: string[], year: number): string {
  const prefix = `EMP-${year}-`;
  const maxSeq = existingIds.reduce((max, id) => {
    if (!id.startsWith(prefix)) return max;
    const seq = Number(id.slice(prefix.length));
    return Number.isInteger(seq) && seq > max ? seq : max;
  }, 0);
  return `${prefix}${String(maxSeq + 1).padStart(4, "0")}`;
}

/** Store the optional second street line without requiring a schema change. */
export function combineAddressLines(
  address: string | null | undefined,
  address2: string | null | undefined,
): string | null {
  const lines = [address, address2]
    .map((line) => line?.trim())
    .filter((line): line is string => Boolean(line));
  return lines.length ? lines.join(", ") : null;
}

type EmployeeIdClient = {
  $executeRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<number>;
  employee: {
    findMany: (args: {
      where: { employeeId: { startsWith: string } };
      select: { employeeId: true };
    }) => Promise<{ employeeId: string }[]>;
  };
};

/**
 * Generate the next employee ID inside a transaction. Takes a transaction-
 * scoped Postgres advisory lock first so two concurrent creates/onboardings
 * can't read the same max and collide. The lock is released at commit.
 */
export async function generateEmployeeId(
  tx: EmployeeIdClient,
  year = new Date().getFullYear(),
): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('employee-id-seq'))`;
  const prefix = `EMP-${year}-`;
  const rows = await tx.employee.findMany({
    where: { employeeId: { startsWith: prefix } },
    select: { employeeId: true },
  });
  return nextEmployeeIdFrom(
    rows.map((r) => r.employeeId),
    year,
  );
}
