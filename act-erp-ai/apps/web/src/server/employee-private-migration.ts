import { isDeepStrictEqual } from "node:util";
import {
  EMPLOYEE_PRIVATE_FIELDS, encryptEmployeePrivateDetails, hasLegacyEmployeePrivateData,
  readEmployeePrivateDetails, type EmployeePrivateFields, type EmployeePrivateRow,
} from "./employee-private-data";
import { isEncryptedSensitiveJson } from "./sensitive-data";

type Mode = "dry-run" | "apply" | "verify";
export type EmployeePrivateMigrationOutcome = "empty" | "legacy" | "verified" | "updated" | "conflict" | "failed";

const values = (row: Partial<EmployeePrivateFields>) => Object.fromEntries(
  EMPLOYEE_PRIVATE_FIELDS.map(field => [field, row[field] ?? null]),
) as EmployeePrivateFields;

/** The caller must CAS every original private field and the encrypted sidecar. */
export async function migrateEmployeePrivateRow(args: {
  row: EmployeePrivateRow;
  mode: Mode;
  compareAndSwap(write: Awaited<ReturnType<typeof encryptEmployeePrivateDetails>>): Promise<boolean>;
  readBack(): Promise<EmployeePrivateRow | null>;
}): Promise<EmployeePrivateMigrationOutcome> {
  const { row, mode } = args;
  const legacy = hasLegacyEmployeePrivateData(row);
  if (row.privateDetails != null && (!isEncryptedSensitiveJson(row.privateDetails) || legacy)) return "failed";
  if (mode === "dry-run") return row.privateDetails != null ? "verified" : legacy ? "legacy" : "empty";
  try {
    if (row.privateDetails != null) {
      await readEmployeePrivateDetails(row);
      return "verified";
    }
    if (!legacy) return "empty";
    if (mode === "verify") return "failed";
    // Validate/encrypt original legacy values even when strict application reads
    // are enabled. No plaintext fallback or destructive pre-clear is permitted.
    const original = values(row);
    const encrypted = await encryptEmployeePrivateDetails(row.id, original);
    const restored = await readEmployeePrivateDetails({ id: row.id, ...encrypted });
    if (!isDeepStrictEqual(values(restored), original)) return "failed";
    if (!await args.compareAndSwap(encrypted)) return "conflict";
    const persisted = await args.readBack();
    if (!persisted) return "failed";
    if (!isDeepStrictEqual(persisted.privateDetails, encrypted.privateDetails) || hasLegacyEmployeePrivateData(persisted)) return "conflict";
    const opened = await readEmployeePrivateDetails(persisted);
    return isDeepStrictEqual(values(opened), original) ? "updated" : "failed";
  } catch { return "failed"; }
}
