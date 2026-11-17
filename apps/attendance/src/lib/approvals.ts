/**
 * Credential decisions (spec §2.4 "Credential states", §1.1.5):
 *   approve: only PENDING, member ACTIVE, approver != the credential's owner, confirmCode matches
 *   reject:  only PENDING · revoke: only APPROVED
 * Checked in order: unknown -> bad_request · own credential -> forbidden_self_action · wrong state or member not
 * ACTIVE -> invalid_state · wrong or missing code -> confirm_code_mismatch. Approve is one transaction: the
 * member's previous APPROVED -> REVOKED, then the target -> APPROVED. Every decision is audited.
 */
import { timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { credentials, members, type Credential, type Member } from "@/db/schema";
import { audit } from "./audit";
import { AppError } from "./errors";
import { confirmCode } from "./webauthn";

type Ctx = { db: DB; actor: Member; now: number; ip: string | null };
export type Decision = "approve" | "reject" | "revoke";

function load(c: Ctx, id: string): { cred: Credential; owner: Member } {
  const row = c.db
    .select({ cred: credentials, owner: members })
    .from(credentials)
    .innerJoin(members, eq(members.id, credentials.memberId))
    .where(and(eq(credentials.id, id), eq(members.orgId, c.actor.orgId)))
    .get();
  if (!row) throw new AppError("bad_request");
  return row;
}

function codeMatches(given: unknown, credentialId: string): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given.trim().toUpperCase());
  const b = Buffer.from(confirmCode(credentialId, process.env.QR_SIGNING_SECRET ?? ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function decide(c: Ctx, id: string, decision: Decision, body: { confirmCode?: unknown; note?: string }): Credential {
  const { cred, owner } = load(c, id);
  if (owner.id === c.actor.id) throw new AppError("forbidden_self_action");
  const need = decision === "revoke" ? "APPROVED" : "PENDING";
  if (cred.status !== need) throw new AppError("invalid_state");
  if (decision === "approve") {
    if (owner.status !== "ACTIVE") throw new AppError("invalid_state");
    if (!codeMatches(body.confirmCode, cred.credentialId)) throw new AppError("confirm_code_mismatch");
  }
  const note = body.note?.slice(0, 200) ?? null;
  const base = { decidedBy: c.actor.id, decidedAt: c.now };
  let revokedPrevious: string | null = null;
  if (decision === "approve") {
    const prev = c.db.select().from(credentials).where(and(eq(credentials.memberId, owner.id), eq(credentials.status, "APPROVED"))).get();
    if (prev) {
      c.db.update(credentials).set({ status: "REVOKED", ...base, decisionNote: `replaced by ${cred.id}` }).where(eq(credentials.id, prev.id)).run();
      revokedPrevious = prev.id;
    }
    c.db.update(credentials).set({ status: "APPROVED", ...base, decisionNote: note }).where(eq(credentials.id, cred.id)).run();
  } else {
    c.db.update(credentials).set({ status: decision === "reject" ? "REJECTED" : "REVOKED", ...base, decisionNote: note }).where(eq(credentials.id, cred.id)).run();
  }
  audit(c.db, {
    orgId: c.actor.orgId,
    actorMemberId: c.actor.id,
    action: `credential.${decision}`,
    targetType: "credential",
    targetId: cred.id,
    detail: { memberId: owner.id, email: owner.email, revokedPrevious, aaguid: cred.aaguid, synced: cred.backupEligible },
    ip: c.ip,
    at: c.now,
  });
  return c.db.select().from(credentials).where(eq(credentials.id, cred.id)).get() as Credential;
}
