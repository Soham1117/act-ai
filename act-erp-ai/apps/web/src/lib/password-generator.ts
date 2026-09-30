/**
 * Strong random password for admin-set passwords. Uses Web Crypto (browser
 * and Node >= 19). Avoids look-alike characters (0/O, 1/l/I).
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const SYMBOLS = "!@#$%&*?";

function randomIndex(max: number): number {
  // Rejection sampling to avoid modulo bias.
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0]! < limit) return buf[0]! % max;
  }
}

export function generatePassword(length = 14): string {
  const chars: string[] = [];
  for (let i = 0; i < length - 2; i++) chars.push(ALPHABET[randomIndex(ALPHABET.length)]!);
  chars.push(String(2 + randomIndex(8)));
  chars.push(SYMBOLS[randomIndex(SYMBOLS.length)]!);
  // Fisher-Yates shuffle so the digit/symbol aren't always last.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}
