import type { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { getDb } from "@/db";
import { withBase } from "@/lib/base-path";
import { nowMs } from "@/lib/clock";
import { clientIp } from "@/lib/ip";
import { hitIp } from "@/lib/ratelimit";
import { insideAnySite } from "@/lib/tickets";

// sign-in steps share the per-IP bucket of /s/* and /api/client-ip (spec §2.7: 30/min outside, 600/min inside)
function isSignInStep(req: NextRequest): boolean {
  const p = req.nextUrl.pathname;
  return /\/api\/auth\/callback\//.test(p) || (req.method === "POST" && /\/api\/auth\/signin\//.test(p));
}

function limited(req: NextRequest): Response | null {
  if (!isSignInStep(req)) return null;
  const db = getDb();
  const ip = clientIp(req.headers);
  const r = hitIp(db, ip, insideAnySite(db, ip), nowMs());
  if (r.ok) return null;
  return Response.redirect(new URL(withBase("/signin?error=rate_limited"), req.nextUrl.origin), 303);
}

export async function GET(req: NextRequest) {
  return limited(req) ?? handlers.GET(req);
}

export async function POST(req: NextRequest) {
  return limited(req) ?? handlers.POST(req);
}
