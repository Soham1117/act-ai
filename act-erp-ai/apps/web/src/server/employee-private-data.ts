import "server-only";
import { z } from "zod";
import { decryptSensitiveJson, encryptSensitiveJson, isEncryptedSensitiveJson, SensitiveDataError } from "./sensitive-data";

export const EMPLOYEE_PRIVATE_FIELDS = [
  "ssnLast4", "dateOfBirth", "personalEmail", "phoneNumber", "address",
  "city", "state", "zipCode", "emergencyName", "emergencyPhone",
] as const;
export type EmployeePrivateField = (typeof EMPLOYEE_PRIVATE_FIELDS)[number];
const nullableText = z.string().nullable();
const storedSchema = z.object({
  ssnLast4: z.string().regex(/^\d{4}$/).nullable(),
  dateOfBirth: z.string().datetime().nullable(),
  personalEmail: nullableText, phoneNumber: nullableText, address: nullableText,
  city: nullableText, state: nullableText, zipCode: nullableText,
  emergencyName: nullableText, emergencyPhone: nullableText,
}).strict();
type StoredPrivateDetails = z.infer<typeof storedSchema>;
export type EmployeePrivateFields = Omit<StoredPrivateDetails, "dateOfBirth"> & { dateOfBirth: Date | null };
export type EmployeePrivateRow = { id: string; privateDetails?: unknown } & Partial<EmployeePrivateFields>;

export const employeePrivateSelect = {
  id: true, privateDetails: true, ssnLast4: true, dateOfBirth: true,
  personalEmail: true, phoneNumber: true, address: true, city: true,
  state: true, zipCode: true, emergencyName: true, emergencyPhone: true,
} as const;

export const employeePrivateContext = (id: string) => ({
  purpose: "employee-private-details", recordId: id, field: "privateDetails",
});

export function hasLegacyEmployeePrivateData(row: Partial<EmployeePrivateFields>): boolean {
  return EMPLOYEE_PRIVATE_FIELDS.some(field => row[field] != null);
}

function serialize(value: Partial<EmployeePrivateFields>): StoredPrivateDetails {
  const result = Object.fromEntries(EMPLOYEE_PRIVATE_FIELDS.map(field => {
    const v = value[field] ?? null;
    return [field, field === "dateOfBirth" && v instanceof Date ? v.toISOString() : v];
  }));
  try { return storedSchema.parse(result); } catch { throw new SensitiveDataError(); }
}

/** Only hydrate after authorization, or inside a narrowly scoped login/matching service. */
export async function readEmployeePrivateDetails<T extends EmployeePrivateRow>(
  row: T,
): Promise<Omit<T, "privateDetails"> & EmployeePrivateFields> {
  let stored: StoredPrivateDetails;
  if (row.privateDetails != null) {
    // Mixed ciphertext/plaintext means an old writer is still active. Do not
    // silently overwrite or choose one copy of an employee's private data.
    if (!isEncryptedSensitiveJson(row.privateDetails) || hasLegacyEmployeePrivateData(row)) throw new SensitiveDataError();
    try {
      stored = storedSchema.parse(await decryptSensitiveJson(row.privateDetails, employeePrivateContext(row.id)));
    } catch { throw new SensitiveDataError(); }
  } else {
    if (process.env.SENSITIVE_DATA_REQUIRE_ENCRYPTED === "true" && hasLegacyEmployeePrivateData(row)) {
      throw new SensitiveDataError();
    }
    stored = serialize(row);
  }
  const { privateDetails: _encrypted, ...publicFields } = row;
  void _encrypted;
  return { ...publicFields, ...stored, dateOfBirth: stored.dateOfBirth ? new Date(stored.dateOfBirth) : null };
}

/** Clear every legacy field in the SAME database write as the encrypted copy. */
export async function encryptEmployeePrivateDetails(id: string, fields: Partial<EmployeePrivateFields>) {
  const privateDetails = await encryptSensitiveJson(serialize(fields), employeePrivateContext(id));
  return {
    privateDetails,
    ssnLast4: null, dateOfBirth: null, personalEmail: null, phoneNumber: null,
    address: null, city: null, state: null, zipCode: null,
    emergencyName: null, emergencyPhone: null,
  };
}

/** Merge only explicitly supplied fields; undefined means leave the answer alone. */
export async function prepareEmployeePrivateUpdate(
  row: EmployeePrivateRow,
  patch: Partial<EmployeePrivateFields>,
) {
  const current = await readEmployeePrivateDetails(row);
  const merged = Object.fromEntries(EMPLOYEE_PRIVATE_FIELDS.map(field => [
    field, patch[field] !== undefined ? patch[field] : current[field],
  ])) as EmployeePrivateFields;
  return encryptEmployeePrivateDetails(row.id, merged);
}

