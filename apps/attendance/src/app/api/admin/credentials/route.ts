/**
 * GET /api/admin/credentials?status=PENDING (spec §1.1.5): the approval queue with UA, IP, site, time, AAGUID
 * and the synced flag. It NEVER contains the confirm code (that is only on the owner's phone).
 */
import { and, desc, eq, type SQL } from "drizzle-orm";
import { credentials, members, sites } from "@/db/schema";
import { adminRead } from "@/lib/admin";
import { AppError } from "@/lib/errors";
import { json, route } from "@/lib/http";

const STATUSES = ["PENDING", "APPROVED", "REJECTED", "REVOKED"] as const;

export const GET = route(async (req: Request) => {
  const { db, actor } = await adminRead();
  const q = new URL(req.url).searchParams;
  const status = q.get("status");
  const memberId = q.get("memberId");
  if (status !== null && !STATUSES.includes(status as (typeof STATUSES)[number])) throw new AppError("bad_request");
  const where: SQL[] = [eq(members.orgId, actor.orgId)];
  if (status) where.push(eq(credentials.status, status as (typeof STATUSES)[number]));
  if (memberId) where.push(eq(credentials.memberId, memberId));
  const rows = db
    .select({ c: credentials, m: { id: members.id, email: members.email, fullName: members.fullName, employeeCode: members.employeeCode }, siteName: sites.name })
    .from(credentials)
    .innerJoin(members, eq(members.id, credentials.memberId))
    .leftJoin(sites, eq(sites.id, credentials.regSiteId))
    .where(and(...where))
    .orderBy(desc(credentials.createdAt))
    .all();
  return json({
    credentials: rows.map(({ c, m, siteName }) => ({
      id: c.id,
      member: m,
      status: c.status,
      createdAt: c.createdAt,
      regIp: c.regIp,
      regUa: c.regUa,
      regSiteId: c.regSiteId,
      regSiteName: siteName,
      regTicketId: c.regTicketId,
      aaguid: c.aaguid,
      deviceType: c.deviceType,
      synced: c.backupEligible,
      backupEligible: c.backupEligible,
      backupState: c.backupState,
      attachment: c.attachment,
      transports: c.transports ? (JSON.parse(c.transports) as string[]) : [],
      decidedBy: c.decidedBy,
      decidedAt: c.decidedAt,
      decisionNote: c.decisionNote,
      lastUsedAt: c.lastUsedAt,
    })),
  });
});
