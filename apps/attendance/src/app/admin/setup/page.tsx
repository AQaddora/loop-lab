import { getDb } from "@/db";
import { orgs } from "@/db/schema";
import { basePath } from "@/lib/base-path";
import { sessionInfo } from "@/lib/session";
import SetupForm from "./setup-form";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (getDb().select({ id: orgs.id }).from(orgs).limit(1).get()) {
    return (
      <main data-error="forbidden">
        <h1>Setup</h1>
        <p>This deployment is already set up.</p>
      </main>
    );
  }
  const s = await sessionInfo();
  const boot = (process.env.BOOTSTRAP_OWNER_EMAIL ?? "").toLowerCase();
  if (!s?.bootstrap || s.email.toLowerCase() !== boot) {
    return (
      <main data-error="unauthenticated">
        <h1>Setup</h1>
        <p>
          Sign in as the bootstrap owner first: <a href={`${basePath()}/signin?callbackUrl=/admin/setup`}>sign in</a>.
        </p>
      </main>
    );
  }
  return (
    <main>
      <h1>Set up your organisation</h1>
      <p className="muted">Signed in as {s.email}. This creates the org, you as its owner, and the first site.</p>
      <SetupForm base={basePath()} />
    </main>
  );
}
