/**
 * GET /api/kiosk/token (spec §1.2): kiosk cookie (unpaired / revoked -> 401 kiosk_unauthorized) + site IP
 * (ip_not_allowed) -> {token, url, window, expiresAt, serverNow}. The kiosk never holds a key.
 */
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { getDb } from "@/db";
import { kiosks, sites } from "@/db/schema";
import { nowMs } from "@/lib/clock";
import { AppError } from "@/lib/errors";
import { json, route } from "@/lib/http";
import { clientIp, ipAllowed } from "@/lib/ip";
import { kioskForToken, readKioskToken } from "@/lib/kiosks";
import { mintRotating } from "@/lib/qr";
import { scanUrl } from "@/lib/static-qr";
import { siteCidrs } from "@/lib/tickets";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const db = getDb();
  const now = nowMs();
  const kiosk = kioskForToken(db, readKioskToken((await headers()).get("cookie")));
  if (!kiosk || kiosk.status !== "ACTIVE") throw new AppError("kiosk_unauthorized");
  const site = db.select().from(sites).where(eq(sites.id, kiosk.siteId)).get();
  if (!site || site.status !== "ACTIVE" || site.qrMode !== "rotating") throw new AppError("kiosk_unauthorized");
  const ip = clientIp(req.headers);
  if (!ip) throw new AppError("ip_unknown");
  if (!ipAllowed(ip, siteCidrs(db, site.id))) throw new AppError("ip_not_allowed");
  const minted = mintRotating(site, process.env.QR_SIGNING_SECRET ?? "", now);
  db.update(kiosks).set({ lastSeenAt: now }).where(eq(kiosks.id, kiosk.id)).run();
  return json({
    token: minted.token,
    url: scanUrl(site.id, minted.token),
    window: minted.window,
    expiresAt: minted.expiresAtMs,
    serverNow: now,
    rotationSeconds: site.rotationSeconds,
    site: { id: site.id, name: site.name },
  });
});
