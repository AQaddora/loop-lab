/** Static (printed) QR codes (spec §1.1.4, §2.1): TTL 1 h – STATIC_QR_MAX_TTL_DAYS (30), revocable. */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { sites, staticQrCodes, type Site, type StaticQrCode } from "@/db/schema";
import { audit } from "./audit";
import { withBase } from "./base-path";
import { AppError } from "./errors";
import { randomId } from "./ids";
import { expectedOrigin } from "./origin";
import { mintStatic } from "./qr";

export const MIN_STATIC_TTL_S = 3600;
export function maxStaticTtlS(): number {
  const d = Number(process.env.STATIC_QR_MAX_TTL_DAYS ?? 30);
  return (Number.isFinite(d) && d > 0 ? d : 30) * 86_400;
}

export const StaticQrInput = z.object({ ttlSeconds: z.number().int().positive(), label: z.string().trim().max(100).optional() }).strict();

/** Absolute scan URL: <AUTH_URL origin><BASE_PATH>/s/<siteId>?t=<token> */
export function scanUrl(siteId: string, token: string): string {
  return `${expectedOrigin()}${withBase(`/s/${siteId}`)}?t=${encodeURIComponent(token)}`;
}

export function staticToken(site: Site, row: StaticQrCode): string {
  return mintStatic(site, row.id, Math.floor(row.expiresAt / 1000), process.env.QR_SIGNING_SECRET ?? "");
}

type Actor = { orgId: string; actorId: string; ip: string | null; now: number };

export function mintStaticQr(db: DB, site: Site, input: z.infer<typeof StaticQrInput>, a: Actor) {
  if (input.ttlSeconds > maxStaticTtlS()) throw new AppError("ttl_too_long");
  if (input.ttlSeconds < MIN_STATIC_TTL_S) throw new AppError("bad_request");
  if (site.qrMode !== "static") throw new AppError("bad_request");
  const expUnix = Math.floor((a.now + input.ttlSeconds * 1000) / 1000);
  const row = { id: randomId("sqr_"), siteId: site.id, label: input.label ?? null, issuedBy: a.actorId, issuedAt: a.now, expiresAt: expUnix * 1000, status: "ACTIVE" as const };
  db.insert(staticQrCodes).values(row).run();
  audit(db, { orgId: a.orgId, actorMemberId: a.actorId, action: "qr.static.mint", targetType: "static_qr", targetId: row.id, detail: { siteId: site.id, label: row.label, expiresAt: row.expiresAt }, ip: a.ip, at: a.now });
  const token = staticToken(site, row as StaticQrCode);
  return { id: row.id, siteId: site.id, label: row.label, expiresAt: row.expiresAt, token, url: scanUrl(site.id, token) };
}

export function revokeStaticQr(db: DB, orgId: string, id: string, a: Actor): StaticQrCode {
  const row = db
    .select({ qr: staticQrCodes })
    .from(staticQrCodes)
    .innerJoin(sites, eq(sites.id, staticQrCodes.siteId))
    .where(and(eq(staticQrCodes.id, id), eq(sites.orgId, orgId)))
    .get()?.qr;
  if (!row) throw new AppError("bad_request");
  if (row.status !== "ACTIVE") throw new AppError("invalid_state");
  db.update(staticQrCodes).set({ status: "REVOKED" }).where(eq(staticQrCodes.id, id)).run();
  audit(db, { orgId, actorMemberId: a.actorId, action: "qr.static.revoke", targetType: "static_qr", targetId: id, detail: { siteId: row.siteId }, ip: a.ip, at: a.now });
  return { ...row, status: "REVOKED" };
}
