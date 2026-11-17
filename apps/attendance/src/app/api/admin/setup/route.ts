/**
 * POST /api/admin/setup (spec §1.1.1): only while no org exists, only for the bootstrap session
 * (BOOTSTRAP_OWNER_EMAIL, admitted by sign-in policy step 0). One transaction: org + owner (ACTIVE,
 * google_sub pinned) + first site (+ networks). Once an org exists: forbidden.
 */
import { z } from "zod";
import { getDb, inTx } from "@/db";
import { members, orgs } from "@/db/schema";
import { parseBody } from "@/lib/admin";
import { audit } from "@/lib/audit";
import { nowMs } from "@/lib/clock";
import { AppError } from "@/lib/errors";
import { json, readJson, route } from "@/lib/http";
import { randomB64url, randomId } from "@/lib/ids";
import { clientIp } from "@/lib/ip";
import { assertWriteRequest } from "@/lib/origin";
import { sessionInfo } from "@/lib/session";
import { createSite, SiteInput } from "@/lib/sites";

const SetupBody = z
  .object({
    org: z
      .object({
        name: z.string().trim().min(1).max(100),
        allowedGoogleHd: z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/).nullable().optional(),
        allowSyncedPasskeys: z.boolean().optional(),
      })
      .strict(),
    site: SiteInput,
  })
  .strict();

export const POST = route(async (req: Request) => {
  assertWriteRequest(req);
  const s = await sessionInfo();
  if (!s?.sub) throw new AppError("unauthenticated");
  const db = getDb();
  if (db.select({ id: orgs.id }).from(orgs).limit(1).get()) throw new AppError("forbidden");
  const boot = (process.env.BOOTSTRAP_OWNER_EMAIL ?? "").trim().toLowerCase();
  if (!s.bootstrap || boot === "" || s.email.toLowerCase() !== boot) throw new AppError("forbidden");
  const body = parseBody(SetupBody, await readJson(req));
  const now = nowMs();
  const ip = clientIp(req.headers);

  const result = inTx(() => {
    if (db.select({ id: orgs.id }).from(orgs).limit(1).get()) throw new AppError("forbidden"); // raced
    const orgId = randomId("org_");
    const ownerId = randomId("m_");
    db.insert(orgs)
      .values({
        id: orgId,
        name: body.org.name,
        allowedGoogleHd: body.org.allowedGoogleHd ?? null,
        allowSyncedPasskeys: body.org.allowSyncedPasskeys ?? true,
        createdAt: now,
      })
      .run();
    db.insert(members)
      .values({
        id: ownerId,
        orgId,
        email: boot,
        role: "owner",
        status: "ACTIVE",
        googleSub: s.sub,
        webauthnUserId: randomB64url(32),
        createdAt: now,
        lastLoginAt: now,
      })
      .run();
    audit(db, { orgId, actorMemberId: ownerId, action: "org.setup", targetType: "org", targetId: orgId, detail: { org: body.org, owner: boot }, ip, at: now });
    const siteId = createSite(db, body.site, { orgId, actorId: ownerId, ip, now });
    return { orgId, ownerId, siteId };
  });
  return json({ ok: true, ...result }, 201);
});
