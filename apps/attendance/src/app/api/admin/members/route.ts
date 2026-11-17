/** GET /api/admin/members (allowlist) · POST: one member or an array (all-or-nothing). Spec §1.1.3. */
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { inTx } from "@/db";
import { members } from "@/db/schema";
import { adminRead, adminWrite } from "@/lib/admin";
import { json, route } from "@/lib/http";
import { addMember, MemberInput, publicMember } from "@/lib/members";

const AddBody = z.union([MemberInput, z.array(MemberInput).min(1).max(500)]);

export const GET = route(async () => {
  const { db, actor } = await adminRead();
  const rows = db.select().from(members).where(eq(members.orgId, actor.orgId)).orderBy(asc(members.createdAt), asc(members.email)).all();
  return json({ members: rows.map(publicMember) });
});

export const POST = route(async (req: Request) => {
  const { ctx, body } = await adminWrite(req, AddBody);
  const list = Array.isArray(body) ? body : [body];
  if (new Set(list.map((m) => m.email)).size !== list.length) return json({ error: "bad_request" }, 400);
  const added = inTx(() => list.map((m) => addMember(ctx, m)));
  return json(Array.isArray(body) ? { members: added.map(publicMember) } : { member: publicMember(added[0]) }, 201);
});
