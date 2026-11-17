import type { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { getDb } from "@/db";
import { withBase } from "@/lib/base-path";
import { nowMs } from "@/lib/clock";
import { clientIp } from "@/lib/ip";
import { hit, RATE_LIMITS } from "@/lib/ratelimit";

// sign-in steps (identity proof returns) are limited per IP (spec §2.7: 20/min)
function isSignInStep(req: NextRequest): boolean {
  const p = req.nextUrl.pathname;
  return /\/api\/auth\/callback\//.test(p) || (req.method === "POST" && /\/api\/auth\/signin\//.test(p));
}

function limited(req: NextRequest): Response | null {
  if (!isSignInStep(req)) return null;
  const ip = clientIp(req.headers) ?? "unknown";
  const r = hit(getDb(), `signin:${ip}`, RATE_LIMITS.signin.limit, RATE_LIMITS.signin.windowMs, nowMs());
  if (r.ok) return null;
  return Response.redirect(new URL(withBase("/signin?error=rate_limited"), req.nextUrl.origin), 303);
}

export async function GET(req: NextRequest) {
  return limited(req) ?? handlers.GET(req);
}

export async function POST(req: NextRequest) {
  return limited(req) ?? handlers.POST(req);
}
