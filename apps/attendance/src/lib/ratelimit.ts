/**
 * DB fixed-window rate limiter (spec §2.7, AC-09). Clock injected. Postgres-compatible SQL
 * (INSERT … ON CONFLICT DO UPDATE … RETURNING).
 */
import { lt, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { rateLimits } from "@/db/schema";

export const RATE_LIMITS = {
  // /s/*, /api/client-ip and sign-in share one bucket per IP (spec §2.7): 30/min from IPs outside every
  // site CIDR, 600/min from inside (an office NAT puts everyone behind one address)
  ipOutside: { limit: 30, windowMs: 60_000 },
  ipInside: { limit: 600, windowMs: 60_000 },
  kioskPair: { limit: 10, windowMs: 60_000 }, // /api/kiosk/pair per IP
  webauthn: { limit: 10, windowMs: 60_000 }, // /api/punch/options, /api/punch, /api/webauthn/*, /api/profile per member
  adminWrite: { limit: 60, windowMs: 60_000 }, // admin writes per member
} as const;

export type RateResult = { ok: boolean; count: number; limit: number; retryAfterMs: number };

export function windowStart(nowMs: number, windowMs: number): number {
  return Math.floor(nowMs / windowMs) * windowMs;
}

/** Count one hit for `key` in the window containing nowMs. ok = count <= limit. */
export function hit(db: DB, key: string, limit: number, windowMs: number, nowMs: number): RateResult {
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowMs) || windowMs < 1) {
    throw new Error("bad rate limit config");
  }
  const start = windowStart(nowMs, windowMs);
  const row = db
    .insert(rateLimits)
    .values({ key, windowStart: start, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count })
    .get();
  const count = row?.count ?? Number.MAX_SAFE_INTEGER;
  return { ok: count <= limit, count, limit, retryAfterMs: start + windowMs - nowMs };
}

/** Drop windows that ended before `beforeMs` (housekeeping; never needed for correctness). */
export function pruneRateLimits(db: DB, beforeMs: number): void {
  db.delete(rateLimits).where(lt(rateLimits.windowStart, beforeMs)).run();
}

/**
 * The shared per-IP bucket of /s/*, /api/client-ip and sign-in. `inside` = the IP is in some site's CIDRs.
 * An unknown IP shares one "unknown" bucket with the outside limit.
 */
export function hitIp(db: DB, ip: string | null, inside: boolean, nowMs: number): RateResult {
  const cfg = ip && inside ? RATE_LIMITS.ipInside : RATE_LIMITS.ipOutside;
  return hit(db, `ip:${ip ?? "unknown"}`, cfg.limit, cfg.windowMs, nowMs);
}
