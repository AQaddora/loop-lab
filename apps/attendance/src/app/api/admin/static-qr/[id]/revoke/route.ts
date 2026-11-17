/** POST /api/admin/static-qr/[id]/revoke: ACTIVE -> REVOKED (else invalid_state); scans then get qr_revoked. */
import { z } from "zod";
import { inTx } from "@/db";
import { adminWrite } from "@/lib/admin";
import { json, route } from "@/lib/http";
import { revokeStaticQr } from "@/lib/static-qr";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const { ctx: c } = await adminWrite(req, z.object({}).strict());
  const qr = inTx(() => revokeStaticQr(c.db, c.actor.orgId, id, { orgId: c.actor.orgId, actorId: c.actor.id, ip: c.ip, now: c.now }));
  return json({ qr: { id: qr.id, status: qr.status } });
});
