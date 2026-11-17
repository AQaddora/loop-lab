import { redirect } from "next/navigation";
import { basePath, withBase } from "@/lib/base-path";
import { currentMember } from "@/lib/session";
import CredentialsClient from "./credentials-client";

export const dynamic = "force-dynamic";

export default async function CredentialsPage() {
  const me = await currentMember();
  if (!me) redirect(withBase("/signin?callbackUrl=/admin/credentials"));
  if (me.status !== "ACTIVE" || (me.role !== "admin" && me.role !== "owner")) return <main data-error="forbidden"><h1>Passkeys</h1></main>;
  return (
    <main>
      <h1>Passkey approvals</h1>
      <p className="muted">Approve only when the employee is in front of you, and type the 6-character code shown on their phone.</p>
      <CredentialsClient base={basePath()} meId={me.id} />
    </main>
  );
}
