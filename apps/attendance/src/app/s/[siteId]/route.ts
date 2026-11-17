/**
 * Scan entry GET /s/[siteId]?t=<token> (spec §1.3.2, §2.1, §2.2):
 *   rate limit (per IP) -> IP (ip_unknown / ip_not_allowed for the site's CIDRs; an unknown site has none: qr_invalid)
 *   -> token, §2.1 verify block (DISABLED site qr_revoked, …) -> scan_tickets row + HttpOnly cookie -> 303 /punch.
 * Errors render <main data-error="<code>">. The token never stays in the address bar.
 */
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { getDb } from "@/db";
import { sites, staticQrCodes } from "@/db/schema";
import { withBase } from "@/lib/base-path";
import { nowMs } from "@/lib/clock";
import { errorPage } from "@/lib/http";
import { clientIp, ipAllowed } from "@/lib/ip";
import { expectedOrigin } from "@/lib/origin";
import { verifyScan } from "@/lib/qr";
import { hitIp } from "@/lib/ratelimit";
import { createTicket, insideAnySite, siteCidrs, ticketCookie } from "@/lib/tickets";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ siteId: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const db = getDb();
  const now = nowMs();
  const ip = clientIp(req.headers);
  if (!hitIp(db, ip, insideAnySite(db, ip), now).ok) return errorPage("rate_limited");
  if (!ip) return errorPage("ip_unknown", "Could not determine your network address.");

  const { siteId } = await ctx.params;
  const site = db.select().from(sites).where(eq(sites.id, siteId)).get();
  if (!site) return errorPage("qr_invalid");
  if (!ipAllowed(ip, siteCidrs(db, site.id))) {
    return errorPage("ip_not_allowed", `Connect to the office Wi-Fi. Detected IP: ${ip}`);
  }

  const v = verifyScan({
    pathSiteId: siteId,
    token: req.nextUrl.searchParams.get("t"),
    site,
    findStatic: (id) => db.select().from(staticQrCodes).where(eq(staticQrCodes.id, id)).get(),
    secret: process.env.QR_SIGNING_SECRET ?? "",
    nowMs: now,
  });
  if (!v.ok) return errorPage(v.error);

  const ticket = createTicket(db, {
    siteId: site.id,
    source: v.kind,
    qrWindow: v.kind === "rotating" ? v.window : null,
    staticQrId: v.kind === "static" ? v.staticQrId : null,
    ip,
    ua: req.headers.get("user-agent"),
    nowMs: now,
  });
  return new Response(null, {
    status: 303,
    headers: {
      location: new URL(withBase("/punch"), expectedOrigin()).toString(),
      "set-cookie": ticketCookie(ticket.id),
      "cache-control": "no-store",
    },
  });
}
