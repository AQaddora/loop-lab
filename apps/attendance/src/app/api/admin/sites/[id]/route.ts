/** GET / PATCH /api/admin/sites/[id]: name, timezone, qr_mode, rotation 10–120, grace 0–2, status, key-version bump. */
import { inTx } from "@/db";
import { adminRead, adminWrite } from "@/lib/admin";
import { json, route } from "@/lib/http";
import { getSite, SitePatch, siteView, updateSite } from "@/lib/sites";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const { db, actor } = await adminRead();
  return json({ site: siteView(db, getSite(db, actor.orgId, id)) });
});

export const PATCH = route(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const { ctx: c, body } = await adminWrite(req, SitePatch);
  const { db, actor, now, ip } = c;
  const site = getSite(db, actor.orgId, id);
  const updated = inTx(() => updateSite(db, site, body, { orgId: actor.orgId, actorId: actor.id, ip, now }));
  return json({ site: siteView(db, updated) });
});
