/**
 * Kiosks (spec §1.2): a paired display that only fetches server-minted rotating tokens.
 * Pairing code: 8 chars of base32, valid 10 min, stored hashed, consumed atomically, only from a site IP.
 * Kiosk cookie: HttpOnly, 180 days; its token is stored hashed.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { DB } from "@/db";
import { kiosks, sites, type Kiosk, type Site } from "@/db/schema";
import { audit } from "./audit";
import { basePath } from "./base-path";
import { AppError } from "./errors";
import { randomId } from "./ids";

export const PAIRING_TTL_MS = 10 * 60_000;
export const KIOSK_COOKIE_MAX_AGE_S = 180 * 86_400;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function newPairingCode(): string {
  return Array.from(randomBytes(8), (b) => B32[b & 31]).join("");
}

const isHttps = () => (process.env.AUTH_URL ?? "").startsWith("https://");
export function kioskCookieName(): string {
  if (!isHttps()) return "kiosk";
  return basePath() === "" ? "__Host-kiosk" : "__Secure-kiosk";
}
export function kioskCookie(token: string): string {
  const parts = [`${kioskCookieName()}=${token}`, `Max-Age=${KIOSK_COOKIE_MAX_AGE_S}`, `Path=${basePath() || "/"}`, "HttpOnly", "SameSite=Lax"];
  if (isHttps()) parts.push("Secure");
  return parts.join("; ");
}
export function readKioskToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === kioskCookieName()) {
      const val = v.join("=");
      return /^[A-Za-z0-9_-]{32,64}$/.test(val) ? val : null;
    }
  }
  return null;
}

type Actor = { orgId: string; actorId: string; ip: string | null; now: number };

export function createKiosk(db: DB, site: Site, name: string, a: Actor) {
  if (site.qrMode !== "rotating") throw new AppError("bad_request");
  const code = newPairingCode();
  const id = randomId("ksk_");
  db.insert(kiosks).values({ id, siteId: site.id, name, pairingCodeHash: sha256(code), pairingExpiresAt: a.now + PAIRING_TTL_MS, status: "PAIRING", createdBy: a.actorId, createdAt: a.now }).run();
  audit(db, { orgId: a.orgId, actorMemberId: a.actorId, action: "kiosk.create", targetType: "kiosk", targetId: id, detail: { siteId: site.id, name }, ip: a.ip, at: a.now });
  return { id, code, expiresAt: a.now + PAIRING_TTL_MS };
}

export function revokeKiosk(db: DB, orgId: string, id: string, a: Actor): Kiosk {
  const row = db.select({ k: kiosks }).from(kiosks).innerJoin(sites, eq(sites.id, kiosks.siteId)).where(and(eq(kiosks.id, id), eq(sites.orgId, orgId))).get()?.k;
  if (!row) throw new AppError("bad_request");
  if (row.status === "REVOKED") throw new AppError("invalid_state");
  db.update(kiosks).set({ status: "REVOKED", pairingCodeHash: null, pairingExpiresAt: null }).where(eq(kiosks.id, id)).run();
  audit(db, { orgId, actorMemberId: a.actorId, action: "kiosk.revoke", targetType: "kiosk", targetId: id, detail: { siteId: row.siteId }, ip: a.ip, at: a.now });
  return { ...row, status: "REVOKED" };
}

/** The kiosk a pairing code belongs to (still PAIRING and unexpired), or null. */
export function kioskForCode(db: DB, code: string, nowMs: number): Kiosk | null {
  if (!/^[A-Z2-7]{8}$/.test(code)) return null;
  return db.select().from(kiosks).where(and(eq(kiosks.pairingCodeHash, sha256(code)), eq(kiosks.status, "PAIRING"), gt(kiosks.pairingExpiresAt, nowMs))).get() ?? null;
}

/** Consume the code atomically: PAIRING -> ACTIVE with a fresh token (only its hash is stored). */
export function consumePairing(db: DB, kiosk: Kiosk, code: string, nowMs: number): string | null {
  const token = randomBytes(32).toString("base64url");
  const res = db
    .update(kiosks)
    .set({ status: "ACTIVE", tokenHash: sha256(token), pairingCodeHash: null, pairingExpiresAt: null, lastSeenAt: nowMs })
    .where(and(eq(kiosks.id, kiosk.id), eq(kiosks.pairingCodeHash, sha256(code)), eq(kiosks.status, "PAIRING"), gt(kiosks.pairingExpiresAt, nowMs)))
    .run();
  return res.changes === 1 ? token : null;
}

export function kioskForToken(db: DB, token: string | null): Kiosk | null {
  if (!token) return null;
  return db.select().from(kiosks).where(eq(kiosks.tokenHash, sha256(token))).get() ?? null;
}
