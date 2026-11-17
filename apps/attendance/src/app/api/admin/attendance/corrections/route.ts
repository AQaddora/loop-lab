/** POST /api/admin/attendance/corrections {kind: VOID|IN|OUT, memberId?, correctsSeq?, effectiveAt?, siteId?, reason}. */
import { getHandle } from "@/db";
import { adminWrite } from "@/lib/admin";
import { CorrectionInput, correct } from "@/lib/corrections";
import { json, route } from "@/lib/http";

export const POST = route(async (req: Request) => {
  const { ctx, body } = await adminWrite(req, CorrectionInput);
  const ev = correct(getHandle(), { actor: ctx.actor, now: ctx.now, ip: ctx.ip, chainKey: process.env.LOG_CHAIN_KEY ?? "" }, body);
  return json({ event: ev }, 201);
});
