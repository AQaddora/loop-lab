/** GET /api/admin/attendance: the org's log (with names, corrections and the voided flag). */
import { adminRead } from "@/lib/admin";
import { adminLog } from "@/lib/events";
import { json, route } from "@/lib/http";

export const GET = route(async () => {
  const { db, actor } = await adminRead();
  return json({ events: adminLog(db, actor.orgId) });
});
