import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { authConfig } from "./auth.config";
import { verifyPassword } from "./password";

const challengeCredsSchema = z.object({
  challengeId: z.string().min(1),
  code: z.string().regex(/^\d{6}$/),
});

const passwordCredsSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});

/**
 * Full NextAuth instance (Node runtime). Adds the Credentials provider on top
 * of the edge-safe base config.
 *
 * With LOGIN_2FA_ENABLED=true, password verification happens in
 * requestLoginChallenge and this provider completes the sign-in from the
 * emailed code. With the switch off, this provider verifies the username or
 * email and password directly. The code path remains intact for re-enabling.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { identifier: {}, password: {}, challengeId: {}, code: {} },
      authorize: async (raw) => {
        if (env.LOGIN_2FA_ENABLED === "false") {
          const parsed = passwordCredsSchema.safeParse(raw);
          if (!parsed.success) return null;
          const identifier = parsed.data.identifier.trim().toLowerCase();
          const user = await db.user.findFirst({
            where: { OR: [{ email: identifier }, { username: identifier }] },
            select: {
              id: true,
              email: true,
              role: true,
              tokenVersion: true,
              passwordHash: true,
            },
          });
          if (!user?.passwordHash) return null;
          if (!(await verifyPassword(parsed.data.password, user.passwordHash)))
            return null;
          return {
            id: user.id,
            email: user.email,
            role: user.role,
            tokenVersion: user.tokenVersion,
          };
        }

        const parsed = challengeCredsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { challengeId, code } = parsed.data;

        const challenge = await db.loginChallenge.findUnique({
          where: { id: challengeId },
          include: {
            user: {
              select: { id: true, email: true, role: true, tokenVersion: true },
            },
          },
        });
        if (!challenge || challenge.consumedAt || challenge.expiresAt < new Date()) {
          return null;
        }
        if (challenge.attempts >= 5) return null;

        const ok = await verifyPassword(code, challenge.codeHash);
        if (!ok) {
          await db.loginChallenge.update({
            where: { id: challengeId },
            data: { attempts: { increment: 1 } },
          });
          return null;
        }

        await db.loginChallenge.update({
          where: { id: challengeId },
          data: { consumedAt: new Date() },
        });

        return {
          id: challenge.user.id,
          email: challenge.user.email,
          role: challenge.user.role,
          tokenVersion: challenge.user.tokenVersion,
        };
      },
    }),
  ],
});
