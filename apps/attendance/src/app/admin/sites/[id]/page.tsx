import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { sites } from "@/db/schema";
import { basePath } from "@/lib/base-path";
import { currentMember } from "@/lib/session";
import { siteView } from "@/lib/sites";
import SiteClient from "./site-client";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function SitePage({ params }: Props) {
  const { id } = await params;
  const me = await currentMember();
  if (!me) redirect(`/signin?callbackUrl=/admin/sites/${encodeURIComponent(id)}`);
  if (me.status !== "ACTIVE" || (me.role !== "admin" && me.role !== "owner")) return <main data-error="forbidden"><h1>Site</h1></main>;
  const db = getDb();
  const site = db.select().from(sites).where(and(eq(sites.id, id), eq(sites.orgId, me.orgId))).get();
  if (!site) return <main data-error="bad_request"><h1>Site not found</h1></main>;
  return (
    <main>
      <h1>Site: {site.name}</h1>
      <SiteClient base={basePath()} initial={siteView(db, site)} />
    </main>
  );
}
