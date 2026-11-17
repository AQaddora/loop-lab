import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { orgs, sites } from "@/db/schema";
import { withBase } from "@/lib/base-path";
import { currentMember } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const db = getDb();
  if (!db.select({ id: orgs.id }).from(orgs).limit(1).get()) redirect(withBase("/admin/setup"));
  const me = await currentMember();
  if (!me) redirect(withBase("/signin?callbackUrl=/admin"));
  if (me.status !== "ACTIVE" || (me.role !== "admin" && me.role !== "owner")) {
    return (
      <main data-error="forbidden">
        <h1>Admin</h1>
        <p className="error">This area is for admins.</p>
      </main>
    );
  }
  const org = db.select().from(orgs).where(eq(orgs.id, me.orgId)).get();
  const siteRows = db.select().from(sites).where(eq(sites.orgId, me.orgId)).all();
  return (
    <main>
      <h1>{org?.name ?? "Admin"}</h1>
      <p className="muted">
        Signed in as {me.email} ({me.role})
      </p>
      <ul>
        <li>
          <Link href="/admin/members">Members (allowlist)</Link>
        </li>
        {siteRows.map((s) => (
          <li key={s.id}>
            <Link href={`/admin/sites/${s.id}`}>Site: {s.name}</Link> <span className="muted">({s.qrMode}, {s.status})</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
