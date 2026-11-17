/**
 * Admin corrections (spec §2.6): new rows with source=ADMIN, a reason of 3–500 chars and the actor. The
 * original row never changes. VOID needs corrects_seq -> a non-voided IN/OUT row of the same org (a VOID,
 * a voided row or an unknown seq -> bad_request). IN/OUT need effective_at <= now (future -> bad_request).
 * No self-correction (forbidden_self_action). Appended to the hash chain in one synchronous transaction.
 */
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Handle } from "@/db";
import { attendanceEvents, chainHeads, members, sites, type Member } from "@/db/schema";
import { audit } from "./audit";
import { link } from "./chain";
import { AppError } from "./errors";
import { randomId } from "./ids";
import { liveEvents } from "./punch-state";

export const CorrectionInput = z
  .object({
    kind: z.enum(["VOID", "IN", "OUT"]),
    memberId: z.string().min(1).max(64).optional(),
    correctsSeq: z.number().int().min(1).optional(),
    effectiveAt: z.number().int().min(0).optional(),
    siteId: z.string().min(1).max(64).nullable().optional(),
    reason: z.unknown().optional(),
  })
  .strict();
export type CorrectionInput = z.infer<typeof CorrectionInput>;

type Ctx = { actor: Member; now: number; ip: string | null; chainKey: string };

export function correct(h: Handle, c: Ctx, input: CorrectionInput) {
  const { db } = h;
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length < 3) throw new AppError("reason_required");
  if (reason.length > 500) throw new AppError("bad_request");

  return h.sqlite.transaction(() => {
    let memberId: string;
    let siteId: string | null = input.siteId ?? null;
    let effectiveAt: number;
    let correctsSeq: number | null = null;

    if (input.kind === "VOID") {
      if (input.correctsSeq === undefined || input.effectiveAt !== undefined) throw new AppError("bad_request");
      const target = db.select().from(attendanceEvents).where(and(eq(attendanceEvents.orgId, c.actor.orgId), eq(attendanceEvents.seq, input.correctsSeq))).get();
      if (!target || target.kind === "VOID") throw new AppError("bad_request");
      if (input.memberId !== undefined && input.memberId !== target.memberId) throw new AppError("bad_request");
      const history = db.select().from(attendanceEvents).where(eq(attendanceEvents.memberId, target.memberId)).orderBy(asc(attendanceEvents.seq)).all();
      if (!liveEvents(history).some((e) => e.seq === target.seq)) throw new AppError("bad_request"); // already voided
      memberId = target.memberId;
      siteId = target.siteId;
      effectiveAt = c.now;
      correctsSeq = target.seq;
    } else {
      if (input.memberId === undefined || input.effectiveAt === undefined || input.correctsSeq !== undefined) throw new AppError("bad_request");
      if (input.effectiveAt > c.now) throw new AppError("bad_request");
      memberId = input.memberId;
      effectiveAt = input.effectiveAt;
      if (siteId !== null && !db.select({ id: sites.id }).from(sites).where(and(eq(sites.id, siteId), eq(sites.orgId, c.actor.orgId))).get()) {
        throw new AppError("bad_request");
      }
    }
    const member = db.select().from(members).where(and(eq(members.id, memberId), eq(members.orgId, c.actor.orgId))).get();
    if (!member) throw new AppError("bad_request");
    if (member.id === c.actor.id) throw new AppError("forbidden_self_action");

    const head = db.select().from(chainHeads).where(eq(chainHeads.orgId, c.actor.orgId)).get() ?? null;
    const fields = {
      org_id: c.actor.orgId,
      member_id: memberId,
      site_id: siteId,
      kind: input.kind,
      source: "ADMIN" as const,
      effective_at: effectiveAt,
      recorded_at: c.now,
      credential_id: null,
      ticket_id: null,
      corrects_seq: correctsSeq,
      reason,
      actor_member_id: c.actor.id,
    };
    const l = link(head ? { seq: head.seq, hash: head.hash } : null, fields, c.chainKey);
    const id = randomId("ev_");
    db.insert(attendanceEvents)
      .values({ id, orgId: c.actor.orgId, seq: l.seq, memberId, siteId, kind: input.kind, source: "ADMIN", effectiveAt, recordedAt: c.now, correctsSeq, reason, actorMemberId: c.actor.id, prevHash: l.prevHash, hash: l.hash, ip: c.ip })
      .run();
    db.insert(chainHeads).values({ orgId: c.actor.orgId, seq: l.seq, hash: l.hash }).onConflictDoUpdate({ target: chainHeads.orgId, set: { seq: l.seq, hash: l.hash } }).run();
    audit(db, { orgId: c.actor.orgId, actorMemberId: c.actor.id, action: "attendance.correct", targetType: "attendance_event", targetId: id, detail: { seq: l.seq, kind: input.kind, memberId, correctsSeq, effectiveAt, reason }, ip: c.ip, at: c.now });
    return { id, seq: l.seq, kind: input.kind, memberId, effectiveAt, recordedAt: c.now, correctsSeq, reason };
  })();
}
