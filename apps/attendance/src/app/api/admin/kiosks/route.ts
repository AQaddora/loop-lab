/** GET /api/admin/kiosks · POST {siteId, name}: a kiosk for a rotating site + a one-time pairing code (10 min). */
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { inTx } from "@/db";
import { kiosks, sites } from "@/db/schema";
import { adminRead, adminWrite } from "@/lib/admin";
import { withBase } from "@/lib/base-path";
import { json, route } from "@/lib/http";
import { createKiosk } from "@/lib/kiosks";
import { expectedOrigin } from "@/lib/origin";
import { getSite } from "@/lib/sites";

const Body = z.object({ siteId: z.string().min(1).max(64), name: z.string().trim().min(1).max(100) }).strict();

export const GET = route(async () => {
  const { db, actor } = await adminRead();
  const rows = db
    .select({ id: kiosks.id, name: kiosks.name, siteId: kiosks.siteId, status: kiosks.status, lastSeenAt: kiosks.lastSeenAt, createdAt: kiosks.createdAt })
    .from(kiosks)
    .innerJoin(sites, eq(sites.id, kiosks.siteId))
    .where(eq(sites.orgId, actor.orgId))
    .orderBy(asc(kiosks.createdAt))
    .all();
  return json({ kiosks: rows });
});

export const POST = route(async (req: Request) => {
  const { ctx, body } = await adminWrite(req, Body);
  const site = getSite(ctx.db, ctx.actor.orgId, body.siteId);
  const k = inTx(() => createKiosk(ctx.db, site, body.name, { orgId: ctx.actor.orgId, actorId: ctx.actor.id, ip: ctx.ip, now: ctx.now }));
  const pairUrl = `${expectedOrigin()}${withBase("/kiosk/pair")}?code=${k.code}`;
  return json({ kiosk: { id: k.id, siteId: site.id, name: body.name, status: "PAIRING" }, pairingCode: k.code, pairingExpiresAt: k.expiresAt, pairUrl }, 201);
});
