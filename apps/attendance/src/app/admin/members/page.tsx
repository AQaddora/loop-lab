import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { members } from "@/db/schema";
import { basePath } from "@/lib/base-path";
import { publicMember } from "@/lib/members";
import { currentMember } from "@/lib/session";
import MembersClient from "./members-client";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  const me = await currentMember();
  if (!me) redirect("/signin?callbackUrl=/admin/members");
  if (me.status !== "ACTIVE" || (me.role !== "admin" && me.role !== "owner")) {
    return <main data-error="forbidden"><h1>Members</h1></main>;
  }
  const rows = getDb().select().from(members).where(eq(members.orgId, me.orgId)).orderBy(asc(members.createdAt), asc(members.email)).all();
  return (
    <main>
      <h1>Members</h1>
      <MembersClient base={basePath()} me={{ id: me.id, role: me.role }} initial={rows.map(publicMember)} />
    </main>
  );
}
