import bcrypt from "bcryptjs";

// Node-only. bcryptjs (pure JS) avoids native build steps in the Docker image.
const ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
