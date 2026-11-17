/** GET /api/admin/attendance/verify -> {ok, firstBadSeq} over the org's whole chain (spec §2.6). */
import { adminRead } from "@/lib/admin";
import { verifyOrgChain } from "@/lib/events";
import { json, route } from "@/lib/http";

export const GET = route(async () => {
  const { db, actor } = await adminRead();
  return json(verifyOrgChain(db, actor.orgId, process.env.LOG_CHAIN_KEY ?? ""));
});
