/** POST /api/admin/credentials/[id]/approve {confirmCode} · /reject · /revoke (spec §2.4, AC-20). */
import { z } from "zod";
import { inTx } from "@/db";
import { adminWrite } from "@/lib/admin";
import { decide, type Decision } from "@/lib/approvals";
import { errorJson, json, route } from "@/lib/http";
import { requireAdmin } from "@/lib/session";

type Ctx = { params: Promise<{ id: string; decision: string }> };

const Body = z.object({ confirmCode: z.string().max(32).optional(), note: z.string().trim().max(200).optional() }).strict();
const DECISIONS = new Set<Decision>(["approve", "reject", "revoke"]);

export const POST = route(async (req: Request, ctx: Ctx) => {
  const { id, decision } = await ctx.params;
  if (!DECISIONS.has(decision as Decision)) {
    await requireAdmin();
    return errorJson("not_found");
  }
  const { ctx: c, body } = await adminWrite(req, Body);
  const cred = inTx(() => decide(c, id, decision as Decision, body));
  return json({ credential: { id: cred.id, status: cred.status, decidedAt: cred.decidedAt } });
});
