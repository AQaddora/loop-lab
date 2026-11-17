/** GET /api/admin/audit?action=&targetId=&limit= : read-only view of the append-only audit_log (TH-11). */
import { and, desc, eq, type SQL } from "drizzle-orm";
import { auditLog } from "@/db/schema";
import { adminRead } from "@/lib/admin";
import { json, route } from "@/lib/http";

export const GET = route(async (req: Request) => {
  const { db, actor } = await adminRead();
  const q = new URL(req.url).searchParams;
  const where: SQL[] = [eq(auditLog.orgId, actor.orgId)];
  const action = q.get("action");
  const targetId = q.get("targetId");
  if (action) where.push(eq(auditLog.action, action));
  if (targetId) where.push(eq(auditLog.targetId, targetId));
  const limit = Math.min(Math.max(Number(q.get("limit") ?? 200) || 200, 1), 1000);
  const rows = db.select().from(auditLog).where(and(...where)).orderBy(desc(auditLog.at), desc(auditLog.id)).limit(limit).all();
  return json({ entries: rows.map((r) => ({ ...r, detail: JSON.parse(r.detailJson) as unknown, detailJson: undefined })) });
});
