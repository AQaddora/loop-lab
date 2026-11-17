import { clientIp } from "@/lib/ip";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /api/client-ip -> {ip}: the address as the server sees it, or null (spec §2.2). */
export function GET(req: Request) {
  return json({ ip: clientIp(req.headers) });
}
