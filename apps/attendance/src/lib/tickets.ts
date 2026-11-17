/**
 * Scan tickets (spec §2.1): created by a successful /s/…, carried in an HttpOnly cookie, bound to the first
 * member who uses it, consumed by exactly one punch.
 */
import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { DB } from "@/db";
import { scanTickets, siteNetworks, sites, type ScanTicket } from "@/db/schema";
import { basePath } from "./base-path";
import { AppError } from "./errors";
import { randomId } from "./ids";
import { ipAllowed } from "./ip";

export function ticketTtlMs(): number {
  const s = Number(process.env.SCAN_TICKET_TTL_SECONDS ?? 300);
  return (Number.isInteger(s) && s > 0 ? s : 300) * 1000;
}

const isHttps = () => (process.env.AUTH_URL ?? "").startsWith("https://");

/** `__Host-scan_ticket` over https without a base path, `__Secure-scan_ticket` with one, `scan_ticket` over http. */
export function ticketCookieName(): string {
  if (!isHttps()) return "scan_ticket";
  return basePath() === "" ? "__Host-scan_ticket" : "__Secure-scan_ticket";
}

export function ticketCookie(id: string): string {
  const parts = [
    `${ticketCookieName()}=${id}`,
    `Max-Age=${Math.floor(ticketTtlMs() / 1000)}`,
    `Path=${basePath() || "/"}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (isHttps()) parts.push("Secure");
  return parts.join("; ");
}

export function readTicketId(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const name = ticketCookieName();
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) {
      const val = v.join("=");
      return /^[A-Za-z0-9_-]{16,64}$/.test(val) ? val : null;
    }
  }
  return null;
}

export function createTicket(
  db: DB,
  t: { siteId: string; source: "rotating" | "static"; qrWindow?: number | null; staticQrId?: string | null; ip: string; ua: string | null; nowMs: number },
): ScanTicket {
  const row = {
    id: randomId(),
    siteId: t.siteId,
    source: t.source,
    qrWindow: t.qrWindow ?? null,
    staticQrId: t.staticQrId ?? null,
    ip: t.ip,
    ua: t.ua ? t.ua.slice(0, 512) : null,
    createdAt: t.nowMs,
    expiresAt: t.nowMs + ticketTtlMs(),
  };
  db.insert(scanTickets).values(row).run();
  return db.select().from(scanTickets).where(eq(scanTickets.id, row.id)).get() as ScanTicket;
}

export function siteCidrs(db: DB, siteId: string): string[] {
  return db.select({ cidr: siteNetworks.cidr }).from(siteNetworks).where(eq(siteNetworks.siteId, siteId)).all().map((r) => r.cidr);
}

/** Is `ip` inside ANY site's CIDRs (the office-NAT allowance of the shared IP rate limit)? */
export function insideAnySite(db: DB, ip: string | null): boolean {
  if (!ip) return false;
  const all = db.select({ cidr: siteNetworks.cidr }).from(siteNetworks).all().map((r) => r.cidr);
  return ipAllowed(ip, all);
}

/**
 * Bind on first authenticated use (spec §2.1): guarded UPDATE; zero rows -> the matching ticket_* code.
 * A ticket whose site is no longer ACTIVE counts as ticket_expired.
 */
export function bindTicket(db: DB, ticketId: string | null, memberId: string, nowMs: number): ScanTicket {
  if (!ticketId) throw new AppError("ticket_missing");
  const res = db
    .update(scanTickets)
    .set({ boundMemberId: memberId })
    .where(
      and(
        eq(scanTickets.id, ticketId),
        isNull(scanTickets.usedAt),
        gt(scanTickets.expiresAt, nowMs),
        or(isNull(scanTickets.boundMemberId), eq(scanTickets.boundMemberId, memberId)),
      ),
    )
    .run();
  const t = db.select().from(scanTickets).where(eq(scanTickets.id, ticketId)).get();
  if (res.changes === 0) {
    if (!t) throw new AppError("ticket_missing");
    if (t.usedAt !== null) throw new AppError("ticket_used");
    if (t.expiresAt <= nowMs) throw new AppError("ticket_expired");
    throw new AppError("ticket_other_user");
  }
  const site = db.select({ status: sites.status }).from(sites).where(eq(sites.id, (t as ScanTicket).siteId)).get();
  if (!site || site.status !== "ACTIVE") throw new AppError("ticket_expired");
  return t as ScanTicket;
}
