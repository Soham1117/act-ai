/** Temporary PIN given to every new employee; must be changed on first kiosk use. */
export const DEFAULT_KIOSK_PIN = "3214";

/** True when the stored bcrypt hash is (still) the default PIN. */
export async function isDefaultPin(hash: string | null | undefined): Promise<boolean> {
  if (!hash) return false;
  try {
    // Lazy import keeps bcrypt out of client bundles that only need validateNewPin.
    const { verifyPassword } = await import("./auth/password");
    return await verifyPassword(DEFAULT_KIOSK_PIN, hash);
  } catch {
    return false;
  }
}

/**
 * Validate a PIN an employee chooses. Returns a user-facing message, or null
 * when acceptable. Rejects the default, repeated digits, simple runs
 * (1234 / 4321) and repeated patterns (1212, 123123).
 */
export function validateNewPin(pin: string): string | null {
  if (!/^\d{4,6}$/.test(pin)) return "PIN must be 4 to 6 digits.";
  if (pin === DEFAULT_KIOSK_PIN) {
    return "Choose a PIN different from the temporary one.";
  }
  if (/^(\d)\1+$/.test(pin)) return "That PIN is too easy to guess (repeated digit).";
  const digits = pin.split("").map(Number);
  const steps = digits.slice(1).map((d, i) => d - digits[i]!);
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) {
    return "That PIN is too easy to guess (simple sequence).";
  }
  if (pin.length % 2 === 0 && pin.slice(0, 2).repeat(pin.length / 2) === pin) {
    return "That PIN is too easy to guess (repeating pattern).";
  }
  if (pin.length === 6 && pin.slice(0, 3) === pin.slice(3)) {
    return "That PIN is too easy to guess (repeating pattern).";
  }
  return null;
}
