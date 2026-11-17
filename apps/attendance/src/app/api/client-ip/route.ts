import { getDb } from "@/db";
import { nowMs } from "@/lib/clock";
import { errorJson, json } from "@/lib/http";
import { clientIp } from "@/lib/ip";
import { hitIp } from "@/lib/ratelimit";
import { insideAnySite } from "@/lib/tickets";

export const dynamic = "force-dynamic";

/** GET /api/client-ip -> {ip}: the address as the server sees it, or null (spec §2.2). Shared per-IP limit. */
export function GET(req: Request) {
  const ip = clientIp(req.headers);
  const db = getDb();
  if (!hitIp(db, ip, insideAnySite(db, ip), nowMs()).ok) return errorJson("rate_limited");
  return json({ ip });
}
