/** POST /api/admin/kiosks/[id]/revoke: the kiosk's next token request gets 401 kiosk_unauthorized. */
import { z } from "zod";
import { inTx } from "@/db";
import { adminWrite } from "@/lib/admin";
import { json, route } from "@/lib/http";
import { revokeKiosk } from "@/lib/kiosks";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const { ctx: c } = await adminWrite(req, z.object({}).strict());
  const k = inTx(() => revokeKiosk(c.db, c.actor.orgId, id, { orgId: c.actor.orgId, actorId: c.actor.id, ip: c.ip, now: c.now }));
  return json({ kiosk: { id: k.id, status: k.status } });
});
