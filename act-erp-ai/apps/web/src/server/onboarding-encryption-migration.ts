import { isDeepStrictEqual } from "node:util";
import type { SensitiveDataContext } from "./sensitive-data";

export type MigrationMode = "dry-run" | "apply" | "verify";
export type FieldState = "plaintext" | "encrypted" | "invalid";
export type MigrationField = { name: string; value: unknown; context: SensitiveDataContext };
export type MigrationCrypto = {
  encrypt(value: unknown, context: SensitiveDataContext): Promise<unknown>;
  decrypt(value: unknown, context: SensitiveDataContext): Promise<unknown>;
  isEncrypted(value: unknown): boolean;
};
export type MigrationResult = {
  fields: Record<string, FieldState>;
  outcome: "dry-run" | "unchanged" | "updated" | "conflict" | "failed";
};

/** Format inspection only. Authentication happens during apply/verify. */
export function classifySensitiveValue(value: unknown, crypto: MigrationCrypto): FieldState {
  if (!value || typeof value !== "object") return "invalid";
  // Hire-packet file metadata is a legacy JSON array, rather than an object.
  if (Array.isArray(value)) return "plaintext";
  const row = value as Record<string, unknown>;
  if (!("$encrypted" in row)) return "plaintext";
  if (!crypto.isEncrypted(value) || typeof row.ciphertext !== "string" ||
      !row.ciphertext.length || row.ciphertext.length > 512 * 1024 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(row.ciphertext)) {
    return "invalid";
  }
  return "encrypted";
}

/**
 * Migrate one row atomically. Callers provide a compare-and-swap operation that
 * includes every original field; concurrent edits must not be overwritten.
 * No error or return value contains record values, IDs, or SDK exception text.
 */
export async function migrateSensitiveRow(args: {
  mode: MigrationMode;
  fields: MigrationField[];
  crypto: MigrationCrypto;
  compareAndSwap(expected: Record<string, unknown>, replacement: Record<string, unknown>): Promise<boolean>;
  readBack(): Promise<Record<string, unknown> | null>;
}): Promise<MigrationResult> {
  const states = Object.fromEntries(args.fields.map(field => [
    field.name, classifySensitiveValue(field.value, args.crypto),
  ]));
  const result = (outcome: MigrationResult["outcome"]): MigrationResult => ({ fields: states, outcome });
  if (args.mode === "dry-run") return result("dry-run");
  if (Object.values(states).includes("invalid")) return result("failed");
  if (args.mode === "verify" && Object.values(states).includes("plaintext")) return result("failed");

  try {
    const expected = Object.fromEntries(args.fields.map(field => [field.name, field.value]));
    const replacements: Record<string, unknown> = {};
    const originalPlaintext: Record<string, unknown> = {};
    for (const field of args.fields) {
      if (states[field.name] === "encrypted") {
        // Never rewrite an encrypted field merely to rotate its data key.
        originalPlaintext[field.name] = await args.crypto.decrypt(field.value, field.context);
      } else {
        originalPlaintext[field.name] = field.value;
        const encrypted = await args.crypto.encrypt(field.value, field.context);
        if (classifySensitiveValue(encrypted, args.crypto) !== "encrypted") return result("failed");
        const opened = await args.crypto.decrypt(encrypted, field.context);
        if (!isDeepStrictEqual(opened, field.value)) return result("failed");
        replacements[field.name] = encrypted;
      }
    }
    if (args.mode === "verify" || Object.keys(replacements).length === 0) return result("unchanged");
    if (!await args.compareAndSwap(expected, replacements)) return result("conflict");
    const persisted = await args.readBack();
    if (!persisted) return result("failed");
    const intended = { ...expected, ...replacements };
    for (const field of args.fields) {
      // A draft may be edited again after CAS; report the race and let a retry
      // inspect that version rather than clobbering the new answers.
      if (!isDeepStrictEqual(persisted[field.name], intended[field.name])) return result("conflict");
      const opened = await args.crypto.decrypt(persisted[field.name], field.context);
      if (!isDeepStrictEqual(opened, originalPlaintext[field.name])) return result("failed");
    }
    return result("updated");
  } catch {
    return result("failed");
  }
}
