/** GET /api/admin/sites · POST: create a site (+ networks). Spec §1.1.2. */
import { asc, eq } from "drizzle-orm";
import { inTx } from "@/db";
import { sites } from "@/db/schema";
import { adminRead, adminWrite } from "@/lib/admin";
import { json, route } from "@/lib/http";
import { createSite, getSite, SiteInput, siteView } from "@/lib/sites";

export const GET = route(async () => {
  const { db, actor } = await adminRead();
  const rows = db.select().from(sites).where(eq(sites.orgId, actor.orgId)).orderBy(asc(sites.createdAt)).all();
  return json({ sites: rows.map((s) => siteView(db, s)) });
});

export const POST = route(async (req: Request) => {
  const { ctx, body } = await adminWrite(req, SiteInput);
  const { db, actor, now, ip } = ctx;
  const id = inTx(() => createSite(db, body, { orgId: actor.orgId, actorId: actor.id, ip, now }));
  return json({ site: siteView(db, getSite(db, actor.orgId, id)) }, 201);
});
