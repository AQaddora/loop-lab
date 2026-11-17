/** POST /api/admin/sites/[id]/static-qr {ttlSeconds, label?}: TTL 1 h – 30 d (else ttl_too_long). Static sites only. */
import { inTx } from "@/db";
import { adminWrite } from "@/lib/admin";
import { json, route } from "@/lib/http";
import { getSite } from "@/lib/sites";
import { mintStaticQr, StaticQrInput } from "@/lib/static-qr";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const { ctx: c, body } = await adminWrite(req, StaticQrInput);
  const site = getSite(c.db, c.actor.orgId, id);
  const qr = inTx(() => mintStaticQr(c.db, site, body, { orgId: c.actor.orgId, actorId: c.actor.id, ip: c.ip, now: c.now }));
  return json({ qr }, 201);
});
