/** Read side of the attendance log: /me history, admin log, chain verify. */
import { asc, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { attendanceEvents, chainHeads, type AttendanceEvent } from "@/db/schema";
import { verifyChain, type ChainRow } from "./chain";
import { liveEvents } from "./punch-state";

export function orgEvents(db: DB, orgId: string): AttendanceEvent[] {
  return db.select().from(attendanceEvents).where(eq(attendanceEvents.orgId, orgId)).orderBy(asc(attendanceEvents.seq)).all();
}

export function toChainRow(r: AttendanceEvent): ChainRow {
  return {
    seq: r.seq,
    org_id: r.orgId,
    member_id: r.memberId,
    site_id: r.siteId,
    kind: r.kind,
    source: r.source,
    effective_at: r.effectiveAt,
    recorded_at: r.recordedAt,
    credential_id: r.credentialId,
    ticket_id: r.ticketId,
    corrects_seq: r.correctsSeq,
    reason: r.reason,
    actor_member_id: r.actorMemberId,
    prev_hash: r.prevHash,
    hash: r.hash,
  };
}

export function verifyOrgChain(db: DB, orgId: string, key: string) {
  const head = db.select().from(chainHeads).where(eq(chainHeads.orgId, orgId)).get() ?? null;
  return verifyChain(orgEvents(db, orgId).map(toChainRow), key, head ? { head: { seq: head.seq, hash: head.hash } } : {});
}

/** A member's own events with the voided flag (rows that a VOID points at). */
export function memberHistory(db: DB, memberId: string) {
  const rows = db.select().from(attendanceEvents).where(eq(attendanceEvents.memberId, memberId)).orderBy(asc(attendanceEvents.seq)).all();
  const live = new Set(liveEvents(rows).map((r) => r.seq));
  return rows.map((r) => ({
    seq: r.seq,
    kind: r.kind,
    source: r.source,
    siteId: r.siteId,
    effectiveAt: r.effectiveAt,
    recordedAt: r.recordedAt,
    correctsSeq: r.correctsSeq,
    reason: r.reason,
    actorMemberId: r.actorMemberId,
    voided: r.kind !== "VOID" && !live.has(r.seq),
  }));
}
