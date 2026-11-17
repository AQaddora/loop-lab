/**
 * The ONE sign-in policy (spec §2.3), shared by Google and the test-only `test-login` provider,
 * evaluated on normalised Claims (src/lib/identity.ts), in order:
 *   0. no org exists yet: only lower(BOOTSTRAP_OWNER_EMAIL) with email_verified, else not_allowlisted; skip 2–4
 *   1. email_verified === true                      else email_unverified
 *   2. org allowed_google_hd set -> hd must equal it  else domain_not_allowed
 *   3. member lower(email) exists, INVITED or ACTIVE  else not_allowlisted (suspended for SUSPENDED/REMOVED)
 *   4. first login pins google_sub; later logins must match   else account_mismatch
 */
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { members, orgs } from "@/db/schema";
import type { ErrorCode } from "./errors";
import type { Claims } from "./identity";

export type PolicyResult =
  | { ok: true; memberId: string; email: string; sub: string; bootstrap: false }
  | { ok: true; memberId: null; email: string; sub: string; bootstrap: true }
  | { ok: false; error: ErrorCode };

export function evaluateSignIn(db: DB, claims: Claims | null, nowMs: number, bootstrapEmail?: string): PolicyResult {
  if (!claims || claims.email === "" || claims.sub === "" || claims.email.length > 320 || claims.sub.length > 255) {
    return { ok: false, error: "bad_request" };
  }
  const email = claims.email.trim().toLowerCase();
  const sub = claims.sub;

  // 0. bootstrap: no org yet -> only the configured owner email (verified), to run /admin/setup
  const org = db.select().from(orgs).limit(1).get();
  if (!org) {
    const boot = (bootstrapEmail ?? "").trim().toLowerCase();
    if (boot !== "" && email === boot && claims.email_verified === true) {
      return { ok: true, memberId: null, email, sub, bootstrap: true };
    }
    return { ok: false, error: "not_allowlisted" };
  }

  // 1
  if (claims.email_verified !== true) return { ok: false, error: "email_unverified" };

  // 2 (one org per deployment in v1)
  if (org.allowedGoogleHd) {
    if ((claims.hd ?? "").toLowerCase() !== org.allowedGoogleHd.toLowerCase()) {
      return { ok: false, error: "domain_not_allowed" };
    }
  }

  // 3
  const member = db.select().from(members).where(eq(members.email, email)).get();
  if (!member) return { ok: false, error: "not_allowlisted" };
  if (member.status === "SUSPENDED" || member.status === "REMOVED") return { ok: false, error: "suspended" };
  if (member.status !== "INVITED" && member.status !== "ACTIVE") return { ok: false, error: "not_allowlisted" };

  // 4
  if (member.googleSub !== null && member.googleSub !== sub) return { ok: false, error: "account_mismatch" };
  if (member.googleSub === null) {
    const taken = db.select({ id: members.id }).from(members).where(eq(members.googleSub, sub)).get();
    if (taken && taken.id !== member.id) return { ok: false, error: "account_mismatch" };
    db.update(members).set({ googleSub: sub, lastLoginAt: nowMs }).where(eq(members.id, member.id)).run();
  } else {
    db.update(members).set({ lastLoginAt: nowMs }).where(eq(members.id, member.id)).run();
  }
  return { ok: true, memberId: member.id, email, sub, bootstrap: false };
}
