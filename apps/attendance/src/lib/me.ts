/** What the phone app needs to render /enroll and /punch (GET /api/me/state, spec §5.2). */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { DB } from "@/db";
import { attendanceEvents, credentials, scanTickets, sites, type Member } from "@/db/schema";
import { currentState, nextAction, type StateEvent } from "./punch-state";
import { confirmCode } from "./webauthn";

export function memberEvents(db: DB, memberId: string): StateEvent[] {
  return db
    .select({ seq: attendanceEvents.seq, kind: attendanceEvents.kind, effectiveAt: attendanceEvents.effectiveAt, correctsSeq: attendanceEvents.correctsSeq, siteId: attendanceEvents.siteId })
    .from(attendanceEvents)
    .where(eq(attendanceEvents.memberId, memberId))
    .orderBy(asc(attendanceEvents.seq))
    .all();
}

export function maxShiftLookup(db: DB): (siteId: string | null) => number {
  const rows = db.select({ id: sites.id, h: sites.maxShiftHours }).from(sites).all();
  const m = new Map(rows.map((r) => [r.id, r.h]));
  return (siteId) => (siteId ? (m.get(siteId) ?? 16) : 16);
}

export function meState(db: DB, m: Member, ticketId: string | null, nowMs: number) {
  const creds = db
    .select()
    .from(credentials)
    .where(and(eq(credentials.memberId, m.id), inArray(credentials.status, ["PENDING", "APPROVED"])))
    .orderBy(desc(credentials.createdAt))
    .all();
  const approved = creds.find((c) => c.status === "APPROVED") ?? null;
  const pending = creds.find((c) => c.status === "PENDING") ?? null;
  const events = memberEvents(db, m.id);
  const stale = { nowMs, maxShiftHours: maxShiftLookup(db) };
  let ticket: { id: string; site: { id: string; name: string }; expiresAt: number } | null = null;
  if (ticketId) {
    const t = db.select().from(scanTickets).where(eq(scanTickets.id, ticketId)).get();
    if (t && t.usedAt === null && t.expiresAt > nowMs && (t.boundMemberId === null || t.boundMemberId === m.id)) {
      const s = db.select().from(sites).where(eq(sites.id, t.siteId)).get();
      if (s && s.status === "ACTIVE") ticket = { id: t.id, site: { id: s.id, name: s.name }, expiresAt: t.expiresAt };
    }
  }
  return {
    member: { id: m.id, email: m.email, fullName: m.fullName, role: m.role, status: m.status, profileComplete: m.profileCompletedAt !== null },
    credential: {
      status: approved ? "APPROVED" : pending ? "PENDING" : "NONE",
      approved: approved ? { id: approved.id, createdAt: approved.createdAt, lastUsedAt: approved.lastUsedAt } : null,
      pending: pending
        ? { id: pending.id, createdAt: pending.createdAt, confirmCode: confirmCode(pending.credentialId, process.env.QR_SIGNING_SECRET ?? "") }
        : null,
    },
    punch: { state: currentState(events, stale), nextAction: nextAction(events, stale) },
    ticket: ticket ? { site: ticket.site, expiresAt: ticket.expiresAt } : null,
    serverNow: nowMs,
  };
}
