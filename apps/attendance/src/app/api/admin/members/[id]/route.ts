/** PATCH /api/admin/members/[id]: code / status / email / role, per the §1.1.3 rules in src/lib/members.ts. */
import { inTx } from "@/db";
import { adminWrite } from "@/lib/admin";
import { json, route } from "@/lib/http";
import { MemberPatch, publicMember, updateMember } from "@/lib/members";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const { ctx: c, body } = await adminWrite(req, MemberPatch);
  const m = inTx(() => updateMember(c, id, body));
  return json({ member: publicMember(m) });
});
