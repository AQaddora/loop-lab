/** POST /api/admin/sites/[id]/networks {cidr, label?}: through parseCidr() (cidr_invalid / cidr_too_broad / cidr_not_public). */
import { inTx } from "@/db";
import { adminWrite } from "@/lib/admin";
import { json, route } from "@/lib/http";
import { addNetworkChecked, getSite, NetworkInput, siteView } from "@/lib/sites";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const { ctx: c, body } = await adminWrite(req, NetworkInput);
  const { db, actor, now, ip } = c;
  const site = getSite(db, actor.orgId, id);
  const networkId = inTx(() => addNetworkChecked(db, site, body, { orgId: actor.orgId, actorId: actor.id, ip, now }));
  return json({ networkId, site: siteView(db, site) }, 201);
});
