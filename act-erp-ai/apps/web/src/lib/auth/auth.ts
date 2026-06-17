import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { db } from "@/lib/db";
import { authConfig } from "./auth.config";
import { verifyPassword } from "./password";

const credsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Full NextAuth instance (Node runtime). Adds the Credentials provider on top
 * of the edge-safe base config. `authorize` verifies email + bcrypt password
 * against the User table and returns the fields the jwt callback needs.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (raw) => {
        const parsed = credsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const user = await db.user.findUnique({
          where: { email: email.toLowerCase() },
          select: { id: true, email: true, role: true, passwordHash: true, tokenVersion: true },
        });
        if (!user?.passwordHash) return null;

        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) return null;

        return {
          id: user.id,
          email: user.email,
          role: user.role,
          tokenVersion: user.tokenVersion,
        };
      },
    }),
  ],
});
