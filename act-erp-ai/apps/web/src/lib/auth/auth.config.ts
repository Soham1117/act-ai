import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe base config shared by the full Node instance (auth.ts) and the
 * Proxy instance (proxy.ts). MUST NOT import Node-only modules (bcrypt, Prisma)
 * — the Proxy runs on the edge runtime.
 *
 * Session security (fixes the old "tokens live for days" problem):
 *  - JWT strategy (required by the Credentials provider)
 *  - 8h absolute lifetime, refreshed on activity every 30m (rolling)
 *  - Instant revocation via the `tv` (tokenVersion) claim, checked against the
 *    DB in getSessionUser — bump User.tokenVersion to kill all of a user's
 *    sessions (logout-everywhere / role change / disable).
 */
export const authConfig = {
  trustHost: true,
  pages: { signIn: "/login" },
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 8, // 8 hours absolute
    updateAge: 60 * 30, // rolling refresh every 30 minutes
  },
  providers: [], // real providers added in auth.ts (Node)
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.role = user.role;
        token.tv = user.tokenVersion;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.uid as string;
        session.user.role = token.role as "ADMIN" | "EMPLOYEE";
        session.user.tv = token.tv as number;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
