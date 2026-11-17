/** Read side of the attendance log: /me history, admin log, chain verify. */
import { asc, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { attendanceEvents, chainHeads, members, sites, type AttendanceEvent } from "@/db/schema";
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

/** The org's log joined with member + site names, with the voided flag. */
export function adminLog(db: DB, orgId: string) {
  const rows = orgEvents(db, orgId);
  const ms = new Map(db.select().from(members).where(eq(members.orgId, orgId)).all().map((m) => [m.id, m]));
  const ss = new Map(db.select().from(sites).where(eq(sites.orgId, orgId)).all().map((s) => [s.id, s]));
  const voided = new Set(rows.filter((r) => r.kind === "VOID" && r.correctsSeq !== null).map((r) => r.correctsSeq as number));
  return rows.map((r) => {
    const m = ms.get(r.memberId);
    const s = r.siteId ? ss.get(r.siteId) : undefined;
    return {
      seq: r.seq,
      kind: r.kind,
      source: r.source,
      memberId: r.memberId,
      memberEmail: m?.email ?? null,
      memberName: m?.fullName ?? null,
      employeeCode: m?.employeeCode ?? null,
      siteId: r.siteId,
      siteName: s?.name ?? null,
      siteTimezone: s?.timezone ?? "UTC",
      effectiveAt: r.effectiveAt,
      recordedAt: r.recordedAt,
      correctsSeq: r.correctsSeq,
      reason: r.reason,
      actorMemberId: r.actorMemberId,
      actorEmail: r.actorMemberId ? (ms.get(r.actorMemberId)?.email ?? null) : null,
      voided: r.kind !== "VOID" && voided.has(r.seq),
      hash: r.hash,
    };
  });
}
