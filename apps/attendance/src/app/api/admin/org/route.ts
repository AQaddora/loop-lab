/** PATCH /api/admin/org (owner): name, Google Workspace domain (hd), synced-passkey policy. */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { inTx } from "@/db";
import { orgs } from "@/db/schema";
import { adminRead, adminWrite } from "@/lib/admin";
import { audit } from "@/lib/audit";
import { json, route } from "@/lib/http";

const OrgPatch = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    allowedGoogleHd: z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/).nullable().optional(),
    allowSyncedPasskeys: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0);

export const GET = route(async () => {
  const { db, actor } = await adminRead();
  return json({ org: db.select().from(orgs).where(eq(orgs.id, actor.orgId)).get() });
});

export const PATCH = route(async (req: Request) => {
  const { ctx, body } = await adminWrite(req, OrgPatch, { owner: true });
  const { db, actor, now, ip } = ctx;
  const before = db.select().from(orgs).where(eq(orgs.id, actor.orgId)).get();
  inTx(() => {
    db.update(orgs).set(body).where(eq(orgs.id, actor.orgId)).run();
    audit(db, { orgId: actor.orgId, actorMemberId: actor.id, action: "org.update", targetType: "org", targetId: actor.orgId, detail: { before, change: body }, ip, at: now });
  });
  return json({ org: db.select().from(orgs).where(eq(orgs.id, actor.orgId)).get() });
});
