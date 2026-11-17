/**
 * POST /api/kiosk/pair {code} (spec §1.2): Origin + JSON -> 10/min per IP -> code (unknown, used or expired ->
 * kiosk_unauthorized) -> IP inside the kiosk's site CIDRs (ip_not_allowed) -> consume atomically -> kiosk cookie.
 */
import { z } from "zod";
import { getDb } from "@/db";
import { parseBody } from "@/lib/admin";
import { audit } from "@/lib/audit";
import { nowMs } from "@/lib/clock";
import { AppError } from "@/lib/errors";
import { json, readJson, route } from "@/lib/http";
import { clientIp, ipAllowed } from "@/lib/ip";
import { consumePairing, kioskCookie, kioskForCode } from "@/lib/kiosks";
import { assertWriteRequest } from "@/lib/origin";
import { hit, RATE_LIMITS } from "@/lib/ratelimit";
import { siteCidrs } from "@/lib/tickets";
import { sites } from "@/db/schema";
import { eq } from "drizzle-orm";

const Body = z.object({ code: z.string().trim().toUpperCase().max(16) }).strict();

export const POST = route(async (req: Request) => {
  assertWriteRequest(req);
  const db = getDb();
  const now = nowMs();
  const ip = clientIp(req.headers);
  if (!hit(db, `kioskpair:${ip ?? "unknown"}`, RATE_LIMITS.kioskPair.limit, RATE_LIMITS.kioskPair.windowMs, now).ok) throw new AppError("rate_limited");
  const { code } = parseBody(Body, await readJson(req));
  const kiosk = kioskForCode(db, code, now);
  if (!kiosk) throw new AppError("kiosk_unauthorized");
  if (!ip) throw new AppError("ip_unknown");
  if (!ipAllowed(ip, siteCidrs(db, kiosk.siteId))) throw new AppError("ip_not_allowed");
  const token = consumePairing(db, kiosk, code, now);
  if (!token) throw new AppError("kiosk_unauthorized");
  const site = db.select().from(sites).where(eq(sites.id, kiosk.siteId)).get();
  audit(db, { orgId: site?.orgId ?? "", actorMemberId: null, action: "kiosk.pair", targetType: "kiosk", targetId: kiosk.id, detail: { siteId: kiosk.siteId }, ip, at: now });
  return json({ ok: true, kiosk: { id: kiosk.id, siteId: kiosk.siteId, name: kiosk.name } }, 200, { "set-cookie": kioskCookie(token) });
});
