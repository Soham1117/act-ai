import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { db } from "@/lib/db";
import { authConfig } from "./auth.config";
import { verifyPassword } from "./password";

const credsSchema = z.object({
  challengeId: z.string().min(1),
  code: z.string().regex(/^\d{6}$/),
});

/**
 * Full NextAuth instance (Node runtime). Adds the Credentials provider on top
 * of the edge-safe base config.
 *
 * `authorize` does NOT take a password — password verification happens one
 * step earlier, in `requestLoginChallenge` (src/server/actions/login-challenge.ts),
 * which creates a `LoginChallenge` row and emails a 6-digit code (2FA). This
 * provider's only job is to check that code and, if it matches, complete the
 * sign-in. See LoginChallenge in schema.prisma for why the code itself is
 * never stored, only its hash.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { challengeId: {}, code: {} },
      authorize: async (raw) => {
        const parsed = credsSchema.safeParse(raw);
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
