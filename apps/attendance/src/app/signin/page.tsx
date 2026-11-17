import { redirect } from "next/navigation";
import { signIn, TEST_LOGIN_ID } from "@/auth";
import { withBase } from "@/lib/base-path";
import { ERROR_STATUS } from "@/lib/errors";
import { isTestMode } from "@/lib/test-mode";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ error?: string | string[]; callbackUrl?: string | string[] }> };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Only same-app relative paths may be a post-login destination. */
function safeNext(v: string | undefined): string {
  if (!v || !v.startsWith("/") || v.startsWith("//") || v.includes("\\")) return "/";
  return v;
}

export default async function SignInPage({ searchParams }: Props) {
  const sp = await searchParams;
  const raw = first(sp.error);
  // our policy codes pass through; Auth.js's own codes (e.g. "Configuration") are folded into auth_error
  const error = raw ? (raw in ERROR_STATUS ? raw : "auth_error") : undefined;
  const next = safeNext(first(sp.callbackUrl));

  async function google() {
    "use server";
    await signIn("google", { redirectTo: next });
  }

  async function testLogin(fd: FormData) {
    "use server";
    if (!isTestMode()) redirect(withBase("/signin"));
    await signIn(TEST_LOGIN_ID, {
      email: String(fd.get("email") ?? ""),
      sub: String(fd.get("sub") ?? ""),
      emailVerified: fd.get("unverified") ? "false" : "true",
      redirectTo: next,
    });
  }

  return (
    <main data-error={error}>
      <h1>Sign in</h1>
      {error ? (
        <p className="error" role="alert">
          Sign-in refused: <code>{error}</code>
        </p>
      ) : null}
      <form action={google}>
        <button type="submit">Sign in with Google</button>
      </form>
      {isTestMode() ? (
        <form action={testLogin} data-testid="test-login" style={{ marginTop: "2rem" }}>
          <p className="muted">Test mode only</p>
          <input name="email" type="email" placeholder="email" aria-label="email" required />
          <input name="sub" placeholder="sub (optional)" aria-label="sub" />
          <label>
            <input name="unverified" type="checkbox" /> unverified
          </label>
          <button type="submit">Test login</button>
        </form>
      ) : null}
    </main>
  );
}
