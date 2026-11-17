/**
 * Steps 9–10 of the punch (spec §2.5) as ONE synchronous better-sqlite3 transaction with no `await` inside,
 * so two parallel punches cannot both pass the state check (AC-41):
 *   9  recompute the member's state; transition valid, then >= 60 s since the state row
 *   10 consume the ticket (guarded UPDATE, zero rows -> ticket_used), append the chained event,
 *      update credential counter + last_used, update the chain head
 * Any failure throws and rolls the whole transaction back.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Handle } from "@/db";
import { attendanceEvents, chainHeads, credentials, scanTickets } from "@/db/schema";
import { link } from "./chain";
import { AppError } from "./errors";
import { randomId } from "./ids";
import { checkTransition, MIN_PUNCH_GAP_MS, type StateEvent } from "./punch-state";

export type CommitInput = {
  orgId: string;
  memberId: string;
  siteId: string;
  kind: "IN" | "OUT";
  ticketId: string;
  credentialRowId: string;
  newCounter: number;
  nowMs: number;
  ip: string | null;
  ua: string | null;
  chainKey: string;
  maxShiftHours: (siteId: string | null) => number;
};

export type CommittedEvent = { id: string; seq: number; kind: "IN" | "OUT"; recordedAt: number; effectiveAt: number; siteId: string };

export function commitPunch(h: Handle, x: CommitInput): CommittedEvent {
  const { db } = h;
  return h.sqlite.transaction((): CommittedEvent => {
    // 9
    const events: StateEvent[] = db
      .select({ seq: attendanceEvents.seq, kind: attendanceEvents.kind, effectiveAt: attendanceEvents.effectiveAt, correctsSeq: attendanceEvents.correctsSeq, siteId: attendanceEvents.siteId })
      .from(attendanceEvents)
      .where(and(eq(attendanceEvents.orgId, x.orgId), eq(attendanceEvents.memberId, x.memberId)))
      .orderBy(asc(attendanceEvents.seq))
      .all();
    const t = checkTransition(events, x.kind, x.nowMs, MIN_PUNCH_GAP_MS, x.maxShiftHours);
    if (!t.ok) throw new AppError(t.error);

    // 10
    const eventId = randomId("ev_");
    const consumed = db
      .update(scanTickets)
      .set({ usedAt: x.nowMs, eventId })
      .where(and(eq(scanTickets.id, x.ticketId), isNull(scanTickets.usedAt)))
      .run();
    if (consumed.changes === 0) throw new AppError("ticket_used");

    const head = db.select().from(chainHeads).where(eq(chainHeads.orgId, x.orgId)).get() ?? null;
    const fields = {
      org_id: x.orgId,
      member_id: x.memberId,
      site_id: x.siteId,
      kind: x.kind,
      source: "PUNCH" as const,
      effective_at: x.nowMs,
      recorded_at: x.nowMs,
      credential_id: x.credentialRowId,
      ticket_id: x.ticketId,
      corrects_seq: null,
      reason: null,
      actor_member_id: null,
    };
    const l = link(head ? { seq: head.seq, hash: head.hash } : null, fields, x.chainKey);
    db.insert(attendanceEvents)
      .values({
        id: eventId,
        orgId: x.orgId,
        seq: l.seq,
        memberId: x.memberId,
        siteId: x.siteId,
        kind: x.kind,
        source: "PUNCH",
        effectiveAt: x.nowMs,
        recordedAt: x.nowMs,
        credentialId: x.credentialRowId,
        ticketId: x.ticketId,
        prevHash: l.prevHash,
        hash: l.hash,
        ip: x.ip,
        ua: x.ua ? x.ua.slice(0, 512) : null,
      })
      .run();
    db.update(credentials).set({ counter: x.newCounter, lastUsedAt: x.nowMs }).where(eq(credentials.id, x.credentialRowId)).run();
    db.insert(chainHeads)
      .values({ orgId: x.orgId, seq: l.seq, hash: l.hash })
      .onConflictDoUpdate({ target: chainHeads.orgId, set: { seq: l.seq, hash: l.hash } })
      .run();
    return { id: eventId, seq: l.seq, kind: x.kind, recordedAt: x.nowMs, effectiveAt: x.nowMs, siteId: x.siteId };
  })();
}
