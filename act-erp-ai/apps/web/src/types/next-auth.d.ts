import type { DefaultSession } from "next-auth";

type AppRole = "ADMIN" | "EMPLOYEE";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: AppRole;
      tv: number;
    } & DefaultSession["user"];
  }

  // Returned by the Credentials authorize() and fed to the jwt callback.
  interface User {
    role?: AppRole;
    tokenVersion?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    role?: AppRole;
    tv?: number;
  }
}
