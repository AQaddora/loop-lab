/**
 * Session -> member, reloaded from the DB on EVERY request (spec §2.3), so suspend/revoke act at once.
 * The JWT only carries ids; role and status always come from the members row.
 */
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { members, type Member } from "@/db/schema";
import { AppError } from "./errors";

export type SessionInfo = { email: string; sub: string | null; memberId: string | null; bootstrap: boolean };

export async function sessionInfo(): Promise<SessionInfo | null> {
  const s = await auth();
  if (!s?.user?.email) return null;
  return {
    email: s.user.email,
    sub: s.user.sub ?? null,
    memberId: s.user.memberId ?? null,
    bootstrap: s.user.bootstrap === true,
  };
}

/**
 * The signed-in member as stored now, or null (no session, unknown member, email changed, sub differs).
 * A bootstrap session (memberId null) resolves once /admin/setup has created its owner row with the pinned sub.
 */
export async function currentMember(): Promise<Member | null> {
  const s = await sessionInfo();
  if (!s?.sub) return null;
  const db = getDb();
  const email = s.email.toLowerCase();
  const m = s.memberId
    ? db.select().from(members).where(eq(members.id, s.memberId)).get()
    : db.select().from(members).where(eq(members.email, email)).get();
  // email reassigned or Google account swapped since the JWT was issued -> no longer this member
  if (!m || m.email !== email || m.googleSub === null || m.googleSub !== s.sub) return null;
  return m;
}

export type RequireOpts = { allowInvited?: boolean; requireProfile?: boolean };

/**
 * unauthenticated -> no session; suspended -> SUSPENDED/REMOVED; INVITED only with allowInvited;
 * profile_incomplete -> requireProfile and no profile yet.
 */
export async function requireMember(opts: RequireOpts = {}): Promise<Member> {
  const m = await currentMember();
  if (!m) throw new AppError("unauthenticated");
  if (m.status === "SUSPENDED" || m.status === "REMOVED") throw new AppError("suspended");
  if (m.status === "INVITED" && !opts.allowInvited) throw new AppError("profile_incomplete");
  if (opts.requireProfile && m.profileCompletedAt === null) throw new AppError("profile_incomplete");
  return m;
}

/**
 * Admin routes (spec §2.3): role admin or owner and status ACTIVE; no completed profile needed.
 * unauthenticated -> no session; suspended -> SUSPENDED/REMOVED; forbidden -> employee or INVITED.
 */
export async function requireAdmin(opts: { owner?: boolean } = {}): Promise<Member> {
  const m = await currentMember();
  if (!m) throw new AppError("unauthenticated");
  if (m.status === "SUSPENDED" || m.status === "REMOVED") throw new AppError("suspended");
  if (m.status !== "ACTIVE") throw new AppError("forbidden");
  if (opts.owner ? m.role !== "owner" : m.role !== "admin" && m.role !== "owner") throw new AppError("forbidden");
  return m;
}
