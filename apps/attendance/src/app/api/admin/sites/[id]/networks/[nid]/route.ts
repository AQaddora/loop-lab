/** DELETE /api/admin/sites/[id]/networks/[nid] (Origin + JSON content type, no body). */
import { z } from "zod";
import { inTx } from "@/db";
import { adminWrite } from "@/lib/admin";
import { json, route } from "@/lib/http";
import { getSite, removeNetwork, siteView } from "@/lib/sites";

type Ctx = { params: Promise<{ id: string; nid: string }> };

export const DELETE = route(async (req: Request, ctx: Ctx) => {
  const { id, nid } = await ctx.params;
  const { ctx: c } = await adminWrite(req, z.object({}), { noBody: true });
  const { db, actor, now, ip } = c;
  const site = getSite(db, actor.orgId, id);
  inTx(() => removeNetwork(db, site, nid, { orgId: actor.orgId, actorId: actor.id, ip, now }));
  return json({ ok: true, site: siteView(db, site) });
});
