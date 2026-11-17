import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { sites } from "@/db/schema";
import { basePath, withBase } from "@/lib/base-path";
import { currentMember } from "@/lib/session";
import KiosksClient from "./kiosks-client";

export const dynamic = "force-dynamic";

export default async function KiosksPage() {
  const me = await currentMember();
  if (!me) redirect(withBase("/signin?callbackUrl=/admin/kiosks"));
  if (me.status !== "ACTIVE" || (me.role !== "admin" && me.role !== "owner")) return <main data-error="forbidden"><h1>Kiosks</h1></main>;
  const rotating = getDb().select({ id: sites.id, name: sites.name }).from(sites).where(and(eq(sites.orgId, me.orgId), eq(sites.qrMode, "rotating"))).all();
  return (
    <main>
      <h1>Kiosks</h1>
      <KiosksClient base={basePath()} sites={rotating} />
    </main>
  );
}
