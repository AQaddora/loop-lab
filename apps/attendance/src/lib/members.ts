/**
 * Allowlist rules (spec §1.1.3, AC-43):
 * checked in this order:
 * - admins manage employees only; only the owner grants or removes admin/owner (else forbidden)
 * - the last ACTIVE owner cannot be demoted, suspended or removed (invalid_state)
 * - nobody changes their own role or status (forbidden_self_action)
 * - status moves: ACTIVE <-> SUSPENDED, any -> REMOVED (terminal); INVITED -> ACTIVE only via onboarding
 * - google_sub is never writable (the PATCH schema has no such field, unknown keys -> bad_request)
 */
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { members, type Member } from "@/db/schema";
import { audit } from "./audit";
import { AppError } from "./errors";
import { randomB64url, randomId } from "./ids";

const email = z.string().trim().toLowerCase().email().max(320);
const code = z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/);

export const MemberInput = z
  .object({ email, employeeCode: code.nullable().optional(), role: z.enum(["owner", "admin", "employee"]).default("employee") })
  .strict();
export const MemberPatch = z
  .object({
    email: email.optional(),
    employeeCode: code.nullable().optional(),
    role: z.enum(["owner", "admin", "employee"]).optional(),
    status: z.enum(["ACTIVE", "SUSPENDED", "REMOVED"]).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0);

type Ctx = { db: DB; actor: Member; now: number; ip: string | null };

const isPrivileged = (role: string) => role === "admin" || role === "owner";

function activeOwners(db: DB, orgId: string, exceptId?: string): number {
  const where = exceptId
    ? and(eq(members.orgId, orgId), eq(members.role, "owner"), eq(members.status, "ACTIVE"), ne(members.id, exceptId))
    : and(eq(members.orgId, orgId), eq(members.role, "owner"), eq(members.status, "ACTIVE"));
  return db.select({ id: members.id }).from(members).where(where).all().length;
}

export function publicMember(m: Member) {
  return {
    id: m.id,
    email: m.email,
    employeeCode: m.employeeCode,
    role: m.role,
    status: m.status,
    fullName: m.fullName,
    phone: m.phone,
    profileCompletedAt: m.profileCompletedAt,
    createdAt: m.createdAt,
    lastLoginAt: m.lastLoginAt,
  };
}

export function addMember(c: Ctx, input: z.infer<typeof MemberInput>): Member {
  if (isPrivileged(input.role) && c.actor.role !== "owner") throw new AppError("forbidden");
  if (c.db.select({ id: members.id }).from(members).where(eq(members.email, input.email)).get()) {
    throw new AppError("bad_request");
  }
  const row = {
    id: randomId("m_"),
    orgId: c.actor.orgId,
    email: input.email,
    employeeCode: input.employeeCode ?? null,
    role: input.role,
    status: "INVITED" as const,
    webauthnUserId: randomB64url(32),
    createdBy: c.actor.id,
    createdAt: c.now,
  };
  c.db.insert(members).values(row).run();
  audit(c.db, { orgId: c.actor.orgId, actorMemberId: c.actor.id, action: "member.add", targetType: "member", targetId: row.id, detail: { email: row.email, employeeCode: row.employeeCode, role: row.role }, ip: c.ip, at: c.now });
  return c.db.select().from(members).where(eq(members.id, row.id)).get() as Member;
}

export function updateMember(c: Ctx, id: string, patch: z.infer<typeof MemberPatch>): Member {
  const target = c.db.select().from(members).where(and(eq(members.id, id), eq(members.orgId, c.actor.orgId))).get();
  if (!target) throw new AppError("bad_request");
  const self = target.id === c.actor.id;

  // 1. authz: admins manage employees only; role grants are owner-only
  if (c.actor.role !== "owner") {
    if (isPrivileged(target.role) && !self) throw new AppError("forbidden");
    if (patch.role !== undefined && isPrivileged(patch.role) && patch.role !== target.role) throw new AppError("forbidden");
  }
  // 2. invariant: the last ACTIVE owner is never demoted, suspended or removed
  const losesOwner =
    target.role === "owner" &&
    target.status === "ACTIVE" &&
    ((patch.role !== undefined && patch.role !== "owner") || (patch.status !== undefined && patch.status !== "ACTIVE"));
  if (losesOwner && activeOwners(c.db, c.actor.orgId, target.id) === 0) throw new AppError("invalid_state");
  // 3. nobody changes their own role or status
  if (self && ((patch.role !== undefined && patch.role !== target.role) || (patch.status !== undefined && patch.status !== target.status))) {
    throw new AppError("forbidden_self_action");
  }

  if (patch.status !== undefined && patch.status !== target.status) {
    const ok =
      patch.status === "REMOVED"
        ? target.status !== "REMOVED"
        : patch.status === "SUSPENDED"
          ? target.status === "ACTIVE"
          : target.status === "SUSPENDED"; // -> ACTIVE
    if (!ok) throw new AppError("invalid_state");
  }
  if (target.status === "REMOVED") throw new AppError("invalid_state");

  if (patch.email !== undefined && patch.email !== target.email) {
    if (c.db.select({ id: members.id }).from(members).where(eq(members.email, patch.email)).get()) throw new AppError("bad_request");
  }

  const change: Partial<Member> = {};
  if (patch.email !== undefined) change.email = patch.email;
  if (patch.employeeCode !== undefined) change.employeeCode = patch.employeeCode;
  if (patch.role !== undefined) change.role = patch.role;
  if (patch.status !== undefined) change.status = patch.status;
  c.db.update(members).set(change).where(eq(members.id, target.id)).run();
  audit(c.db, {
    orgId: c.actor.orgId,
    actorMemberId: c.actor.id,
    action: "member.update",
    targetType: "member",
    targetId: target.id,
    detail: { before: { email: target.email, employeeCode: target.employeeCode, role: target.role, status: target.status }, change },
    ip: c.ip,
    at: c.now,
  });
  return c.db.select().from(members).where(eq(members.id, target.id)).get() as Member;
}
