import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      email: string;
      sub: string | null;
      memberId: string | null;
      bootstrap: boolean;
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    memberId?: string | null;
    bootstrap?: boolean;
    email?: string | null;
  }
}
