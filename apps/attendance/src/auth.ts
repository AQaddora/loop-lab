/**
 * Auth.js config (spec §2.3): Google + (test mode only) `test-login`, JWT sessions of 12 h,
 * one signIn policy for both providers. `test-login` replaces ONLY Google's identity proof.
 */
import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { getDb } from "@/db";
import { withBase } from "@/lib/base-path";
import { nowMs } from "@/lib/clock";
import { claimsFromGoogle, claimsFromTestLogin, type Claims } from "@/lib/identity";
import { evaluateSignIn } from "@/lib/signin-policy";
import { isTestMode } from "@/lib/test-mode";

export const SESSION_MAX_AGE_S = 12 * 60 * 60;
export const TEST_LOGIN_ID = "test-login";

type ClaimsCarrier = { claims?: Claims };

function testLoginProvider() {
  return Credentials({
    id: TEST_LOGIN_ID,
    name: "Test login",
    credentials: { email: {}, sub: {}, emailVerified: {} },
    async authorize(raw) {
      if (!isTestMode()) return null;
      const claims = claimsFromTestLogin(raw ?? {});
      if (!claims) return null;
      return { id: claims.sub, email: claims.email, claims } as { id: string; email: string } & ClaimsCarrier;
    },
  });
}

const providers: NextAuthConfig["providers"] = [Google({ allowDangerousEmailAccountLinking: false })];
if (isTestMode()) providers.push(testLoginProvider());

function claimsFrom(params: {
  user: unknown;
  account: { provider?: string } | null | undefined;
  profile?: Record<string, unknown> | undefined;
}): Claims | null {
  const provider = params.account?.provider;
  if (provider === "google") return claimsFromGoogle(params.profile);
  if (provider === TEST_LOGIN_ID && isTestMode()) return (params.user as ClaimsCarrier | undefined)?.claims ?? null;
  return null;
}

const signInError = (code: string) => withBase(`/signin?error=${encodeURIComponent(code)}`);

export const authConfig: NextAuthConfig = {
  basePath: withBase("/api/auth"),
  trustHost: true,
  providers,
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_S },
  jwt: { maxAge: SESSION_MAX_AGE_S },
  pages: { signIn: withBase("/signin"), error: withBase("/signin") },
  callbacks: {
    async signIn({ user, account, profile }) {
      const claims = claimsFrom({ user, account, profile: profile as Record<string, unknown> | undefined });
      if (!claims) return signInError("bad_request");
      const r = evaluateSignIn(getDb(), claims, nowMs(), process.env.BOOTSTRAP_OWNER_EMAIL);
      if (!r.ok) return signInError(r.error);
      // carry the policy result into the jwt callback
      (user as Record<string, unknown>).policy = r;
      return true;
    },
    async jwt({ token, user, trigger }) {
      if (trigger === "signIn" && user) {
        const r = (user as Record<string, unknown>).policy as
          | { memberId: string | null; email: string; sub: string; bootstrap: boolean }
          | undefined;
        if (!r) return null;
        return { sub: r.sub, email: r.email, memberId: r.memberId, bootstrap: r.bootstrap };
      }
      return token;
    },
    async session({ session, token }) {
      session.user = {
        ...session.user,
        email: typeof token.email === "string" ? token.email : "",
        sub: typeof token.sub === "string" ? token.sub : null,
        memberId: typeof token.memberId === "string" ? token.memberId : null,
        bootstrap: token.bootstrap === true,
      };
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
